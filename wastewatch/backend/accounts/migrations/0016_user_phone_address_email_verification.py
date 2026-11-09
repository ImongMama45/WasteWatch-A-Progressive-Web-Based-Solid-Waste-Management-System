from django.db import migrations, models
from django.utils import timezone


def verify_existing_users(apps, schema_editor):
    User = apps.get_model('accounts', 'User')
    now = timezone.now()
    User.objects.filter(email_verified=False).update(
        email_verified=True,
        email_verified_at=now,
    )


def reverse_noop(apps, schema_editor):
    pass


class Migration(migrations.Migration):

    dependencies = [
        ('accounts', '0015_pointtransaction_escalation_suspensionoverride'),
    ]

    operations = [
        migrations.AddField(
            model_name='user',
            name='phone_number',
            field=models.CharField(
                blank=True,
                default='',
                help_text='Contact number for citizen notifications and collection coordination.',
                max_length=20,
            ),
        ),
        migrations.AddField(
            model_name='user',
            name='address_line',
            field=models.CharField(
                blank=True,
                default='',
                help_text='Street, Purok, or house number within the selected barangay.',
                max_length=255,
            ),
        ),
        migrations.AddField(
            model_name='user',
            name='email_verified',
            field=models.BooleanField(
                default=False,
                help_text="True if the user's email address has been verified.",
            ),
        ),
        migrations.AddField(
            model_name='user',
            name='email_verified_at',
            field=models.DateTimeField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name='user',
            name='terms_accepted_at',
            field=models.DateTimeField(blank=True, null=True),
        ),
        migrations.RunPython(verify_existing_users, reverse_noop),
    ]

