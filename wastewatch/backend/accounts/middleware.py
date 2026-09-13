from django.utils import timezone
from datetime import timedelta

SKIP_PATHS = ('/static/', '/admin/media/', '/favicon')
PERSONNEL_ROLES = ('watcher', 'brgy_official', 'driver')


class DisableApiCsrfMiddleware:
    """
    Disables CSRF enforcement for all /api/* routes.
    This is required for cross-domain deployments (e.g. Vercel frontend + Render backend)
    where the CSRF cookie cannot be reliably shared across origins.
    CORS + Session auth still protect these endpoints.
    """
    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        if request.path.startswith('/api/'):
            setattr(request, '_dont_enforce_csrf_checks', True)
        return self.get_response(request)


class UpdateLastActivityMiddleware:
    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        response = self.get_response(request)

        user = getattr(request, 'user', None)
        if not user or not user.is_authenticated:
            return response

        # Skip static assets and admin media
        if any(request.path.startswith(p) for p in SKIP_PATHS):
            return response

        # Only track personnel roles, not citizens or admins
        if getattr(user, 'role', None) not in PERSONNEL_ROLES:
            return response

        # Throttle: only write if null or last write was > 1 minute ago
        now = timezone.now()
        if not user.last_activity or \
           (now - user.last_activity) > timedelta(minutes=1):
            from django.contrib.auth import get_user_model
            User = get_user_model()
            User.objects.filter(pk=user.pk).update(last_activity=now)

        return response
