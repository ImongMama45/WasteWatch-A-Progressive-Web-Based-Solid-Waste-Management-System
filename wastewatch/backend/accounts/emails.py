"""
accounts/emails.py
------------------
Email generation and dispatching for account verification and password reset.
Follows iconography rules: NO emojis in email templates.
"""

import sys
import threading
import logging
from django.conf import settings
from django.core.mail import send_mail
from django.core import signing
from django.contrib.auth.tokens import default_token_generator
from django.utils.http import urlsafe_base64_encode, urlsafe_base64_decode
from django.utils.encoding import force_bytes, force_str

logger = logging.getLogger(__name__)

VERIFY_EMAIL_SALT = 'wastewatch.verify-email'
VERIFY_EMAIL_MAX_AGE = 86400 * 3  # 3 days


def _is_testing():
    """Check if code is running in automated tests where synchronous execution is required."""
    if 'test' in sys.argv:
        return True
    if getattr(settings, 'EMAIL_BACKEND', '').endswith('locmem.EmailBackend'):
        return True
    return False


def _dispatch_email(subject, plain_message, html_message, recipient_list, recipient_email, action_url, action_label):
    """
    Sends email asynchronously in a background thread to prevent blocking
    the HTTP request/response cycle, while keeping test runs synchronous.
    """
    def _worker():
        try:
            send_mail(
                subject=subject,
                message=plain_message,
                from_email=settings.DEFAULT_FROM_EMAIL,
                recipient_list=recipient_list,
                html_message=html_message,
                fail_silently=False,
            )
            logger.info(f"Successfully delivered {action_label} email to {recipient_email}")
        except Exception as e:
            logger.error(f"Failed to send {action_label} email to {recipient_email}: {e}", exc_info=True)
            print(f"\n[EMAIL DELIVERY NOTICE] SMTP delivery to {recipient_email} failed: {e}")
            print(f"[{action_label.upper()} LINK] {action_url}\n")

    if _is_testing():
        _worker()
    else:
        # Offload SMTP network latency to background daemon thread for near-instant API response
        thread = threading.Thread(target=_worker, name=f"email-sender-{action_label}", daemon=True)
        thread.start()


def generate_verification_token(user) -> str:
    """Generate a signed cryptographic token for email verification."""
    payload = {
        'uid': user.pk,
        'email': user.email.lower(),
    }
    return signing.dumps(payload, salt=VERIFY_EMAIL_SALT)


def verify_verification_token(token: str):
    """
    Decodes and validates a verification token.
    Returns (user_id, email) or raises signing.BadSignature / signing.SignatureExpired.
    """
    payload = signing.loads(token, salt=VERIFY_EMAIL_SALT, max_age=VERIFY_EMAIL_MAX_AGE)
    return payload.get('uid'), payload.get('email')


def generate_password_reset_token(user):
    """Generate uidb64 and token for Django default password reset."""
    uid = urlsafe_base64_encode(force_bytes(user.pk))
    token = default_token_generator.make_token(user)
    return uid, token


def check_password_reset_token(user, token: str) -> bool:
    """Verify password reset token for user."""
    return default_token_generator.check_token(user, token)


def get_frontend_url() -> str:
    url = getattr(settings, 'FRONTEND_URL', None) or 'http://localhost:3000'
    return url.rstrip('/')


def send_verification_email(user) -> bool:
    """Send an email verification link to a newly registered citizen."""
    try:
        token = generate_verification_token(user)
        verify_url = f"{get_frontend_url()}/verify-email?token={token}"
        recipient_name = user.full_name or user.first_name or "Citizen"

        subject = "WasteWatch Lucena - Please Verify Your Email Address"
        plain_message = (
            f"Hello {recipient_name},\n\n"
            f"Thank you for registering for WasteWatch Lucena City.\n\n"
            f"Please verify your email address by opening the following link:\n"
            f"{verify_url}\n\n"
            f"This link will expire in 3 days. If you did not create this account, please disregard this email.\n\n"
            f"WasteWatch Solid Waste Management System\n"
            f"Lucena City, Philippines\n"
        )

        html_message = f"""
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Verify Your Email</title>
</head>
<body style="margin: 0; padding: 24px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #f4f6f8; color: #1c252e;">
  <table width="100%" border="0" cellspacing="0" cellpadding="0" style="max-width: 580px; margin: 0 auto; background-color: #ffffff; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 16px rgba(0,0,0,0.06);">
    <tr>
      <td style="background-color: #2e7d32; padding: 28px 32px; text-align: left;">
        <h1 style="margin: 0; color: #ffffff; font-size: 22px; font-weight: 700; letter-spacing: -0.5px;">WasteWatch Lucena</h1>
        <p style="margin: 4px 0 0; color: #c8e6c9; font-size: 13px;">Solid Waste Management & Citizen Portal</p>
      </td>
    </tr>
    <tr>
      <td style="padding: 32px;">
        <h2 style="margin: 0 0 16px; font-size: 18px; color: #1c252e;">Verify your email address</h2>
        <p style="margin: 0 0 16px; font-size: 14px; line-height: 1.6; color: #4b5563;">
          Hello <strong>{recipient_name}</strong>,
        </p>
        <p style="margin: 0 0 24px; font-size: 14px; line-height: 1.6; color: #4b5563;">
          Thank you for joining WasteWatch Lucena. To activate your citizen account and start submitting community waste reports and collection updates, please confirm your email address below.
        </p>
        <div style="text-align: center; margin: 30px 0;">
          <a href="{verify_url}" style="display: inline-block; background-color: #2e7d32; color: #ffffff; text-decoration: none; padding: 12px 28px; border-radius: 24px; font-size: 14px; font-weight: 600; box-shadow: 0 4px 12px rgba(46,125,50,0.3);">
            Verify Email Address
          </a>
        </div>
        <p style="margin: 24px 0 8px; font-size: 12px; line-height: 1.5; color: #6b7280;">
          If the button above does not work, copy and paste this link into your browser:
        </p>
        <p style="margin: 0 0 24px; font-size: 12px; line-height: 1.4; color: #2e7d32; word-break: break-all;">
          <a href="{verify_url}" style="color: #2e7d32;">{verify_url}</a>
        </p>
        <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 24px 0;" />
        <p style="margin: 0; font-size: 12px; color: #9ca3af; line-height: 1.5;">
          This link expires in 3 days. If you did not create an account with WasteWatch Lucena, please ignore this email.
        </p>
      </td>
    </tr>
  </table>
</body>
</html>
"""
        _dispatch_email(
            subject=subject,
            plain_message=plain_message,
            html_message=html_message,
            recipient_list=[user.email],
            recipient_email=user.email,
            action_url=verify_url,
            action_label="Verify Email"
        )
        return True
    except Exception as e:
        logger.error(f"Failed to prepare verification email for {user.email}: {e}", exc_info=True)
        return False


