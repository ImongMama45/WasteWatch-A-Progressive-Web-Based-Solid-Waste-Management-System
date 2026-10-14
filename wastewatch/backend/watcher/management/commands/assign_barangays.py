import json
import os
from django.core.management.base import BaseCommand
from watcher.models import GarbageReport
from accounts.models import Barangay
from django.conf import settings

def point_in_polygon(x, y, poly):
    n = len(poly)
    inside = False
    p1x, p1y = poly[0]
    for i in range(1, n + 1):
        p2x, p2y = poly[i % n]
        if y > min(p1y, p2y):
            if y <= max(p1y, p2y):
                if x <= max(p1x, p2x):
                    xinters = None
                    if p1y != p2y:
                        xinters = (y - p1y) * (p2x - p1x) / (p2y - p1y) + p1x
                    if p1x == p2x or (xinters is not None and x <= xinters):
                        inside = not inside
        p1x, p1y = p2x, p2y
    return inside

def point_in_multi_polygon(x, y, multipoly):
    for poly in multipoly:
        outer_ring = poly[0]
        # Ignore holes for now, they are technically in poly[1:]
        # but for barangay administrative boundaries, holes are practically non-existent.
        # If we wanted to, we'd do:
        # in_outer = point_in_polygon(x, y, outer_ring)
        # in_hole = any(point_in_polygon(x, y, hole) for hole in poly[1:])
        # if in_outer and not in_hole: return True
        if point_in_polygon(x, y, outer_ring):
            in_hole = False
            for hole in poly[1:]:
                if point_in_polygon(x, y, hole):
                    in_hole = True
                    break
            if not in_hole:
                return True
    return False

class Command(BaseCommand):
    help = 'Assigns null barangay reports based on their latitude and longitude'

    def add_arguments(self, parser):
        parser.add_argument(
            '--dry-run',
            action='store_true',
            help='Log intended assignments without saving to the database',
        )

    def handle(self, *args, **options):
        dry_run = options['dry_run']
        # Path to geojson
        base_dir = settings.BASE_DIR
        frontend_dir = os.path.join(os.path.dirname(base_dir), 'frontend', 'public', 'data')
        geojson_path = os.path.join(frontend_dir, 'lucena_barangays.geojson')
        
        if not os.path.exists(geojson_path):
            self.stdout.write(self.style.ERROR(f"GeoJSON file not found at {geojson_path}"))
            return
            
        with open(geojson_path, 'r', encoding='utf-8') as f:
            geojson = json.load(f)
            
        brgy_features = []
        for feature in geojson.get('features', []):
            name = feature.get('properties', {}).get('brgy_name') or feature.get('properties', {}).get('name')
            geom = feature.get('geometry')
            if name and geom:
                brgy_features.append((name, geom))
                
        reports = GarbageReport.objects.filter(barangay__isnull=True).exclude(latitude__isnull=True, longitude__isnull=True)
        count = 0
        
        brgy_dict = {b.name.lower(): b for b in Barangay.objects.all()}
        
        for report in reports:
            try:
                x, y = float(report.longitude), float(report.latitude)
            except (ValueError, TypeError):
                continue
                
            found_name = None
            try:
                for name, geom in brgy_features:
                    match = False
                    if geom['type'] == 'Polygon':
                        outer_ring = geom['coordinates'][0]
                        match = point_in_polygon(x, y, outer_ring)
                        if match:
                            for hole in geom['coordinates'][1:]:
                                if point_in_polygon(x, y, hole):
                                    match = False
                                    break
                    elif geom['type'] == 'MultiPolygon':
                        match = point_in_multi_polygon(x, y, geom['coordinates'])
                    
                    if match:
                        found_name = name
                        break
            except Exception as e:
                self.stdout.write(self.style.ERROR(f"Error checking polygon for report {report.id}: {e}"))
                continue
                    
            if found_name:
                db_brgy = brgy_dict.get(found_name.lower().strip())
                if db_brgy:
                    report.barangay = db_brgy
                    if not dry_run:
                        report.save(update_fields=['barangay'])
                    count += 1
                    self.stdout.write(self.style.SUCCESS(f"{'[DRY RUN] ' if dry_run else ''}Assigned report {report.id} to {db_brgy.name}"))
                else:
                    self.stdout.write(self.style.WARNING(f"Matched '{found_name}' for report {report.id} but not found in DB"))
            else:
                self.stdout.write(self.style.WARNING(f"Report {report.id} ({y}, {x}) did not match any barangay polygon"))
                
        self.stdout.write(self.style.SUCCESS(f"Successfully assigned {count} reports to barangays"))
