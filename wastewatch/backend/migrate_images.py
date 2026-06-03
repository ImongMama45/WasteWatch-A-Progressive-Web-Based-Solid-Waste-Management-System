import os
import django

def migrate_to_cloudinary():
    # Configure settings and setup Django BEFORE importing models
    os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'wastewatch.settings')
    django.setup()

    # Local imports to prevent early settings access
    from django.conf import settings
    from cloudinary.uploader import upload
    from watcher.models import GarbageReport

    reports = GarbageReport.objects.exclude(image__isnull=True).exclude(image='')
    
    for report in reports:
        # Check if already a Cloudinary URL
        image_str = str(report.image)
        if image_str.startswith('http'):
            print(f"Skipping report {report.id}, already on Cloudinary")
            continue
            
        local_path = os.path.join(settings.MEDIA_ROOT, image_str)
        if os.path.exists(local_path):
            print(f"Uploading {local_path} for report {report.id}...")
            try:
                result = upload(local_path, folder='reports/')
                # CloudinaryField expects the public_id
                report.image = result['public_id']
                report.save()
                print(f"Success: {result['public_id']}")
            except Exception as e:
                print(f"Failed to upload {local_path}: {e}")
        else:
            print(f"File not found: {local_path}")

if __name__ == '__main__':
    migrate_to_cloudinary()
