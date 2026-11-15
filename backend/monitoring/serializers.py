from rest_framework import serializers
from .models import Camera, Zone, PPERule, VideoFile, Violation
from .services import extract_video_metadata


class CameraSerializer(serializers.ModelSerializer):
    class Meta:
        model = Camera
        fields = "__all__"


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


class ViolationEventSerializer(serializers.Serializer):
    """Что присылает ML. Одно событие = один человек на одном кадре."""
    camera_id = serializers.IntegerField()
    zone_id = serializers.IntegerField(required=False, allow_null=True)
    video_id = serializers.IntegerField(required=False, allow_null=True)
    frame_number = serializers.IntegerField(min_value=0, required=False, allow_null=True)
    timestamp = serializers.DateTimeField(required=False)
    bbox = serializers.ListField(child=serializers.FloatField(min_value=0),
                                 min_length=4, max_length=4)
    confidence = serializers.FloatField(min_value=0, max_value=1)
    violations = serializers.ListField(
        child=serializers.ChoiceField(choices=PPERule.Code.choices), min_length=1)

    def validate_bbox(self, v):
        x1, y1, x2, y2 = v
        if x2 <= x1 or y2 <= y1:
            raise serializers.ValidationError("bbox = [x1, y1, x2, y2], где x2 > x1 и y2 > y1")
        return v

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
        unknown = set(attrs["violations"]) - allowed
        if unknown:
            raise serializers.ValidationError(
                {"violations": f"Зона не требует: {sorted(unknown)}. Разрешены: {sorted(allowed)}"})

        attrs["camera"] = camera
        attrs["zone"] = zone
        return attrs