# Generated manually to move pickup proof images to Cloudinary.

from django.db import migrations
import cloudinary.models


class Migration(migrations.Migration):

    dependencies = [
        ('driver', '0011_trucklocation_add_accuracy'),
    ]

    operations = [
        migrations.AlterField(
            model_name='pickupstatus',
            name='photo_url',
            field=cloudinary.models.CloudinaryField(
                blank=True,
                null=True,
                verbose_name='collection proof',
            ),
        ),
    ]
