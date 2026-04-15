"""
accounts/views.py
-----------------
Handles user authentication: register, login, logout.

Design principle: each view does ONE thing.
  - register_view  → create account
  - login_view     → authenticate & start session
  - logout_view    → end session
"""

from django.shortcuts import render, redirect
from django.contrib.auth import authenticate, login, logout
from django.contrib import messages
from django.views.decorators.http import require_http_methods

from .forms import RegistrationForm, LoginForm


# ---------------------------------------------------------------------------
# Register
# ---------------------------------------------------------------------------
@require_http_methods(['GET', 'POST'])
def register_view(request):
    """
    GET  — Show empty registration form
    POST — Validate, create user, redirect to login
    """
    # Already logged in? Send them to the dashboard
    if request.user.is_authenticated:
        return redirect('watcher:dashboard')

    if request.method == 'POST':
        form = RegistrationForm(request.POST)
        if form.is_valid():
            user = form.save()
            messages.success(
                request,
                f'Account created for {user.full_name}! Please log in.'
            )
            return redirect('accounts:login')
        # Form invalid — re-render with errors
    else:
        form = RegistrationForm()

    return render(request, 'accounts/register.html', {'form': form})


# ---------------------------------------------------------------------------
# Login
# ---------------------------------------------------------------------------
@require_http_methods(['GET', 'POST'])
def login_view(request):
    """
    GET  — Show login form
    POST — Authenticate email + password, start session
    """
    if request.user.is_authenticated:
        return redirect('watcher:dashboard')

    if request.method == 'POST':
        form = LoginForm(request.POST)
        if form.is_valid():
            email    = form.cleaned_data['email']
            password = form.cleaned_data['password']

            # Django's authenticate() handles password hashing checks
            user = authenticate(request, email=email, password=password)

            if user is not None:
                login(request, user)
                # Redirect to the page they were trying to visit, or dashboard
                next_url = request.GET.get('next', 'watcher:dashboard')
                return redirect(next_url)
            else:
                messages.error(request, 'Invalid email or password.')
    else:
        form = LoginForm()

    return render(request, 'accounts/login.html', {'form': form})


# ---------------------------------------------------------------------------
# Logout
# ---------------------------------------------------------------------------
def logout_view(request):
    """End the user's session and redirect to login page."""
    logout(request)
    messages.info(request, 'You have been logged out.')
    return redirect('accounts:login')
