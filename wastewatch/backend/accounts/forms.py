"""
accounts/forms.py
-----------------
Registration and Login forms.

Keeping forms separate from views keeps each file focused and testable.
"""

from django import forms
from django.contrib.auth.forms import UserCreationForm, AuthenticationForm
from django.contrib.auth import authenticate

from .models import User, Barangay, UserRole


# ---------------------------------------------------------------------------
# Registration Form
# ---------------------------------------------------------------------------
class RegistrationForm(UserCreationForm):
    """
    Extends Django's built-in UserCreationForm.
    - Adds full_name, barangay
    - Hides the role field (role is set server-side to CITIZEN by default)
    - password1 / password2 come from UserCreationForm
    """

    full_name = forms.CharField(
        max_length=255,
        widget=forms.TextInput(attrs={
            'placeholder': 'Juan dela Cruz',
            'class': 'form-input',
        }),
    )

    email = forms.EmailField(
        widget=forms.EmailInput(attrs={
            'placeholder': 'juan@example.com',
            'class': 'form-input',
        }),
    )

    barangay = forms.ModelChoiceField(
        queryset=Barangay.objects.all(),
        required=True,
        empty_label='— Select your barangay —',
        error_messages={'required': 'Please select your barangay.'},
        widget=forms.Select(attrs={'class': 'form-input'}),
    )

    password1 = forms.CharField(
        label='Password',
        widget=forms.PasswordInput(attrs={
            'placeholder': '••••••••',
            'class': 'form-input',
        }),
    )

    password2 = forms.CharField(
        label='Confirm Password',
        widget=forms.PasswordInput(attrs={
            'placeholder': '••••••••',
            'class': 'form-input',
        }),
    )

    class Meta:
        model = User
        fields = ('full_name', 'email', 'barangay', 'password1', 'password2')

    def save(self, commit=True):
        user = super().save(commit=False)
        user.full_name = self.cleaned_data['full_name']
        user.barangay  = self.cleaned_data.get('barangay')
        # Role is always CITIZEN on public registration
        # Admins change roles via /admin/ panel
        user.role = UserRole.CITIZEN
        if commit:
            user.save()
        return user


# ---------------------------------------------------------------------------
# Login Form
# ---------------------------------------------------------------------------
class LoginForm(forms.Form):
    """
    Simple email + password form.
    We authenticate manually in the view using authenticate().
    """

    email = forms.EmailField(
        widget=forms.EmailInput(attrs={
            'placeholder': 'your@email.com',
            'class': 'form-input',
            'autofocus': True,
        }),
    )

    password = forms.CharField(
        widget=forms.PasswordInput(attrs={
            'placeholder': '••••••••',
            'class': 'form-input',
        }),
    )
