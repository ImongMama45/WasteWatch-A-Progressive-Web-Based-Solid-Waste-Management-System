from django.core.exceptions import PermissionDenied as DjangoPermissionDenied, ValidationError as DjangoValidationError
from django.db import transaction
from django.db.models import Q
from rest_framework import permissions, status, viewsets
from rest_framework.response import Response

from accounts.models import UserRole
from accounts.permissions import is_admin_user
from driver.models import DriverShift, Truck
from driver.truck_service import TruckLifecycleConflictError, TruckService
from wastewatch.pagination import StandardResultsSetPagination

from .inspection_serializers import DumpsiteTruckInspectionSerializer
from .models import Dumpsite, DumpsiteTruckInspection, InspectionType


class IsAuthorizedForTruckInspections(permissions.BasePermission):
    def has_permission(self, request, view):
        user = getattr(request, 'user', None)
        if not user or not user.is_authenticated:
            return False
        if is_admin_user(user):
            return True
        role = getattr(user, 'role', None)
        if role == UserRole.DRIVER:
            return True
        if role == UserRole.DUMPSITE:
            return TruckService.get_operator_dumpsite_id(user) is not None
        return False


class DumpsiteTruckInspectionViewSet(viewsets.ModelViewSet):
    queryset = DumpsiteTruckInspection.objects.select_related(
        'truck', 'dumpsite', 'driver_shift', 'submitted_by'
    ).order_by('-inspected_at', '-id')
    serializer_class = DumpsiteTruckInspectionSerializer
    permission_classes = [permissions.IsAuthenticated, IsAuthorizedForTruckInspections]
    pagination_class = StandardResultsSetPagination
    http_method_names = ['get', 'post', 'head', 'options']

    def get_queryset(self):
        qs = super().get_queryset()
        user = self.request.user
        role = getattr(user, 'role', None)

        if is_admin_user(user):
            pass
        elif role == UserRole.DUMPSITE:
            facility_id = TruckService.get_operator_dumpsite_id(user)
            if not facility_id:
                return qs.none()
            qs = qs.filter(dumpsite_id=facility_id)
        elif role == UserRole.DRIVER:
            qs = qs.filter(Q(driver_shift__driver=user) | Q(submitted_by=user)).distinct()
        else:
            return qs.none()

        params = self.request.query_params
        driver_shift_id = params.get('driver_shift_id')
        if driver_shift_id:
            qs = qs.filter(driver_shift_id=driver_shift_id)
        truck_id = params.get('truck_id')
        if truck_id:
            qs = qs.filter(truck_id=truck_id)
        dumpsite_id = params.get('dumpsite_id')
        if dumpsite_id:
            qs = qs.filter(dumpsite_id=dumpsite_id)
        inspection_state = params.get('inspection_state')
        if inspection_state:
            qs = qs.filter(inspection_state=inspection_state.strip().upper())
        inspection_type = params.get('inspection_type')
        if inspection_type:
            qs = qs.filter(inspection_type=inspection_type.strip().upper())
        search = (params.get('search') or '').strip()
        if search:
            qs = qs.filter(
                Q(truck__plate_number__icontains=search)
                | Q(truck__model__icontains=search)
                | Q(notes__icontains=search)
                | Q(submitted_by__full_name__icontains=search)
                | Q(submitted_by__username__icontains=search)
            )
        return qs

    def create(self, request, *args, **kwargs):
        user = request.user
        role = getattr(user, 'role', None)
        is_admin = is_admin_user(user)

        raw_shift_id = request.data.get('driver_shift_id')
        if raw_shift_id is None:
            raw_shift_id = request.data.get('driver_shift')
        raw_truck_id = request.data.get('truck_id')
        if raw_truck_id is None:
            raw_truck_id = request.data.get('truck')
        raw_dumpsite_id = request.data.get('dumpsite_id')
        if raw_dumpsite_id is None:
            raw_dumpsite_id = request.data.get('dumpsite')

        inspection_type = (request.data.get('inspection_type') or InspectionType.POST_SHIFT).strip().upper()
        if inspection_type not in set(InspectionType.values):
            return Response(
                {'inspection_type': f"inspection_type must be one of {list(InspectionType.values)}."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        inspection_state = (request.data.get('inspection_state') or '').strip().upper()
        if inspection_state not in {'PASSED', 'FAILED', 'PENDING_INSPECTION'}:
            return Response(
                {'inspection_state': "inspection_state must be 'PASSED', 'FAILED', or 'PENDING_INSPECTION'."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        raw_condition = request.data.get('mechanical_condition')
        if raw_condition is None or str(raw_condition).strip() == '':
            mechanical_condition = 'NEEDS_REPAIR' if inspection_state == 'FAILED' else 'OPERATIONAL'
        else:
            mechanical_condition = str(raw_condition).strip().upper()
            if mechanical_condition not in {'OPERATIONAL', 'NEEDS_REPAIR', 'CRITICAL'}:
                return Response(
                    {'mechanical_condition': "mechanical_condition must be 'OPERATIONAL', 'NEEDS_REPAIR', or 'CRITICAL'."},
                    status=status.HTTP_400_BAD_REQUEST,
                )

        notes = (request.data.get('notes') or '').strip()
        checklist_data = request.data.get('checklist_data')
        if checklist_data is None:
            checklist_data = {}
        if not isinstance(checklist_data, dict):
            return Response(
                {'checklist_data': 'checklist_data must be a JSON object.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        # Parse optional integer IDs cleanly
        shift_id = None
        if raw_shift_id not in (None, ''):
            try:
                shift_id = int(raw_shift_id)
            except (TypeError, ValueError):
                return Response({'driver_shift_id': 'Invalid driver_shift_id.'}, status=status.HTTP_400_BAD_REQUEST)

        client_truck_id = None
        if raw_truck_id not in (None, ''):
            try:
                client_truck_id = int(raw_truck_id)
            except (TypeError, ValueError):
                return Response({'truck_id': 'Invalid truck_id.'}, status=status.HTTP_400_BAD_REQUEST)

        client_dumpsite_id = None
        if raw_dumpsite_id not in (None, ''):
            try:
                client_dumpsite_id = int(raw_dumpsite_id)
            except (TypeError, ValueError):
                return Response({'dumpsite_id': 'Invalid dumpsite_id.'}, status=status.HTTP_400_BAD_REQUEST)

        class _ConcurrentInspectionTruckChange(Exception):
            pass

        max_attempts = 3
        for attempt in range(max_attempts):
            pre_truck_id = client_truck_id
            if shift_id is not None:
                pre_shift = (
                    DriverShift.objects.select_related('truck', 'allocation__truck')
                    .filter(pk=shift_id)
                    .first()
                )
                if not pre_shift:
                    return Response({'driver_shift_id': f'DriverShift #{shift_id} not found.'}, status=status.HTTP_404_NOT_FOUND)
                pre_truck = pre_shift.effective_truck
                pre_truck_id = pre_truck.id if pre_truck else None

            try:
                with transaction.atomic():
                    # Canonical lock order: Truck (Level 5) BEFORE DriverShift (Level 8)
                    locked_truck = (
                        Truck.objects.select_for_update().filter(pk=pre_truck_id).first()
                        if pre_truck_id is not None
                        else None
                    )
                    shift = None
                    target_truck_id = None
                    resolved_dumpsite_id = None

                    if not is_admin and role == UserRole.DRIVER:
                        if shift_id is None:
                            return Response(
                                {'driver_shift_id': 'driver_shift_id is required when submitting an inspection as a Driver.'},
                                status=status.HTTP_400_BAD_REQUEST,
                            )
                        shift = (
                            DriverShift.objects.select_for_update(of=('self',))
                            .select_related('truck', 'allocation__truck', 'schedule__dumpsite', 'allocation__schedule__dumpsite')
                            .filter(pk=shift_id)
                            .first()
                        )
                        if not shift:
                            return Response({'driver_shift_id': f'DriverShift #{shift_id} not found.'}, status=status.HTTP_404_NOT_FOUND)
                        if shift.driver_id != user.id:
                            return Response(
                                {'error': 'You may only submit inspections for your own DriverShift.'},
                                status=status.HTTP_403_FORBIDDEN,
                            )
                        auth_truck = shift.effective_truck
                        auth_dumpsite = shift.effective_dumpsite
                        if not auth_truck:
                            return Response(
                                {'error': 'DriverShift has no authoritative Truck associated.'},
                                status=status.HTTP_400_BAD_REQUEST,
                            )
                        if not auth_dumpsite:
                            return Response(
                                {'error': 'DriverShift schedule has no assigned Dumpsite.'},
                                status=status.HTTP_400_BAD_REQUEST,
                            )
                        if client_truck_id is not None and client_truck_id != auth_truck.id:
                            return Response(
                                {'truck_id': 'Supplied truck_id does not match the authoritative DriverShift truck.'},
                                status=status.HTTP_400_BAD_REQUEST,
                            )
                        if client_dumpsite_id is not None and client_dumpsite_id != auth_dumpsite.id:
                            return Response(
                                {'dumpsite_id': 'Supplied dumpsite_id does not match the authoritative DriverShift dumpsite.'},
                                status=status.HTTP_400_BAD_REQUEST,
                            )
                        target_truck_id = auth_truck.id
                        resolved_dumpsite_id = auth_dumpsite.id

                    elif not is_admin and role == UserRole.DUMPSITE:
                        facility_id = TruckService.get_operator_dumpsite_id(user)
                        if not facility_id:
                            return Response(
                                {'error': 'Assigned Dumpsite Operator role required.'},
                                status=status.HTTP_403_FORBIDDEN,
                            )
                        if client_dumpsite_id is not None and client_dumpsite_id != facility_id:
                            return Response(
                                {'error': 'Cross-Dumpsite access denied: cannot submit inspection for another facility.'},
                                status=status.HTTP_403_FORBIDDEN,
                            )
                        if shift_id is not None:
                            shift = (
                                DriverShift.objects.select_for_update(of=('self',))
                                .select_related('truck', 'allocation__truck', 'schedule__dumpsite', 'allocation__schedule__dumpsite')
                                .filter(pk=shift_id)
                                .first()
                            )
                            if not shift:
                                return Response({'driver_shift_id': f'DriverShift #{shift_id} not found.'}, status=status.HTTP_404_NOT_FOUND)
                            shift_ds = shift.effective_dumpsite
                            if shift_ds and shift_ds.id != facility_id:
                                return Response(
                                    {'error': 'Cross-Dumpsite access denied: DriverShift belongs to another facility.'},
                                    status=status.HTTP_403_FORBIDDEN,
                                )
                            auth_truck = shift.effective_truck
                            if not auth_truck:
                                return Response(
                                    {'error': 'DriverShift has no authoritative Truck associated.'},
                                    status=status.HTTP_400_BAD_REQUEST,
                                )
                            if client_truck_id is not None and client_truck_id != auth_truck.id:
                                return Response(
                                    {'truck_id': 'Supplied truck_id does not match the DriverShift truck.'},
                                    status=status.HTTP_400_BAD_REQUEST,
                                )
                            target_truck_id = auth_truck.id
                        else:
                            if client_truck_id is None:
                                return Response(
                                    {'error': 'truck_id or driver_shift_id is required.'},
                                    status=status.HTTP_400_BAD_REQUEST,
                                )
                            target_truck_id = client_truck_id
                        resolved_dumpsite_id = facility_id

                    elif is_admin:
                        if shift_id is not None:
                            shift = (
                                DriverShift.objects.select_for_update(of=('self',))
                                .select_related('truck', 'allocation__truck', 'schedule__dumpsite', 'allocation__schedule__dumpsite')
                                .filter(pk=shift_id)
                                .first()
                            )
                            if not shift:
                                return Response({'driver_shift_id': f'DriverShift #{shift_id} not found.'}, status=status.HTTP_404_NOT_FOUND)
                            auth_truck = shift.effective_truck
                            if not auth_truck:
                                return Response(
                                    {'error': 'DriverShift has no authoritative Truck associated.'},
                                    status=status.HTTP_400_BAD_REQUEST,
                                )
                            if client_truck_id is not None and client_truck_id != auth_truck.id:
                                return Response(
                                    {'truck_id': 'Supplied truck_id does not match the DriverShift truck.'},
                                    status=status.HTTP_400_BAD_REQUEST,
                                )
                            target_truck_id = auth_truck.id
                            shift_ds = shift.effective_dumpsite
                            resolved_dumpsite_id = client_dumpsite_id or (shift_ds.id if shift_ds else None)
                        else:
                            if client_truck_id is None:
                                return Response(
                                    {'error': 'truck_id or driver_shift_id is required.'},
                                    status=status.HTTP_400_BAD_REQUEST,
                                )
                            target_truck_id = client_truck_id
                            resolved_dumpsite_id = client_dumpsite_id
                    else:
                        return Response({'error': 'Forbidden.'}, status=status.HTTP_403_FORBIDDEN)

                    if shift_id is not None and target_truck_id != pre_truck_id:
                        raise _ConcurrentInspectionTruckChange()

                    if not locked_truck:
                        return Response({'truck_id': f'Truck #{target_truck_id} not found.'}, status=status.HTTP_404_NOT_FOUND)

                    if is_admin and resolved_dumpsite_id is None:
                        resolved_dumpsite_id = TruckService._resolve_truck_dumpsite_id(locked_truck)

                    if resolved_dumpsite_id is not None:
                        if not Dumpsite.objects.filter(pk=resolved_dumpsite_id).exists():
                            return Response({'dumpsite_id': f'Dumpsite #{resolved_dumpsite_id} not found.'}, status=status.HTTP_404_NOT_FOUND)

                    # Enforce operator facility access before creating inspection row
                    if not is_admin and role == UserRole.DUMPSITE:
                        try:
                            TruckService.require_admin_or_facility_operator(user, truck=locked_truck)
                        except DjangoPermissionDenied as e:
                            return Response({'error': str(e)}, status=status.HTTP_403_FORBIDDEN)

                    if locked_truck.is_retired:
                        return Response(
                            {'error': f'Truck {locked_truck.plate_number} is retired.', 'code': 'truck_retired'},
                            status=status.HTTP_409_CONFLICT,
                        )

                    inspection = DumpsiteTruckInspection.objects.create(
                        truck=locked_truck,
                        dumpsite_id=resolved_dumpsite_id,
                        driver_shift=shift,
                        submitted_by=user,
                        inspection_type=inspection_type,
                        inspection_state=inspection_state,
                        mechanical_condition=mechanical_condition,
                        notes=notes,
                        checklist_data=checklist_data,
                        hold_created=(inspection_state == 'FAILED'),
                    )

                    try:
                        TruckService.update_inspection_state(
                            locked_truck,
                            user=user,
                            inspection_state=inspection_state,
                            mechanical_condition=mechanical_condition,
                            reason=notes,
                            dumpsite_id=resolved_dumpsite_id,
                            driver_shift=shift,
                            inspection=inspection,
                        )
                    except DjangoPermissionDenied as e:
                        transaction.set_rollback(True)
                        return Response({'error': str(e)}, status=status.HTTP_403_FORBIDDEN)
                    except TruckLifecycleConflictError as e:
                        transaction.set_rollback(True)
                        return Response(
                            {'error': str(e.message if hasattr(e, 'message') else e), 'code': e.error_code},
                            status=status.HTTP_409_CONFLICT,
                        )
                    except DjangoValidationError as e:
                        transaction.set_rollback(True)
                        return Response(
                            e.message_dict if hasattr(e, 'message_dict') else {'error': str(e)},
                            status=status.HTTP_400_BAD_REQUEST,
                        )

                    inspection.refresh_from_db()
                    return Response(self.get_serializer(inspection).data, status=status.HTTP_201_CREATED)
            except _ConcurrentInspectionTruckChange:
                if attempt == max_attempts - 1:
                    return Response(
                        {'error': 'DriverShift truck association changed concurrently; please retry.'},
                        status=status.HTTP_409_CONFLICT,
                    )
