from datetime import timedelta

from django.utils import timezone
from rest_framework import serializers

from .models import (Camera, CameraSummary, PPERule, VideoFile, Violation, Zone)
from .services import extract_video_metadata


class CameraSerializer(serializers.ModelSerializer):
    ml_last_seen = serializers.DateTimeField(read_only=True)
    ml_online = serializers.SerializerMethodField()

    class Meta:
        model = Camera
        fields = "__all__"

    def get_ml_online(self, obj) -> bool:
        ts = getattr(obj, "ml_last_seen", None)
        return bool(ts and timezone.now() - ts < timedelta(minutes=3))


class PPERuleSerializer(serializers.ModelSerializer):
    class Meta:
        model = PPERule
        fields = "__all__"


class ZoneSerializer(serializers.ModelSerializer):
    rules = PPERuleSerializer(many=True, read_only=True)

    class Meta:
        model = Zone
        fields = "__all__"


class VideoFileSerializer(serializers.ModelSerializer):
    class Meta:
        model = VideoFile
        fields = "__all__"
        read_only_fields = ["original_name", "size_bytes", "duration_sec", "fps",
                            "frame_count", "width", "height", "uploaded_at"]

    def create(self, validated_data):
        f = validated_data["file"]
        validated_data["original_name"] = f.name
        validated_data["size_bytes"] = f.size
        obj = super().create(validated_data)
        try:
            meta = extract_video_metadata(obj.file.path)
        except ValueError as e:
            obj.file.delete(save=False)
            obj.delete()
            raise serializers.ValidationError({"file": str(e)})
        for k, v in meta.items():
            setattr(obj, k, v)
        obj.save()
        return obj


class ViolationSerializer(serializers.ModelSerializer):
    class Meta:
        model = Violation
        fields = "__all__"


class ViolationStatusSerializer(serializers.ModelSerializer):
    class Meta:
        model = Violation
        fields = ["status"]


class CameraSummarySerializer(serializers.ModelSerializer):
    class Meta:
        model = CameraSummary
        fields = "__all__"

    def validate(self, attrs):
        if attrs["violators"] > attrs["people_checked"]:
            raise serializers.ValidationError({"violators": "Нарушителей не может быть больше, чем проверенных людей"})
        return attrs


class ViolationItemSerializer(serializers.Serializer):
    code = serializers.ChoiceField(choices=PPERule.Code.choices)
    confidence = serializers.FloatField(min_value=0, max_value=1)


class ViolationEventSerializer(serializers.Serializer):
    """Что присылает ML. Одно событие = один человек на одном кадре."""
    event_id = serializers.CharField(max_length=100, required=False, allow_null=True)
    camera_id = serializers.IntegerField()
    zone_id = serializers.IntegerField(required=False, allow_null=True)
    video_id = serializers.IntegerField(required=False, allow_null=True)
    track_id = serializers.IntegerField(min_value=0, required=False, allow_null=True)
    frame_number = serializers.IntegerField(min_value=0, required=False, allow_null=True)
    timestamp = serializers.DateTimeField(required=False)
    frame_width = serializers.IntegerField(min_value=1, required=False, allow_null=True)
    frame_height = serializers.IntegerField(min_value=1, required=False, allow_null=True)
    model_version = serializers.CharField(max_length=50, required=False, allow_blank=True)
    bbox = serializers.ListField(child=serializers.FloatField(min_value=0),
                                 min_length=4, max_length=4)
    violations = ViolationItemSerializer(many=True, allow_empty=False)

    def validate_bbox(self, v):
        x1, y1, x2, y2 = v
        if x2 <= x1 or y2 <= y1:
            raise serializers.ValidationError("bbox = [x1, y1, x2, y2] (рамка человека), где x2 > x1 и y2 > y1")
        return v

    def validate_violations(self, items):
        codes = [i["code"] for i in items]
        if len(codes) != len(set(codes)):
            raise serializers.ValidationError("Коды в violations не должны повторяться")
        return items

    def validate(self, attrs):
        camera = Camera.objects.filter(pk=attrs["camera_id"]).first()
        if not camera:
            raise serializers.ValidationError({"camera_id": "Камера не найдена"})

        zones = Zone.objects.filter(camera=camera, is_active=True)
        if attrs.get("zone_id"):
            zone = zones.filter(pk=attrs["zone_id"]).first()
            if not zone:
                raise serializers.ValidationError({"zone_id": "У этой камеры нет такой активной зоны"})
        else:
            zone = zones.first()
            if not zone:
                raise serializers.ValidationError({"camera_id": "У камеры нет активной зоны"})

        allowed = set(zone.rules.filter(is_active=True).values_list("code", flat=True))
        unknown = {i["code"] for i in attrs["violations"]} - allowed
        if unknown:
            raise serializers.ValidationError(
                {"violations": f"Зона не требует: {sorted(unknown)}. Разрешены: {sorted(allowed)}"})

        attrs["camera"] = camera
        attrs["zone"] = zone
        attrs["timestamp"] = attrs.get("timestamp") or timezone.now()
        return attrs