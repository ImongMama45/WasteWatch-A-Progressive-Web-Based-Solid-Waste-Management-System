"""
WasteWatch Django Settings
--------------------------
Core configuration for the WasteWatch waste management system.
"""

from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent

SECRET_KEY = 'django-insecure-change-this-in-production-use-env-variable'

DEBUG = True

ALLOWED_HOSTS = ['*']

# ---------------------------------------------------------------------------
# Application definition
# ---------------------------------------------------------------------------
INSTALLED_APPS = [
    'django.contrib.admin',
    'django.contrib.auth',
    'django.contrib.contenttypes',
    'django.contrib.sessions',
    'django.contrib.messages',
    'django.contrib.staticfiles',

    # Third-party
    'corsheaders',          # Allow React frontend to talk to Django

    # WasteWatch apps
    'accounts',             # Custom user model + auth
    'watcher',              # Report submission, collection confirmation
]

MIDDLEWARE = [
    'corsheaders.middleware.CorsMiddleware',   # Must be first
    'django.middleware.security.SecurityMiddleware',
    'django.contrib.sessions.middleware.SessionMiddleware',
    'django.middleware.common.CommonMiddleware',
    'django.middleware.csrf.CsrfViewMiddleware',
    'django.contrib.auth.middleware.AuthenticationMiddleware',
    'django.contrib.messages.middleware.MessageMiddleware',
    'django.middleware.clickjacking.XFrameOptionsMiddleware',
]

ROOT_URLCONF = 'wastewatch.urls'

TEMPLATES = [
    {
        'BACKEND': 'django.template.backends.django.DjangoTemplates',
        'DIRS': [BASE_DIR / 'templates'],
        'APP_DIRS': True,
        'OPTIONS': {
            'context_processors': [
                'django.template.context_processors.debug',
                'django.template.context_processors.request',
                'django.contrib.auth.context_processors.auth',
                'django.contrib.messages.context_processors.messages',
            ],
        },
    },
]

WSGI_APPLICATION = 'wastewatch.wsgi.application'

# ---------------------------------------------------------------------------
# Database — PostgreSQL
# ---------------------------------------------------------------------------
DATABASES = {
    'default': {
        'ENGINE': 'django.db.backends.postgresql',
        'NAME': 'wastewatch_db',
        'USER': 'wastewatch_user',
        'PASSWORD': 'taequert123',    
        'HOST': 'localhost',
        'PORT': '5432',
    }
}

# ---------------------------------------------------------------------------
# Custom User Model — tells Django to use our accounts.User instead of default
# ---------------------------------------------------------------------------
AUTH_USER_MODEL = 'accounts.User'

# ---------------------------------------------------------------------------
#                           Password validation
# ---------------------------------------------------------------------------
AUTH_PASSWORD_VALIDATORS = [
    {'NAME': 'django.contrib.auth.password_validation.UserAttributeSimilarityValidator'},
    {'NAME': 'django.contrib.auth.password_validation.MinimumLengthValidator'},
    {'NAME': 'django.contrib.auth.password_validation.CommonPasswordValidator'},
    {'NAME': 'django.contrib.auth.password_validation.NumericPasswordValidator'},
]
# ---------------------------------------------------------------------------
#                           Internationalization
# ---------------------------------------------------------------------------
LANGUAGE_CODE = 'en-us'
TIME_ZONE = 'Asia/Manila'
USE_I18N = True
USE_TZ = True

# ---------------------------------------------------------------------------
#                           Static & Media files
# ---------------------------------------------------------------------------
STATIC_URL = '/static/'
STATIC_ROOT = BASE_DIR / 'staticfiles'

MEDIA_URL = '/media/'
MEDIA_ROOT = BASE_DIR / 'media'   # Where uploaded report images are saved

# ---------------------------------------------------------------------------
# Default primary key
# ---------------------------------------------------------------------------
DEFAULT_AUTO_FIELD = 'django.db.models.BigAutoField'

# ---------------------------------------------------------------------------
# Dynamic LAN IP detection for mobile/network testing
# ---------------------------------------------------------------------------
import socket
def get_lan_ip():
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("8.8.8.8", 80)) # Connect to an external IP to find local IP route
        ip = s.getsockname()[0]
        s.close()
        return ip
    except Exception:
        return None

lan_ip = get_lan_ip()

# ---------------------------------------------------------------------------
# CORS — allow React Vite dev server to call Django API
# ---------------------------------------------------------------------------
CORS_ALLOWED_ORIGINS = [
    'http://localhost:3000',   # Vite default dev port
    'http://127.0.0.1:3000',
    'https://localhost:3000',
    'https://127.0.0.1:3000',
]
if lan_ip:
    CORS_ALLOWED_ORIGINS.append(f'http://{lan_ip}:3000')
    CORS_ALLOWED_ORIGINS.append(f'https://{lan_ip}:3000')

CORS_ALLOW_CREDENTIALS = True   # Needed for session-based auth

CSRF_TRUSTED_ORIGINS = [
    'http://localhost:3000',
    'http://127.0.0.1:3000',
    'https://localhost:3000',
    'https://127.0.0.1:3000',
]
if lan_ip:
    CSRF_TRUSTED_ORIGINS.append(f'http://{lan_ip}:3000')
    CSRF_TRUSTED_ORIGINS.append(f'https://{lan_ip}:3000')

# ---------------------------------------------------------------------------
# Session config
# ---------------------------------------------------------------------------
# No LOGIN_URL / REDIRECT settings — the backend is API-only.
# All auth is handled by the React frontend via /api/auth/login/ etc.
# Unauthenticated API requests return HTTP 401 JSON, not a redirect.