import os

file_path = r"d:\Coding\Waste Watch\wastewatch\backend\accounts\serializers.py"

with open(file_path, 'r', encoding='utf-8') as f:
    content = f.read()

new_serializers = """
# ---------------------------------------------------------------------------
# Barangay Management
# ---------------------------------------------------------------------------
class BarangayListSerializer(serializers.ModelSerializer):
    official_count     = serializers.IntegerField(read_only=True)
    watcher_count      = serializers.IntegerField(read_only=True)
    driver_count       = serializers.IntegerField(read_only=True)
    pending_concerns   = serializers.IntegerField(read_only=True)
    active_hotspots    = serializers.IntegerField(read_only=True)
    open_escalations   = serializers.IntegerField(read_only=True)
    has_unassigned_roles = serializers.BooleanField(read_only=True)

    class Meta:
        model = Barangay
        fields = [
            'id', 'name', 'official_count', 'watcher_count',
            'driver_count', 'pending_concerns', 'active_hotspots',
            'open_escalations', 'has_unassigned_roles',
        ]

class PersonnelSerializer(serializers.ModelSerializer):
    class Meta:
        model = User
        fields = ['id', 'full_name', 'email', 'profile_pic', 'role', 'is_active']

# Dynamic import to prevent circular dependency
def get_hotspot_serializer():
    from watcher.serializers import GarbageHotspotSerializer
    return GarbageHotspotSerializer

def get_escalation_serializer():
    from watcher.serializers import EscalationSerializer
    return EscalationSerializer

def get_report_serializer():
    from watcher.serializers import GarbageReportSerializer
    return GarbageReportSerializer

class BarangayDetailSerializer(serializers.ModelSerializer):
    officials        = serializers.SerializerMethodField()
    watchers         = serializers.SerializerMethodField()
    drivers          = serializers.SerializerMethodField()
    hotspots         = serializers.SerializerMethodField()
    escalations      = serializers.SerializerMethodField()
    pending_concerns = serializers.SerializerMethodField()

    class Meta:
        model = Barangay
        fields = [
            'id', 'name', 'boundary_geojson',
            'officials', 'watchers', 'drivers',
            'hotspots', 'escalations', 'pending_concerns',
        ]

    def get_officials(self, obj):
        return PersonnelSerializer(obj.residents.filter(role=UserRole.BRGY_OFFICIAL), many=True).data

    def get_watchers(self, obj):
        return PersonnelSerializer(obj.residents.filter(role=UserRole.WATCHER), many=True).data

    def get_drivers(self, obj):
        return PersonnelSerializer(obj.residents.filter(role=UserRole.DRIVER), many=True).data

    def get_hotspots(self, obj):
        SerializerClass = get_hotspot_serializer()
        return SerializerClass(obj.hotspots.all(), many=True).data

    def get_escalations(self, obj):
        SerializerClass = get_escalation_serializer()
        return SerializerClass(obj.escalations.all(), many=True).data

    def get_pending_concerns(self, obj):
        SerializerClass = get_report_serializer()
        # Filter for pending reports
        from watcher.models import ReportStatus
        reports = obj.reports.filter(status=ReportStatus.PENDING)
        return SerializerClass(reports, many=True).data
"""

if "class BarangayListSerializer" not in content:
    content += new_serializers

with open(file_path, 'w', encoding='utf-8') as f:
    f.write(content)

print("Serializers updated.")
