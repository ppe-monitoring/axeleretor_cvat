import logging

from django.db.models import Max
from django.utils.dateparse import parse_datetime
from drf_spectacular.utils import (OpenApiExample, OpenApiParameter,
                                   extend_schema, extend_schema_view)
from rest_framework import mixins, viewsets
from rest_framework.parsers import FormParser, MultiPartParser
from rest_framework.response import Response

from .models import Camera, CameraSummary, PPERule, VideoFile, Violation, Zone
from .permissions import MLApiKey
from .serializers import (CameraSerializer, CameraSummarySerializer,
                          PPERuleSerializer, VideoFileSerializer,
                          ViolationEventSerializer, ViolationSerializer,
                          ViolationStatusSerializer, ZoneSerializer)
from .services import register_event

logger = logging.getLogger(__name__)

API_KEY_PARAM = OpenApiParameter(
    "X-API-Key", str, OpenApiParameter.HEADER, required=False,
    description="Ключ ML-модуля (обязателен, если на сервере задан ML_API_KEY)")


@extend_schema_view(
    list=extend_schema(summary="Камеры (ml_online = ML присылал сводку за последние 3 минуты)"),
)
class CameraViewSet(viewsets.ModelViewSet):
    serializer_class = CameraSerializer

    def get_queryset(self):
        return Camera.objects.annotate(ml_last_seen=Max("summaries__timestamp")).order_by("id")


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


@extend_schema_view(
    list=extend_schema(
        summary="Сводки от ML (сколько людей проверено / нарушителей)",
        parameters=[OpenApiParameter("camera", int),
                    OpenApiParameter("date_from", str, description="ISO datetime")]),
    create=extend_schema(
        summary="Сводка от ML раз в минуту (также признак «ML работает»)",
        parameters=[API_KEY_PARAM],
        examples=[OpenApiExample("Пример", request_only=True, value={
            "camera_id": 1, "timestamp": "2026-11-20T12:01:00+03:00",
            "people_checked": 12, "violators": 2, "model_version": "yolov8n-ppe-0.3"})]),
)
class CameraSummaryViewSet(mixins.ListModelMixin, mixins.CreateModelMixin,
                           viewsets.GenericViewSet):
    serializer_class = CameraSummarySerializer

    def get_permissions(self):
        return [MLApiKey()] if self.action == "create" else super().get_permissions()

    def get_queryset(self):
        qs = CameraSummary.objects.all()
        p = self.request.query_params
        if p.get("camera"):
            qs = qs.filter(camera_id=p["camera"])
        if p.get("date_from") and parse_datetime(p["date_from"]):
            qs = qs.filter(timestamp__gte=parse_datetime(p["date_from"]))
        return qs


EXAMPLE = {
    "event_id": "run42-t7-f120", "camera_id": 1, "zone_id": 1, "video_id": 5,
    "track_id": 7, "frame_number": 120, "timestamp": "2026-11-20T12:00:03+03:00",
    "frame_width": 1280, "frame_height": 720, "model_version": "yolov8n-ppe-0.3",
    "bbox": [185.2, 40.1, 410.7, 520.3],
    "violations": [{"code": "NO_HELMET", "confidence": 0.91},
                   {"code": "NO_VEST", "confidence": 0.84}],
}


@extend_schema_view(
    list=extend_schema(
        summary="Лента нарушений",
        parameters=[
            OpenApiParameter("camera", int), OpenApiParameter("zone", int),
            OpenApiParameter("video", int),
            OpenApiParameter("code", str, description="Например NO_HELMET"),
            OpenApiParameter("status", str, description="new / confirmed / false_positive"),
            OpenApiParameter("date_from", str, description="ISO datetime"),
            OpenApiParameter("date_to", str, description="ISO datetime"),
        ]),
    create=extend_schema(
        summary="Приём нарушений от ML",
        description=("Одно событие = один человек на кадре, можно прислать список событий. "
                     "bbox это рамка человека. Склейка: камера + зона + track_id + код, "
                     "пауза больше 5 секунд начинает новый инцидент. Повтор с тем же event_id "
                     "не создаёт дублей. Список: 201 всё принято, 207 часть отклонена, 400 всё отклонено."),
        request=ViolationEventSerializer,
        parameters=[API_KEY_PARAM],
        examples=[OpenApiExample("Пример от ML", value=EXAMPLE, request_only=True)]),
    partial_update=extend_schema(summary="Сменить статус: new / confirmed / false_positive"),
)
class ViolationViewSet(mixins.ListModelMixin, mixins.RetrieveModelMixin,
                       mixins.CreateModelMixin, mixins.UpdateModelMixin,
                       viewsets.GenericViewSet):
    http_method_names = ["get", "post", "patch", "head", "options"]

    def get_serializer_class(self):
        return ViolationStatusSerializer if self.action == "partial_update" else ViolationSerializer

    def get_permissions(self):
        return [MLApiKey()] if self.action == "create" else super().get_permissions()

    def get_queryset(self):
        qs = Violation.objects.select_related("camera", "zone", "video")
        p = self.request.query_params
        for param, field in (("camera", "camera_id"), ("zone", "zone_id"),
                             ("video", "video_id"), ("code", "code"), ("status", "status")):
            if p.get(param):
                qs = qs.filter(**{field: p[param]})
        if p.get("date_from") and parse_datetime(p["date_from"]):
            qs = qs.filter(timestamp__gte=parse_datetime(p["date_from"]))
        if p.get("date_to") and parse_datetime(p["date_to"]):
            qs = qs.filter(timestamp__lte=parse_datetime(p["date_to"]))
        return qs

    def create(self, request, *args, **kwargs):
        many = isinstance(request.data, list)
        items = request.data if many else [request.data]
        valid, errors = [], []

        for i, item in enumerate(items):
            s = ViolationEventSerializer(data=item)
            if s.is_valid():
                valid.append((i, s.validated_data))
            else:
                logger.warning("Отклонено событие #%s: %s", i, s.errors)
                errors.append({"index": i, "errors": s.errors})

        valid.sort(key=lambda x: x[1]["timestamp"])  # склейка идёт по времени
        results = []
        for i, d in valid:
            try:
                res = register_event(d)
            except Exception:
                logger.exception("Ошибка сохранения события #%s", i)
                errors.append({"index": i, "errors": {"detail": "Ошибка сохранения"}})
                continue
            if res is None:
                results.append({"index": i, "duplicate": True, "incidents": []})
                continue
            results.append({"index": i, "duplicate": False, "incidents": [
                {"id": v.id, "code": v.code, "created": created, "frames_count": v.frames_count}
                for v, created in res]})
        results.sort(key=lambda r: r["index"])

        if not many:
            if errors:
                return Response(errors[0]["errors"], status=400)
            r = results[0]
            created = any(x["created"] for x in r["incidents"])
            return Response({"results": results}, status=201 if created else 200)

        code = 201 if not errors else (207 if results else 400)
        return Response({"saved": len(results), "rejected": len(errors),
                         "results": results, "errors": errors}, status=code)