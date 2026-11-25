from django.core.exceptions import ObjectDoesNotExist
from django.db.models import (
    Q, Exists, OuterRef, Subquery, BooleanField, ExpressionWrapper, Value
)
from django.db.models.functions import Coalesce
from rest_framework import status
from rest_framework.exceptions import APIException

from .models import NotificationReadReceipt, NotificationReceiptCutover


class ServiceUnavailableError(APIException):
    status_code = status.HTTP_503_SERVICE_UNAVAILABLE
    default_detail = 'Notification cutover timestamp has not been configured.'
    default_code = 'cutover_not_configured'


def get_cutover_at():
    """
    Retrieves the persisted cutover timestamp from the singleton record.
    Fails closed with HTTP 503 if the cutover timestamp has not been established.
    """
    try:
        return NotificationReceiptCutover.objects.get(pk=1).cutover_at
    except (NotificationReceiptCutover.DoesNotExist, ObjectDoesNotExist):
        raise ServiceUnavailableError()


def annotate_user_state(qs, user, cutover_at):
    """
    Single source of truth for annotating recipient read and archive state.
    Annotates:
      - _rcpt_exists: bool
      - _rcpt_read_at: datetime or None
      - _rcpt_archived: bool
      - _historical_shared: bool
    """
    rq = NotificationReadReceipt.objects.filter(
        notification=OuterRef('pk'),
        user=user,
    )
    return qs.annotate(
        _rcpt_exists=Exists(rq),
        _rcpt_read_at=Subquery(rq.values('read_at')[:1]),
        _rcpt_archived=Coalesce(Subquery(rq.values('is_archived')[:1]), Value(False)),
        _historical_shared=ExpressionWrapper(
            Q(user__isnull=True) & Q(created_at__lt=cutover_at),
            output_field=BooleanField(),
        ),
    )


def unread_filter_q():
    """
    Shared filter Q object matching effectively unread, non-archived notifications.
    """
    return Q(_rcpt_archived=False) & (
        Q(_rcpt_exists=True, _rcpt_read_at__isnull=True) |
        Q(_rcpt_exists=False, _historical_shared=False)
    )

