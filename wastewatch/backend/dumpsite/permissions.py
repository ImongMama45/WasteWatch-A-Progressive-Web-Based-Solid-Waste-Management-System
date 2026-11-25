from rest_framework import permissions

from accounts.models import UserRole
from accounts.permissions import IsAdminRole, is_admin_user


class IsAdminOrAssignedDumpsiteOperator(permissions.BasePermission):
    """
    Allows citywide Admins (`is_admin_user`) or Dumpsite Operators who are
    assigned to a facility (`TruckService.get_operator_dumpsite_id(user)`).
    Enforces exact facility ownership on object-level checks.
    """

    def has_permission(self, request, view):
        user = getattr(request, 'user', None)
        if not user or not user.is_authenticated:
            return False
        if is_admin_user(user):
            return True
        if getattr(user, 'role', None) == UserRole.DUMPSITE:
            from driver.truck_service import TruckService

            return TruckService.get_operator_dumpsite_id(user) is not None
        return False

    def has_object_permission(self, request, view, obj):
        user = getattr(request, 'user', None)
        if not user or not user.is_authenticated:
            return False
        if is_admin_user(user):
            return True
        if getattr(user, 'role', None) != UserRole.DUMPSITE:
            return False

        from driver.truck_service import TruckService
        from .models import Dumpsite

        facility_id = TruckService.get_operator_dumpsite_id(user)
        if not facility_id:
            return False

        if isinstance(obj, Dumpsite):
            return obj.id == facility_id
        if getattr(obj, 'dumpsite_id', None) is not None:
            return obj.dumpsite_id == facility_id
        sched = getattr(obj, 'schedule', None)
        if sched is not None:
            return sched.dumpsite_id == facility_id
        delivery = getattr(obj, 'delivery', None)
        if delivery is not None:
            return delivery.dumpsite_id == facility_id
        from driver.models import Truck
        target_truck = obj if isinstance(obj, Truck) else getattr(obj, 'truck', None)
        if target_truck is not None:
            if target_truck.hold_dumpsite_id and target_truck.hold_dumpsite_id != facility_id:
                return False
            return Truck.objects.filter(pk=target_truck.pk).filter(
                TruckService.facility_trucks_q(facility_id)
            ).exists()
        return False


class IsAssignedDumpsiteOperatorOnly(permissions.BasePermission):
    """
    Strictly restricts operational execution (such as physical truck arrival logging)
    to authenticated Dumpsite Operators assigned to the target facility.
    Admins, Staff, Drivers, and Citizens are denied.
    """

    def has_permission(self, request, view):
        user = getattr(request, 'user', None)
        if not user or not user.is_authenticated:
            return False
        # Citywide Admins and staff are explicitly disallowed from logging arrivals
        if is_admin_user(user):
            return False
        if getattr(user, 'role', None) != UserRole.DUMPSITE:
            return False
        from driver.truck_service import TruckService

        return TruckService.get_operator_dumpsite_id(user) is not None

    def has_object_permission(self, request, view, obj):
        user = getattr(request, 'user', None)
        if not user or not user.is_authenticated:
            return False
        if is_admin_user(user) or getattr(user, 'role', None) != UserRole.DUMPSITE:
            return False

        from driver.truck_service import TruckService
        from .models import Dumpsite

        facility_id = TruckService.get_operator_dumpsite_id(user)
        if not facility_id:
            return False

        if isinstance(obj, Dumpsite):
            return obj.id == facility_id
        if getattr(obj, 'dumpsite_id', None) is not None:
            return obj.dumpsite_id == facility_id
        sched = getattr(obj, 'schedule', None)
        if sched is not None:
            return sched.dumpsite_id == facility_id
        delivery = getattr(obj, 'delivery', None)
        if delivery is not None:
            return delivery.dumpsite_id == facility_id
        from driver.models import Truck
        target_truck = obj if isinstance(obj, Truck) else getattr(obj, 'truck', None)
        if target_truck is not None:
            if target_truck.hold_dumpsite_id and target_truck.hold_dumpsite_id != facility_id:
                return False
            return Truck.objects.filter(pk=target_truck.pk).filter(
                TruckService.facility_trucks_q(facility_id)
            ).exists()
        return False


__all__ = [
    'IsAdminRole',
    'IsAdminOrAssignedDumpsiteOperator',
    'IsAssignedDumpsiteOperatorOnly',
    'is_admin_user',
]
