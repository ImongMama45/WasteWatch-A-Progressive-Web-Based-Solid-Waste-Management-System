from django.db import models
from django.contrib.auth import get_user_model
from django.db.models.signals import post_save
from django.dispatch import receiver
from cloudinary.models import CloudinaryField

User = get_user_model()

class DumpsiteType(models.TextChoices):
    LANDFILL = 'landfill', 'Landfill'
    DUMPSITE = 'dumpsite', 'Open Dumpsite'
    TRANSFER = 'transfer', 'Transfer Station'
    COMPOSTING = 'composting', 'Composting Area'

class Dumpsite(models.Model):
    name = models.CharField(max_length=100)
    type = models.CharField(max_length=20, choices=DumpsiteType.choices, default=DumpsiteType.DUMPSITE)
    barangay = models.ForeignKey('accounts.Barangay', on_delete=models.CASCADE, related_name='dumpsites')
    capacity_used = models.IntegerField(default=0) # 0-100% (legacy percentage field)
    notes = models.TextField(blank=True)
    latitude = models.DecimalField(max_digits=9, decimal_places=6)
    longitude = models.DecimalField(max_digits=9, decimal_places=6)
    max_capacity_kg = models.DecimalField(
        max_digits=10, decimal_places=2, default=50000.00,
        help_text="Total site capacity in kg."
    )
    current_fill_kg = models.DecimalField(
        max_digits=10, decimal_places=2, default=0.00,
        help_text="Running total of KG received. Incremented on each log_arrival POST."
    )
    operator = models.OneToOneField(
        'accounts.User', on_delete=models.SET_NULL, null=True, blank=True,
        related_name='operated_dumpsite',
        limit_choices_to={'role': 'dumpsite'},
        help_text="The linked dumpsite operator account."
    )

    def __str__(self):
        return self.name

    @property
    def fill_percent(self):
        if self.max_capacity_kg:
            return round((float(self.current_fill_kg) / float(self.max_capacity_kg)) * 100, 1)
        return 0.0

class WasteDelivery(models.Model):
    FILL_LEVELS = [
        ('nearly_empty',    'Nearly Empty (0–25%)'),
        ('quarter',         'Quarter (26–50%)'),
        ('half',            'Half (51–75%)'),
        ('three_quarters',  'Three Quarters (76–99%)'),
        ('full',            'Full (100%)'),
        ('overflowing',     'Overflowing (100%+)'),
    ]

    truck             = models.ForeignKey('driver.Truck',    on_delete=models.PROTECT, related_name='deliveries')
    driver            = models.ForeignKey(
        User, on_delete=models.PROTECT, related_name='deliveries_as_driver',
        limit_choices_to={'role': 'driver'},
    )
    dumpsite          = models.ForeignKey(Dumpsite, on_delete=models.PROTECT, related_name='deliveries')
    dumpsite_operator = models.ForeignKey(
        User, on_delete=models.SET_NULL, null=True, blank=True,
        related_name='deliveries_received',
        limit_choices_to={'role': 'dumpsite'},
    )

    schedule        = models.ForeignKey(
        'driver.CollectionSchedule', on_delete=models.SET_NULL,
        null=True, blank=True, related_name='deliveries',
    )
    crew_assignment = models.ForeignKey(
        'driver.TruckCrewAssignment', on_delete=models.SET_NULL,
        null=True, blank=True, related_name='deliveries',
    )

    date         = models.DateField()
    arrival_time = models.TimeField(null=True, blank=True)

    gross_weight  = models.DecimalField(max_digits=10, decimal_places=2, default=0)
    tare_weight   = models.DecimalField(max_digits=10, decimal_places=2, default=0)
    net_weight    = models.DecimalField(max_digits=10, decimal_places=2, editable=False, default=0)
    estimated_kg  = models.DecimalField(
        max_digits=10, decimal_places=2, default=0,
        help_text="Operator-estimated KG from fill level slider."
    )

    fill_level = models.CharField(max_length=20, choices=FILL_LEVELS, blank=True)

    photo = CloudinaryField('arrival proof', folder='dumpsite-arrivals/', null=True, blank=True)

    barangays = models.ManyToManyField(
        'accounts.Barangay', blank=True, related_name='waste_deliveries',
    )

    remarks      = models.TextField(blank=True)
    is_validated = models.BooleanField(default=False, help_text='Dumpsite operator confirmed this record')
    created_at   = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering        = ['-date', '-arrival_time']
        verbose_name    = 'Waste Delivery'
        verbose_name_plural = 'Waste Deliveries'

    def save(self, *args, **kwargs):
        self.net_weight = self.gross_weight - self.tare_weight
        super().save(*args, **kwargs)

    def __str__(self):
        return f"{self.truck} → {self.dumpsite} | {self.date} | {self.estimated_kg} kg"


class TruckFillEstimate(models.Model):
    FILL_LEVELS = [
        ('nearly_empty',    'Nearly Empty'),
        ('quarter',         'Quarter'),
        ('half',            'Half'),
        ('three_quarters',  'Three Quarters'),
        ('full',            'Full'),
        ('overflowing',     'Overflowing'),
    ]
    truck        = models.ForeignKey('driver.Truck', on_delete=models.CASCADE, related_name='fill_estimates')
    fill_level   = models.CharField(max_length=20, choices=FILL_LEVELS)
    estimated_kg = models.DecimalField(max_digits=8, decimal_places=2)
    is_custom    = models.BooleanField(
        default=False,
        help_text="If True, admin manually set this value — skip auto-recalculation."
    )

    class Meta:
        unique_together = ('truck', 'fill_level')
        ordering = ['truck', 'fill_level']

    def __str__(self):
        return f"{self.truck.plate_number} — {self.fill_level}: {self.estimated_kg} kg"

class DumpsiteIncident(models.Model):
    REASONS = [
        ('contaminated_load',  'Contaminated Load'),
        ('wrong_barangay',     'Wrong Barangay'),
        ('missing_crew',       'Missing Crew'),
        ('weight_discrepancy', 'Weight Discrepancy'),
        ('other',              'Other'),
    ]
    delivery    = models.ForeignKey(WasteDelivery, on_delete=models.CASCADE, related_name='incidents')
    reason      = models.CharField(max_length=30, choices=REASONS)
    notes       = models.TextField(blank=True)
    reported_by = models.ForeignKey(
        User, on_delete=models.SET_NULL, null=True, related_name='reported_incidents'
    )
    timestamp   = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-timestamp']

    def __str__(self):
        return f"Incident on delivery {self.delivery_id}: {self.reason}"

FILL_LEVEL_MULTIPLIERS = {
    'nearly_empty':   0.12,
    'quarter':        0.35,
    'half':           0.65,
    'three_quarters': 0.80,
    'full':           1.00,
    'overflowing':    1.10,
}

@receiver(post_save, sender='driver.Truck')
def sync_fill_estimates(sender, instance, created, **kwargs):
    for level, multiplier in FILL_LEVEL_MULTIPLIERS.items():
        obj, was_created = TruckFillEstimate.objects.get_or_create(
            truck=instance,
            fill_level=level,
            defaults={'estimated_kg': round(float(instance.max_capacity_kg) * multiplier, 2)}
        )
        if not was_created and not obj.is_custom:
            obj.estimated_kg = round(float(instance.max_capacity_kg) * multiplier, 2)
            obj.save(update_fields=['estimated_kg'])
