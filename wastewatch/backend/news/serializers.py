from rest_framework import serializers
from .models import NewsItem, EmergencyAlert, BarangaySpotlight

class NewsItemSerializer(serializers.ModelSerializer):
    barangay_name = serializers.CharField(source='barangay.name', read_only=True)
    class Meta:
        model = NewsItem
        fields = '__all__'

class EmergencyAlertSerializer(serializers.ModelSerializer):
    class Meta:
        model = EmergencyAlert
        fields = '__all__'

class BarangaySpotlightSerializer(serializers.ModelSerializer):
    barangay_name = serializers.CharField(source='barangay.name', read_only=True)
    class Meta:
        model = BarangaySpotlight
        fields = '__all__'