def send_password_reset_email(user) -> bool:
    """Send password reset link to citizen user."""
    try:
        uid, token = generate_password_reset_token(user)
        reset_url = f"{get_frontend_url()}/reset-password?uid={uid}&token={token}"
        recipient_name = user.full_name or user.first_name or "Citizen"

        subject = "WasteWatch Lucena - Password Reset Request"
        plain_message = (
            f"Hello {recipient_name},\n\n"
            f"We received a request to reset your password for WasteWatch Lucena.\n\n"
            f"You can reset your password using the following link:\n"
            f"{reset_url}\n\n"
            f"This link is valid for 1 hour. If you did not request a password reset, you can safely ignore this email.\n\n"
            f"WasteWatch Solid Waste Management System\n"
            f"Lucena City, Philippines\n"
        )

        html_message = f"""
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Reset Your Password</title>
</head>
<body style="margin: 0; padding: 24px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #f4f6f8; color: #1c252e;">
  <table width="100%" border="0" cellspacing="0" cellpadding="0" style="max-width: 580px; margin: 0 auto; background-color: #ffffff; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 16px rgba(0,0,0,0.06);">
    <tr>
      <td style="background-color: #2e7d32; padding: 28px 32px; text-align: left;">
        <h1 style="margin: 0; color: #ffffff; font-size: 22px; font-weight: 700; letter-spacing: -0.5px;">WasteWatch Lucena</h1>
        <p style="margin: 4px 0 0; color: #c8e6c9; font-size: 13px;">Solid Waste Management & Citizen Portal</p>
      </td>
    </tr>
    <tr>
      <td style="padding: 32px;">
        <h2 style="margin: 0 0 16px; font-size: 18px; color: #1c252e;">Reset your password</h2>
        <p style="margin: 0 0 16px; font-size: 14px; line-height: 1.6; color: #4b5563;">
          Hello <strong>{recipient_name}</strong>,
        </p>
        <p style="margin: 0 0 24px; font-size: 14px; line-height: 1.6; color: #4b5563;">
          We received a request to reset the password for your citizen account. Click the button below to choose a new password.
        </p>
        <div style="text-align: center; margin: 30px 0;">
          <a href="{reset_url}" style="display: inline-block; background-color: #2e7d32; color: #ffffff; text-decoration: none; padding: 12px 28px; border-radius: 24px; font-size: 14px; font-weight: 600; box-shadow: 0 4px 12px rgba(46,125,50,0.3);">
            Reset Password
          </a>
        </div>
        <p style="margin: 24px 0 8px; font-size: 12px; line-height: 1.5; color: #6b7280;">
          If the button above does not work, copy and paste this link into your browser:
        </p>
        <p style="margin: 0 0 24px; font-size: 12px; line-height: 1.4; color: #2e7d32; word-break: break-all;">
          <a href="{reset_url}" style="color: #2e7d32;">{reset_url}</a>
        </p>
        <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 24px 0;" />
        <p style="margin: 0; font-size: 12px; color: #9ca3af; line-height: 1.5;">
          This link will expire in 1 hour. If you did not request a password reset, please disregard this email. Your password will remain unchanged.
        </p>
      </td>
    </tr>
  </table>
</body>
</html>
"""
        _dispatch_email(
            subject=subject,
            plain_message=plain_message,
            html_message=html_message,
            recipient_list=[user.email],
            recipient_email=user.email,
            action_url=reset_url,
            action_label="Reset Password"
        )
        return True
    except Exception as e:
        logger.error(f"Failed to prepare password reset email for {user.email}: {e}", exc_info=True)
        return False
