from django.db import models
from django.utils import timezone


class Camera(models.Model):
    class SourceType(models.TextChoices):
        FILE = "file", "Видеофайл"
        RTP = "rtp", "RTP-поток"

    name = models.CharField(max_length=100)
    source_type = models.CharField(max_length=10, choices=SourceType.choices, default=SourceType.FILE)
    source_uri = models.CharField(max_length=500, blank=True)
    location = models.CharField(max_length=200, blank=True)
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return self.name


class Zone(models.Model):
    camera = models.ForeignKey(Camera, on_delete=models.CASCADE, related_name="zones")
    name = models.CharField(max_length=100)
    is_active = models.BooleanField(default=True)

    def __str__(self):
        return f"{self.camera.name} / {self.name}"


class PPERule(models.Model):
    """Что обязательно в зоне. Коды совпадают с кодами нарушений от ML."""

    class Code(models.TextChoices):
        NO_HELMET = "NO_HELMET", "Нет каски"
        NO_VEST = "NO_VEST", "Нет жилета"
        NO_GLOVES = "NO_GLOVES", "Нет перчаток"

    zone = models.ForeignKey(Zone, on_delete=models.CASCADE, related_name="rules")
    code = models.CharField(max_length=30, choices=Code.choices)
    is_active = models.BooleanField(default=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["zone", "code"], name="uniq_zone_code"),
        ]

    def __str__(self):
        return f"{self.zone} / {self.code}"


class VideoFile(models.Model):
    camera = models.ForeignKey(Camera, null=True, blank=True, on_delete=models.SET_NULL, related_name="videos")
    file = models.FileField(upload_to="videos/%Y/%m/%d/")
    original_name = models.CharField(max_length=255)
    size_bytes = models.BigIntegerField(default=0)
    duration_sec = models.FloatField(null=True, blank=True)
    fps = models.FloatField(null=True, blank=True)
    frame_count = models.IntegerField(null=True, blank=True)
    width = models.IntegerField(null=True, blank=True)
    height = models.IntegerField(null=True, blank=True)
    uploaded_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return self.original_name


class Employee(models.Model):
    """Сотрудник. external_id связывает с внешней системой (СКУД)."""
    external_id = models.CharField(max_length=100, unique=True)
    full_name = models.CharField(max_length=200)
    position = models.CharField(max_length=200, blank=True)
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return f"{self.full_name} ({self.external_id})"


class Violation(models.Model):
    """Один непрерывный период одного нарушения одного человека = одна запись."""

    class Status(models.TextChoices):
        NEW = "new", "Новая"
        CONFIRMED = "confirmed", "Подтверждена"
        FALSE_POSITIVE = "false_positive", "Ложное срабатывание"

    camera = models.ForeignKey(Camera, on_delete=models.CASCADE, related_name="violations")
    zone = models.ForeignKey(Zone, null=True, blank=True, on_delete=models.SET_NULL, related_name="violations")
    video = models.ForeignKey(VideoFile, null=True, blank=True, on_delete=models.SET_NULL, related_name="violations")
    employee = models.ForeignKey(Employee, null=True, blank=True, on_delete=models.SET_NULL, related_name="violations")
    code = models.CharField(max_length=30, choices=PPERule.Code.choices)
    track_id = models.PositiveIntegerField(null=True, blank=True)   # анонимный номер человека от ML
    status = models.CharField(max_length=20, choices=Status.choices, default=Status.NEW)
    model_version = models.CharField(max_length=50, blank=True)
    frame_width = models.PositiveIntegerField(null=True, blank=True)
    frame_height = models.PositiveIntegerField(null=True, blank=True)
    frame_number = models.IntegerField(null=True, blank=True)
    last_frame_number = models.IntegerField(null=True, blank=True)
    timestamp = models.DateTimeField(db_index=True)          # начало
    ended_at = models.DateTimeField(null=True, blank=True)   # конец
    frames_count = models.IntegerField(default=1)
    bbox_x1 = models.FloatField()
    bbox_y1 = models.FloatField()
    bbox_x2 = models.FloatField()
    bbox_y2 = models.FloatField()
    confidence = models.FloatField()                         # максимальная за период
    external_id = models.CharField(max_length=100, blank=True, db_index=True)  # для СКУД
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-timestamp"]
        indexes = [
            models.Index(fields=["camera", "-timestamp"]),
            models.Index(fields=["zone", "-timestamp"]),
            models.Index(fields=["camera", "code", "-timestamp"]),
        ]


class ProcessedEvent(models.Model):
    """Уже принятые event_id: повторная отправка не создаёт дублей."""
    event_id = models.CharField(max_length=100, unique=True)
    created_at = models.DateTimeField(auto_now_add=True)


class CameraSummary(models.Model):
    """Сводка от ML раз в минуту: знаменатель для % соблюдения и признак «ML работает»."""
    camera = models.ForeignKey(Camera, on_delete=models.CASCADE, related_name="summaries")
    zone = models.ForeignKey(Zone, null=True, blank=True, on_delete=models.SET_NULL, related_name="summaries")
    timestamp = models.DateTimeField(default=timezone.now, db_index=True)
    people_checked = models.PositiveIntegerField()
    violators = models.PositiveIntegerField()
    model_version = models.CharField(max_length=50, blank=True)

    class Meta:
        ordering = ["-timestamp"]
        indexes = [models.Index(fields=["camera", "-timestamp"])]