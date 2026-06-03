from rest_framework import serializers
from .models import GarbageReport, CollectionConfirmation, GarbageHotspot, Escalation

class GarbageReportSerializer(serializers.ModelSerializer):
    barangay_name = serializers.CharField(source='barangay.name', read_only=True)
    user_name = serializers.SerializerMethodField()
    
    class Meta:
        model = GarbageReport
        fields = '__all__'

    def get_user_name(self, obj):
        # 1. Anonymous submissions
        if not obj.user:
            return "Anonymous Citizen"
        
        # 2. Privacy Logic: check requester
        request = self.context.get('request')
        if not request:
            return "Community Report"
            
        user = request.user
        
        # 3. Always show full name to Admins and Barangay Officials
        if user.is_authenticated and user.role in ['admin', 'brgy_official']:
            return obj.user.full_name
            
        # 4. Show full name to the Owner
        if user.is_authenticated and user == obj.user:
            return obj.user.full_name
            
        # 5. Public / Other Citizens see anonymized label
        return "Community Report"

class CollectionConfirmationSerializer(serializers.ModelSerializer):
    confirmed_by_name = serializers.CharField(source='confirmed_by.full_name', read_only=True)
    barangay_name = serializers.CharField(source='barangay.name', read_only=True)
    
    class Meta:
        model = CollectionConfirmation
        fields = '__all__'

class GarbageHotspotSerializer(serializers.ModelSerializer):
    barangay_name = serializers.CharField(source='barangay.name', read_only=True)
    report_count = serializers.SerializerMethodField()

    class Meta:
        model = GarbageHotspot
        fields = '__all__'

    def get_report_count(self, obj):
        from .models import GarbageReport, ReportStatus
        # Simple proxy: count approved reports in the same barangay
        return GarbageReport.objects.filter(
            barangay=obj.barangay,
            status__in=[ReportStatus.APPROVED, ReportStatus.RESOLVED]
        ).count()

class EscalationSerializer(serializers.ModelSerializer):
    barangay_name = serializers.CharField(source='barangay.name', read_only=True)
    assignee_name = serializers.CharField(source='assignee.full_name', read_only=True)
    
    class Meta:
        model = Escalation
        fields = '__all__'
