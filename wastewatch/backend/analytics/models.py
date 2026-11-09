from django.db import models
from django.conf import settings


class ActivityLog(models.Model):
    ACTION_CHOICES = [
        ('create', 'Create'),
        ('update', 'Update'),
        ('delete', 'Delete'),
        ('system', 'System'),
    ]

    admin = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True)
    action = models.CharField(max_length=10, choices=ACTION_CHOICES)
    module = models.CharField(max_length=50) # e.g., Users, Trucks
    details = models.TextField()
    timestamp = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-timestamp']

    def __str__(self):
        return f"{self.action} on {self.module} at {self.timestamp}"


class ShadowForecastPrediction(models.Model):
    """
    Stores offline / shadow evaluations comparing candidate Ridge ML predictions against
    the authoritative seasonal heuristic and forward actual weighbridge measurements.
    (Audit Remediation N-04, Directive Phase 4)
    """
    origin_date = models.DateField(db_index=True)
    target_date = models.DateField(db_index=True)
    horizon_step = models.PositiveSmallIntegerField()
    barangay = models.ForeignKey(
        'accounts.Barangay',
        on_delete=models.CASCADE,
        null=True,
        blank=True,
        related_name='shadow_forecasts'
    )  # null indicates City-Wide series
    series_id = models.CharField(max_length=60, default='city', db_index=True)

    model_type = models.CharField(max_length=50, default='heuristic')
    model_version = models.CharField(max_length=100, db_index=True)

    # Ridge ML predictions (null when running in heuristic-only shadow mode)
    expected_kg = models.FloatField(null=True, blank=True)
    low_kg = models.FloatField(null=True, blank=True, default=0.0)
    high_kg = models.FloatField(null=True, blank=True, default=0.0)

    # Heuristic baseline predictions for identical origin and target
    heuristic_expected_kg = models.FloatField()
    heuristic_low_kg = models.FloatField(default=0.0)
    heuristic_high_kg = models.FloatField(default=0.0)

    # Provenance and metadata
    is_backfill = models.BooleanField(default=False, db_index=True)
    training_cutoff = models.DateField(null=True, blank=True)
    genuine_record_count = models.IntegerField(default=0)
    prediction_provenance = models.JSONField(default=dict, blank=True)

    # Forward actual outcome joined when available
    actual_kg = models.FloatField(null=True, blank=True)
    actual_recorded_at = models.DateTimeField(null=True, blank=True)
    actual_data_status = models.CharField(max_length=50, default='PENDING', db_index=True)
    is_actual_complete = models.BooleanField(default=False, db_index=True)

    # Supersession tracking (append-only governance)
    is_superseded = models.BooleanField(default=False, db_index=True)
    superseded_by = models.ForeignKey(
        'self',
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name='supersedes'
    )

    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['origin_date', 'horizon_step']
        constraints = [
            models.UniqueConstraint(
                fields=['origin_date', 'target_date', 'horizon_step', 'series_id', 'model_version'],
                name='unique_shadow_forecast_prediction'
            )
        ]

    def save(self, *args, **kwargs):
        # Automatically synchronize series_id
        if self.barangay_id:
            self.series_id = f"brgy_{self.barangay_id}"
        else:
            self.series_id = "city"

        # Immutability enforcement: prediction fields cannot be mutated once persisted
        if self.pk:
            orig = ShadowForecastPrediction.objects.get(pk=self.pk)
            immutable_fields = [
                'origin_date', 'target_date', 'horizon_step', 'series_id',
                'model_version', 'expected_kg', 'heuristic_expected_kg'
            ]
            for field in immutable_fields:
                if getattr(orig, field) != getattr(self, field):
                    raise ValueError(
                        f"ShadowForecastPrediction record is immutable. Cannot mutate field '{field}' on pk={self.pk}. "
                        "Create a supersession record instead."
                    )
        super().save(*args, **kwargs)

    def __str__(self):
        target = self.barangay.name if self.barangay else "City-Wide"
        pred_str = f"{self.expected_kg:.1f}kg" if self.expected_kg is not None else "N/A (Heuristic only)"
        return f"Shadow [{self.model_version}] {target} H={self.horizon_step} ({self.origin_date} -> {self.target_date}): Pred={pred_str}"
