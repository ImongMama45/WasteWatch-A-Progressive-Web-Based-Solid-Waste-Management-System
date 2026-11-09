"""
accounts/auth_flow_views.py
---------------------------
Authentication lifecycle views for Citizen email verification and password reset.
Non-citizen accounts (Admin, Watcher, Driver, Brgy Official, Dumpsite Operator)
are provisioned directly by system administrators.
"""

import logging
from django.utils import timezone
from django.core.cache import cache
from django.core import signing
from django.contrib.auth.password_validation import validate_password
from django.core.exceptions import ValidationError as DjangoValidationError
from django.utils.http import urlsafe_base64_decode
from django.utils.encoding import force_str

from rest_framework.decorators import api_view, permission_classes, authentication_classes
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework import status

from .models import User, UserRole
from .emails import (
    verify_verification_token,
    send_verification_email,
    send_password_reset_email,
    check_password_reset_token,
)

logger = logging.getLogger(__name__)

RESEND_COOLDOWN_SECONDS = 60
FORGOT_COOLDOWN_SECONDS = 60


# ── POST /api/auth/verify-email/ ──────────────────────────────────────────────
@api_view(['POST'])
@authentication_classes([])
@permission_classes([AllowAny])
def verify_email_view(request):
    """
    Verifies a user's email address using a cryptographic token.
    Payload: {"token": "..."}
    """
    token = request.data.get('token', '').strip()
    if not token:
        return Response({'error': 'Verification token is required.', 'code': 'invalid_token'}, status=status.HTTP_400_BAD_REQUEST)

    try:
        user_id, email = verify_verification_token(token)
    except signing.SignatureExpired:
        return Response({
            'error': 'This verification link has expired. Please request a new one.',
            'code': 'expired'
        }, status=status.HTTP_400_BAD_REQUEST)
    except (signing.BadSignature, Exception):
        return Response({
            'error': 'Invalid or malformed verification link.',
            'code': 'invalid'
        }, status=status.HTTP_400_BAD_REQUEST)

    try:
        user = User.objects.get(pk=user_id, email__iexact=email)
    except User.DoesNotExist:
        return Response({
            'error': 'Account not found.',
            'code': 'user_not_found'
        }, status=status.HTTP_404_NOT_FOUND)

    if not user.email_verified:
        user.email_verified = True
        user.email_verified_at = timezone.now()
        user.save(update_fields=['email_verified', 'email_verified_at'])

    return Response({
        'message': 'Your email has been verified successfully. You can now sign in.',
        'email': user.email,
        'verified': True,
    }, status=status.HTTP_200_OK)


# ── POST /api/auth/resend-verification/ ────────────────────────────────────────
@api_view(['POST'])
@authentication_classes([])
@permission_classes([AllowAny])
def resend_verification_view(request):
    """
    Re-sends the verification email to an unverified citizen account.
    Payload: {"email": "..."}
    """
    email = request.data.get('email', '').strip().lower()
    if not email:
        return Response({'error': 'Email address is required.'}, status=status.HTTP_400_BAD_REQUEST)

    # 60s cooldown per email
    cache_key = f"resend_verify_cooldown_{email}"
    if cache.get(cache_key):
        return Response({
            'error': 'Please wait a moment before requesting another verification email.',
            'code': 'rate_limited'
        }, status=status.HTTP_429_TOO_MANY_REQUESTS)

    cache.set(cache_key, True, RESEND_COOLDOWN_SECONDS)

    try:
        user = User.objects.filter(email__iexact=email, is_active=True).first()
        if user and not user.email_verified and user.role == UserRole.CITIZEN:
            send_verification_email(user)
    except Exception as exc:
        logger.error(f"Error in resend_verification_view for {email}: {exc}")

    # Generic success response to avoid email enumeration
    return Response({
        'message': 'If an unverified citizen account exists with this email, a verification link has been sent.',
        'cooldown_seconds': RESEND_COOLDOWN_SECONDS
    }, status=status.HTTP_200_OK)


