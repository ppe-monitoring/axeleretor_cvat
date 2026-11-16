from datetime import timedelta

import cv2
from django.db import transaction

from .models import ProcessedEvent, Violation

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


def register_event(d: dict):
    """
    Одно событие (человек на кадре) -> инциденты по каждому коду нарушения.
    Возвращает None, если event_id уже обрабатывался, иначе список (violation, created).
    Ключ склейки: камера + зона + видео + track_id + код.
    """
    ts = d["timestamp"]
    x1, y1, x2, y2 = d["bbox"]
    out = []

    with transaction.atomic():
        if d.get("event_id"):
            _, is_new = ProcessedEvent.objects.get_or_create(event_id=d["event_id"])
            if not is_new:
                return None

        for item in d["violations"]:
            code, conf = item["code"], item["confidence"]
            current = (
                Violation.objects.select_for_update()
                .filter(
                    camera=d["camera"], zone=d["zone"], video_id=d.get("video_id"),
                    track_id=d.get("track_id"), code=code,
                    ended_at__gte=ts - timedelta(seconds=GAP_SECONDS),
                )
                .order_by("-ended_at")
                .first()
            )
            if current:
                current.ended_at = max(current.ended_at, ts)
                current.timestamp = min(current.timestamp, ts)
                current.frames_count += 1
                current.confidence = max(current.confidence, conf)
                current.last_frame_number = d.get("frame_number")
                current.save(update_fields=["ended_at", "timestamp", "frames_count",
                                            "confidence", "last_frame_number"])
                out.append((current, False))
                continue

            v = Violation.objects.create(
                camera=d["camera"], zone=d["zone"], video_id=d.get("video_id"),
                track_id=d.get("track_id"), code=code,
                model_version=d.get("model_version", ""),
                frame_width=d.get("frame_width"), frame_height=d.get("frame_height"),
                frame_number=d.get("frame_number"), last_frame_number=d.get("frame_number"),
                timestamp=ts, ended_at=ts, frames_count=1,
                bbox_x1=x1, bbox_y1=y1, bbox_x2=x2, bbox_y2=y2, confidence=conf,
            )
            out.append((v, True))
    return out