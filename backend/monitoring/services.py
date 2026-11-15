from datetime import timedelta

import cv2
from django.db import transaction
from django.utils import timezone

from .models import Violation

GAP_SECONDS = 5  # пауза больше этого = новое нарушение


def extract_video_metadata(path) -> dict:
    cap = cv2.VideoCapture(str(path))
    if not cap.isOpened():
        raise ValueError("Не удалось открыть видеофайл")
    fps = cap.get(cv2.CAP_PROP_FPS) or 0
    frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT) or 0)
    width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH) or 0)
    height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT) or 0)
    cap.release()
    return {
        "fps": fps or None,
        "frame_count": frames or None,
        "width": width or None,
        "height": height or None,
        "duration_sec": round(frames / fps, 2) if fps and frames else None,
    }


def register_violation(d: dict):
    """Создаёт нарушение или продолжает текущее. Возвращает (violation, created)."""
    ts = d.get("timestamp") or timezone.now()
    codes = sorted(set(d["violations"]))
    x1, y1, x2, y2 = d["bbox"]

    with transaction.atomic():
        current = (
            Violation.objects.select_for_update()
            .filter(
                camera=d["camera"], zone=d["zone"], video_id=d.get("video_id"),
                missing_ppe=codes,
                ended_at__gte=ts - timedelta(seconds=GAP_SECONDS),
            )
            .order_by("-ended_at")
            .first()
        )
        if current:
            current.ended_at = max(current.ended_at, ts)
            current.frames_count += 1
            current.confidence = max(current.confidence, d["confidence"])
            current.last_frame_number = d.get("frame_number")
            current.save(update_fields=["ended_at", "frames_count", "confidence", "last_frame_number"])
            return current, False

        v = Violation.objects.create(
            camera=d["camera"], zone=d["zone"], video_id=d.get("video_id"),
            missing_ppe=codes, frame_number=d.get("frame_number"),
            last_frame_number=d.get("frame_number"),
            timestamp=ts, ended_at=ts, frames_count=1,
            bbox_x1=x1, bbox_y1=y1, bbox_x2=x2, bbox_y2=y2,
            confidence=d["confidence"],
        )
        return v, True