# ── POST /api/auth/forgot-password/ ───────────────────────────────────────────
@api_view(['POST'])
@authentication_classes([])
@permission_classes([AllowAny])
def forgot_password_view(request):
    """
    Initiates password reset for Citizen accounts.
    Payload: {"email": "..."}
    Staff/Driver/Brgy Official accounts must contact their system administrator.
    """
    email = request.data.get('email', '').strip().lower()
    if not email:
        return Response({'error': 'Email address is required.'}, status=status.HTTP_400_BAD_REQUEST)

    # Cooldown per email
    cache_key = f"forgot_pw_cooldown_{email}"
    if cache.get(cache_key):
        return Response({
            'error': 'Please wait before requesting another password reset email.',
            'code': 'rate_limited'
        }, status=status.HTTP_429_TOO_MANY_REQUESTS)

    cache.set(cache_key, True, FORGOT_COOLDOWN_SECONDS)

    try:
        user = User.objects.filter(email__iexact=email, is_active=True).first()
        # Strictly for citizens; staff accounts must be managed by administrator
        if user and user.role == UserRole.CITIZEN:
            send_password_reset_email(user)
        elif user and user.role != UserRole.CITIZEN:
            logger.info(f"Non-citizen user ({user.role}) requested password reset via public endpoint.")
    except Exception as exc:
        logger.error(f"Error in forgot_password_view for {email}: {exc}")

    return Response({
        'message': 'If a citizen account matches that email address, password reset instructions have been sent.',
        'cooldown_seconds': FORGOT_COOLDOWN_SECONDS
    }, status=status.HTTP_200_OK)


# ── POST /api/auth/reset-password/ ────────────────────────────────────────────
@api_view(['POST'])
@authentication_classes([])
@permission_classes([AllowAny])
def reset_password_view(request):
    """
    Validates token and updates password for Citizen account.
    Payload: {"uid": "...", "token": "...", "password": "...", "password2": "..."}
    """
    uidb64 = request.data.get('uid', '').strip()
    token = request.data.get('token', '').strip()
    password = request.data.get('password', '')
    password2 = request.data.get('password2', '')

    if not uidb64 or not token:
        return Response({'error': 'Invalid or missing password reset link.', 'code': 'invalid_link'}, status=status.HTTP_400_BAD_REQUEST)

    if not password:
        return Response({'error': 'Password is required.'}, status=status.HTTP_400_BAD_REQUEST)

    if password != password2:
        return Response({'error': 'Passwords do not match.'}, status=status.HTTP_400_BAD_REQUEST)

    try:
        uid = force_str(urlsafe_base64_decode(uidb64))
        user = User.objects.get(pk=uid, is_active=True)
    except (TypeError, ValueError, OverflowError, User.DoesNotExist):
        return Response({'error': 'Invalid or expired password reset link.', 'code': 'invalid_link'}, status=status.HTTP_400_BAD_REQUEST)

    if user.role != UserRole.CITIZEN:
        return Response({
            'error': 'Password reset through this form is only available for citizen accounts. Please contact an administrator.',
            'code': 'role_unsupported'
        }, status=status.HTTP_403_FORBIDDEN)

    if not check_password_reset_token(user, token):
        return Response({'error': 'This password reset link is invalid or has expired.', 'code': 'invalid_link'}, status=status.HTTP_400_BAD_REQUEST)

    # Validate against Django password validators
    try:
        validate_password(password, user=user)
    except DjangoValidationError as err:
        return Response({'error': list(err.messages)[0]}, status=status.HTTP_400_BAD_REQUEST)

    user.set_password(password)
    # Resetting password also confirms email ownership
    if not user.email_verified:
        user.email_verified = True
        user.email_verified_at = timezone.now()
    user.save()

    return Response({
        'message': 'Password has been reset successfully. You can now log in with your new password.',
        'success': True
    }, status=status.HTTP_200_OK)

