import logging

from django.utils.dateparse import parse_datetime
from drf_spectacular.utils import (OpenApiExample, OpenApiParameter,
                                   extend_schema, extend_schema_view)
from rest_framework import mixins, viewsets
from rest_framework.parsers import FormParser, MultiPartParser
from rest_framework.response import Response

from .models import Camera, Zone, PPERule, VideoFile, Violation
from .serializers import (CameraSerializer, ZoneSerializer, PPERuleSerializer,
                          VideoFileSerializer, ViolationSerializer,
                          ViolationEventSerializer)
from .services import register_violation

logger = logging.getLogger(__name__)


class CameraViewSet(viewsets.ModelViewSet):
    queryset = Camera.objects.all().order_by("id")
    serializer_class = CameraSerializer


@extend_schema_view(
    list=extend_schema(
        summary="Список зон с правилами СИЗ",
        parameters=[OpenApiParameter("camera", int, description="Фильтр по камере")]),
)
class ZoneViewSet(viewsets.ModelViewSet):
    serializer_class = ZoneSerializer

    def get_queryset(self):
        qs = Zone.objects.all().prefetch_related("rules").order_by("id")
        camera = self.request.query_params.get("camera")
        return qs.filter(camera_id=camera) if camera else qs


class PPERuleViewSet(viewsets.ModelViewSet):
    queryset = PPERule.objects.all().order_by("id")
    serializer_class = PPERuleSerializer


class VideoFileViewSet(mixins.CreateModelMixin, mixins.ListModelMixin,
                       mixins.RetrieveModelMixin, mixins.DestroyModelMixin,
                       viewsets.GenericViewSet):
    queryset = VideoFile.objects.all().order_by("-uploaded_at")
    serializer_class = VideoFileSerializer
    parser_classes = [MultiPartParser, FormParser]


EXAMPLE = {
    "camera_id": 1, "zone_id": 1, "video_id": 5, "frame_number": 120,
    "timestamp": "2026-11-18T12:00:03+03:00",
    "bbox": [100, 80, 320, 540], "confidence": 0.91, "violations": ["NO_HELMET"],
}


@extend_schema_view(
    list=extend_schema(
        summary="Лента нарушений",
        parameters=[
            OpenApiParameter("camera", int), OpenApiParameter("zone", int),
            OpenApiParameter("video", int),
            OpenApiParameter("code", str, description="Например NO_HELMET"),
            OpenApiParameter("date_from", str, description="ISO datetime"),
            OpenApiParameter("date_to", str, description="ISO datetime"),
        ]),
    create=extend_schema(
        summary="Приём нарушения от ML",
        description=("Одно событие на человека и кадр (можно прислать список событий). "
                     "Если такое же нарушение (камера, зона, те же коды) уже идёт и пауза "
                     "меньше 5 секунд, оно продлевается (200), иначе создаётся новое (201). "
                     "Для списка: 201 всё принято, 207 часть отклонена, 400 всё отклонено."),
        request=ViolationEventSerializer,
        examples=[OpenApiExample("Пример от ML", value=EXAMPLE, request_only=True)]),
)
class ViolationViewSet(mixins.ListModelMixin, mixins.RetrieveModelMixin,
                       mixins.CreateModelMixin, viewsets.GenericViewSet):
    serializer_class = ViolationSerializer

    def get_queryset(self):
        qs = Violation.objects.select_related("camera", "zone", "video")
        p = self.request.query_params
        for param, field in (("camera", "camera_id"), ("zone", "zone_id"), ("video", "video_id")):
            if p.get(param):
                qs = qs.filter(**{field: p[param]})
        if p.get("code"):
            qs = qs.filter(missing_ppe__contains=[p["code"]])
        if p.get("date_from") and parse_datetime(p["date_from"]):
            qs = qs.filter(timestamp__gte=parse_datetime(p["date_from"]))
        if p.get("date_to") and parse_datetime(p["date_to"]):
            qs = qs.filter(timestamp__lte=parse_datetime(p["date_to"]))
        return qs

    def create(self, request, *args, **kwargs):
        many = isinstance(request.data, list)
        items = request.data if many else [request.data]
        results, errors = [], []

        for i, item in enumerate(items):
            s = ViolationEventSerializer(data=item)
            if not s.is_valid():
                logger.warning("Отклонено событие #%s: %s", i, s.errors)
                errors.append({"index": i, "errors": s.errors})
                continue
            try:
                v, created = register_violation(s.validated_data)
            except Exception:
                logger.exception("Ошибка сохранения события #%s", i)
                errors.append({"index": i, "errors": {"detail": "Ошибка сохранения"}})
                continue
            results.append({"index": i, "id": v.id, "created": created,
                            "frames_count": v.frames_count})

        if not many:
            if errors:
                return Response(errors[0]["errors"], status=400)
            r = results[0]
            return Response(r, status=201 if r["created"] else 200)

        code = 201 if not errors else (207 if results else 400)
        return Response({"saved": len(results), "rejected": len(errors),
                         "results": results, "errors": errors}, status=code)