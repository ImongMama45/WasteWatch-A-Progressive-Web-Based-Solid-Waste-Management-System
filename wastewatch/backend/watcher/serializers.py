from rest_framework import serializers
from .models import GarbageReport, CollectionConfirmation, GarbageHotspot, Escalation

class GarbageReportSerializer(serializers.ModelSerializer):
    barangay_name = serializers.CharField(source='barangay.name', read_only=True)
    user_name = serializers.CharField(source='user.full_name', read_only=True)
    
    class Meta:
        model = GarbageReport
        fields = '__all__'

class CollectionConfirmationSerializer(serializers.ModelSerializer):
    confirmed_by_name = serializers.CharField(source='confirmed_by.full_name', read_only=True)
    barangay_name = serializers.CharField(source='barangay.name', read_only=True)
    
    class Meta:
        model = CollectionConfirmation
        fields = '__all__'

class GarbageHotspotSerializer(serializers.ModelSerializer):
    barangay_name = serializers.CharField(source='barangay.name', read_only=True)
    
    class Meta:
        model = GarbageHotspot
        fields = '__all__'

class EscalationSerializer(serializers.ModelSerializer):
    barangay_name = serializers.CharField(source='barangay.name', read_only=True)
    assignee_name = serializers.CharField(source='assignee.full_name', read_only=True)
    
    class Meta:
        model = Escalation
        fields = '__all__'
