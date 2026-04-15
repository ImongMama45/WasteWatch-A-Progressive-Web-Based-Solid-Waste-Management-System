"""
watcher/forms.py
----------------
Forms for the Watcher module.
"""

from django import forms
from .models import GarbageReport, CollectionConfirmation


class ReportForm(forms.ModelForm):
    """
    Form for submitting a new garbage report.
    User and status are set by the view — not included here for security.
    """

    class Meta:
        model  = GarbageReport
        fields = [
            'barangay',
            'latitude',
            'longitude',
            'image',
            'issue_type',
            'severity',
            'description',
        ]
        widgets = {
            'barangay': forms.Select(attrs={'class': 'form-input'}),
            'latitude': forms.NumberInput(attrs={
                'class': 'form-input',
                'placeholder': '14.5995',
                'step': '0.000001',
            }),
            'longitude': forms.NumberInput(attrs={
                'class': 'form-input',
                'placeholder': '120.9842',
                'step': '0.000001',
            }),
            'issue_type':   forms.Select(attrs={'class': 'form-input'}),
            'severity':     forms.Select(attrs={'class': 'form-input'}),
            'description':  forms.Textarea(attrs={
                'class': 'form-input',
                'rows': 4,
                'placeholder': 'Describe the garbage issue...',
            }),
        }


class CollectionConfirmationForm(forms.ModelForm):
    """
    Form for confirming a truck collection at a site.
    """

    class Meta:
        model  = CollectionConfirmation
        fields = ['barangay', 'report', 'latitude', 'longitude', 'notes']
        widgets = {
            'barangay':  forms.Select(attrs={'class': 'form-input'}),
            'report':    forms.Select(attrs={'class': 'form-input'}),
            'latitude':  forms.NumberInput(attrs={'class': 'form-input', 'step': '0.000001'}),
            'longitude': forms.NumberInput(attrs={'class': 'form-input', 'step': '0.000001'}),
            'notes':     forms.Textarea(attrs={'class': 'form-input', 'rows': 3}),
        }
