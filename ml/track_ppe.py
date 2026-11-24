"""
Трекинг людей и СИЗ одной PPE-моделью из config.yaml.

Запуск из папки ml:
  python track_ppe.py --source data/videos/light_close.mp4 --show
  python track_ppe.py --source data/videos
  python track_ppe.py --source "rtsp://..." --camera-id 1 --show
  python track_ppe.py --source env:CAMERA_URL --camera-id 1

Важно: отсутствие обнаружения СИЗ НЕ считается нарушением.
Нарушение фиксируется только при явном обнаружении класса NO-*.
Статус ok ставится, только если подтверждены все три вида СИЗ.
"""

import argparse
import json
import logging
import os
import re
import threading
import time
from collections import Counter, deque
from datetime import datetime, timedelta
from pathlib import Path

import cv2
import yaml
from ultralytics import YOLO


VIDEO_EXTENSIONS = {".mp4", ".avi", ".mov", ".mkv"}
PERSON_CLASS = "Person"

# Названия должны совпадать с model.names.
CLASS_TO_ITEM = {
    "Hardhat": ("helmet", "pos"),
    "NO-Hardhat": ("helmet", "neg"),
    "Safety Vest": ("vest", "pos"),
    "NO-Safety Vest": ("vest", "neg"),
    "Glove": ("gloves", "pos"),
    "NO-Glove": ("gloves", "neg"),
}
ITEM_TO_CODE = {
    "helmet": "NO_HELMET",
    "vest": "NO_VEST",
    "gloves": "NO_GLOVES",
}
ITEM_TO_NEGATIVE_CLASS = {
    "helmet": "NO-Hardhat",
    "vest": "NO-Safety Vest",
    "gloves": "NO-Glove",
}
# Начальные вертикальные области внутри рамки человека.
# Их нужно проверить на ваших видео, особенно для перчаток.
ITEM_REGIONS = {
    "helmet": (0.00, 0.38),
    "vest": (0.18, 0.78),
    "gloves": (0.35, 1.00),
}

RED = (0, 0, 255)
GREEN = (0, 200, 0)
BLUE = (255, 140, 0)
GRAY = (160, 160, 160)


def load_config(path):
    with open(path, encoding="utf-8") as f:
        cfg = yaml.safe_load(f) or {}

    required = ["model", "show_classes", "conf", "iou", "imgsz", "output_dir"]
    missing = [key for key in required if key not in cfg]
    if missing:
        raise ValueError("В config.yaml нет настроек: " + ", ".join(missing))

    cfg.setdefault("model_version", "unknown")
    cfg.setdefault("class_conf", {})
    cfg.setdefault("violation_codes", {})
    cfg.setdefault("log_file", "logs/track_ppe.log")

    # Дополнительные параметры трекинга. Необязательно добавлять их в YAML.
    cfg.setdefault("tracker", "bytetrack.yaml")
    cfg.setdefault("window", 15)
    cfg.setdefault("min_observations", 5)
    cfg.setdefault("violation_rate", 0.50)
    cfg.setdefault("positive_rate", 0.60)
    cfg.setdefault("min_containment", 0.25)
    cfg.setdefault("min_person_height_frac", 0.08)
    cfg.setdefault("max_track_age", 90)
    cfg.setdefault("event_cooldown_s", 10)
    cfg.setdefault("stream_fps", 10.0)

    if int(cfg["window"]) < 1 or not 1 <= int(cfg["min_observations"]) <= int(cfg["window"]):
        raise ValueError("Проверьте window и min_observations в config.yaml")
    return cfg


def resolve_path(value, base_dir):
    p = Path(value)
    return p if p.is_absolute() else (base_dir / p).resolve()


def setup_logging(path):
    path.parent.mkdir(parents=True, exist_ok=True)
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s | %(levelname)s | %(message)s",
        handlers=[
            logging.FileHandler(path, encoding="utf-8"),
            logging.StreamHandler(),
        ],
        force=True,
    )


def resolve_source(value):
    if value.startswith("env:"):
        name = value[4:]
        value = os.environ.get(name)
        if not value:
            raise SystemExit(
                f"Переменная {name} не задана. PowerShell: "
                f'$env:{name} = "rtsp://..."'
            )
    return value


def mask_url(url):
    return re.sub(r"//[^/@]*@", "//***@", url)


def names_dict(model):
    names = model.names
    if isinstance(names, dict):
        return {int(k): str(v) for k, v in names.items()}
    return {i: str(v) for i, v in enumerate(names)}


def check_classes(names):
    available = set(names.values())
    required = {PERSON_CLASS, *CLASS_TO_ITEM.keys()}
    missing = sorted(required - available)
    if missing:
        raise ValueError(
            "В модели отсутствуют классы: " + ", ".join(missing)
            + ". Проверьте, что config.yaml указывает на PPE-модель best.pt."
        )
    return {name: class_id for class_id, name in names.items()}


def area(box):
    return max(0.0, box[2] - box[0]) * max(0.0, box[3] - box[1])


def containment(item_box, person_box):
    x1, y1 = max(item_box[0], person_box[0]), max(item_box[1], person_box[1])
    x2, y2 = min(item_box[2], person_box[2]), min(item_box[3], person_box[3])
    intersection = max(0.0, x2 - x1) * max(0.0, y2 - y1)
    return intersection / area(item_box) if area(item_box) > 0 else 0.0


def assign_items(persons, items, min_containment):
    """Каждый объект СИЗ назначается максимум одному человеку."""
    result = {p["track_id"]: [] for p in persons}
    for item in items:
        low, high = ITEM_REGIONS[item["item"]]
        cy = (item["bbox"][1] + item["bbox"][3]) / 2
        candidates = []
        for person in persons:
            x1, y1, x2, y2 = person["bbox"]
            h = y2 - y1
            if h <= 0:
                continue
            relative_y = (cy - y1) / h
            if not low <= relative_y <= high:
                continue
            share = containment(item["bbox"], person["bbox"])
            if share >= min_containment:
                candidates.append((share, -area(person["bbox"]), person))
        if candidates:
            chosen = max(candidates, key=lambda x: (x[0], x[1]))[2]
            result[chosen["track_id"]].append(item)
    return result


def observe(assigned, item_name):
    pos = [x["confidence"] for x in assigned
           if x["item"] == item_name and x["polarity"] == "pos"]
    neg = [x["confidence"] for x in assigned
           if x["item"] == item_name and x["polarity"] == "neg"]
    best_pos, best_neg = max(pos, default=0.0), max(neg, default=0.0)
    if best_neg > best_pos:
        return "neg", best_neg
    if best_pos > 0:
        return "pos", best_pos
    return "none", 0.0


class TrackState:
    def __init__(self, window, frame_index):
        self.history = {name: deque(maxlen=window) for name in ITEM_TO_CODE}
        self.last_seen = frame_index
        self.last_event = {}


def decide(history, cfg):
    # none не входит в знаменатель: отсутствие детекции не доказывает нарушение.
    observations = [(kind, conf) for kind, conf in history if kind in ("pos", "neg")]
    if len(observations) < int(cfg["min_observations"]):
        return "unknown", None

    negatives = [c for kind, c in observations if kind == "neg"]
    positives = [c for kind, c in observations if kind == "pos"]
    total = len(observations)

    if len(negatives) / total >= float(cfg["violation_rate"]):
        return "violation", sum(negatives) / len(negatives)
    if len(positives) / total >= float(cfg["positive_rate"]):
        return "ok", sum(positives) / len(positives)
    return "unknown", None


def parse_result(result, names, cfg):
    persons, items = [], []
    if result.boxes is None:
        return persons, items

    thresholds = cfg.get("class_conf") or {}
    default_conf = float(cfg["conf"])

    for box in result.boxes:
        class_id = int(box.cls[0].item())
        class_name = names[class_id]
        confidence = float(box.conf[0].item())
        if confidence < float(thresholds.get(class_name, default_conf)):
            continue

        bbox = [float(v) for v in box.xyxy[0].tolist()]
        if class_name == PERSON_CLASS:
            if box.id is not None:
                persons.append({
                    "track_id": int(box.id[0].item()),
                    "bbox": bbox,
                    "confidence": confidence,
                })
        elif class_name in CLASS_TO_ITEM:
            item_name, polarity = CLASS_TO_ITEM[class_name]
            items.append({
                "item": item_name,
                "polarity": polarity,
                "class": class_name,
                "confidence": confidence,
                "bbox": bbox,
            })
    return persons, items


def draw_frame(frame, persons, items, statuses):
    out = frame.copy()
    for item in items:
        x1, y1, x2, y2 = map(int, item["bbox"])
        color = RED if item["polarity"] == "neg" else GREEN
        label = f'{item["class"]} {item["confidence"]:.2f}'
        cv2.rectangle(out, (x1, y1), (x2, y2), color, 2)
        cv2.putText(out, label, (x1, max(18, y1 - 5)),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.45, color, 1, cv2.LINE_AA)

    for person in persons:
        tid = person["track_id"]
        status, codes = statuses[tid]
        color = {"violation": RED, "ok": GREEN, "unknown": GRAY}[status]
        x1, y1, x2, y2 = map(int, person["bbox"])
        label = f"ID {tid}: {status}"
        if codes:
            label += " " + ",".join(codes)
        cv2.rectangle(out, (x1, y1), (x2, y2), color, 2)
        cv2.putText(out, label, (x1, max(20, y1 - 7)),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.5, color, 2, cv2.LINE_AA)
    return out


class RTSPSource:
    """Фоновое чтение RTSP; основной поток получает только новый кадр."""

    def __init__(self, url, reconnect_delay=3):
        self.url = url
        self.reconnect_delay = reconnect_delay
        self.stop_event = threading.Event()
        self.condition = threading.Condition()
        self.frame = None
        self.sequence = 0
        self.thread = threading.Thread(target=self._reader, daemon=True)
        self.started = False

    def _reader(self):
        while not self.stop_event.is_set():
            if self.url.isdigit():
                cap = cv2.VideoCapture(int(self.url))
            else:
                os.environ.setdefault("OPENCV_FFMPEG_CAPTURE_OPTIONS", "rtsp_transport;tcp")
                cap = cv2.VideoCapture(self.url, cv2.CAP_FFMPEG)
            if not cap.isOpened():
                logging.warning("Не удалось открыть %s; повторное подключение.",
                                mask_url(self.url))
                cap.release()
                self.stop_event.wait(self.reconnect_delay)
                continue

            logging.info("RTSP подключён: %s", mask_url(self.url))
            while not self.stop_event.is_set():
                ok, frame = cap.read()
                if not ok:
                    logging.warning("RTSP-поток прервался.")
                    break
                with self.condition:
                    self.frame = frame
                    self.sequence += 1
                    self.condition.notify_all()
            cap.release()
            self.stop_event.wait(self.reconnect_delay)

    def start(self):
        if not self.started:
            self.thread.start()
            self.started = True

    def read_new(self, last_sequence, timeout=2):
        deadline = time.monotonic() + timeout
        with self.condition:
            while self.sequence <= last_sequence and not self.stop_event.is_set():
                remaining = deadline - time.monotonic()
                if remaining <= 0:
                    return None, last_sequence
                self.condition.wait(remaining)
            if self.sequence <= last_sequence:
                return None, last_sequence
            return self.frame.copy(), self.sequence

    def close(self):
        self.stop_event.set()
        with self.condition:
            self.condition.notify_all()
        if self.started and self.thread.is_alive():
            self.thread.join(timeout=5)


def file_frames(path, stride, start_time):
    cap = cv2.VideoCapture(str(path))
    if not cap.isOpened():
        cap.release()
        raise RuntimeError(f"Не удалось открыть видео: {path}")
    fps = cap.get(cv2.CAP_PROP_FPS)
    if not fps or fps <= 0:
        fps = 25.0

    def iterator():
        frame_index = 0
        try:
            while True:
                ok, frame = cap.read()
                if not ok:
                    break
                if frame_index % stride == 0:
                    seconds = frame_index / fps
                    yield frame, frame_index, seconds, start_time + timedelta(seconds=seconds)
                frame_index += 1
        finally:
            cap.release()

    return iterator(), fps


def stream_frames(source, idle_timeout):
    source.start()
    last_seq = 0
    frame_index = 0
    start = time.monotonic()
    idle_since = start
    while True:
        frame, seq = source.read_new(last_seq, timeout=1)
        if frame is None:
            if idle_timeout > 0 and time.monotonic() - idle_since > idle_timeout:
                logging.error("Нет кадров более %.1f секунд; останавливаюсь.", idle_timeout)
                break
            continue
        last_seq = seq
        idle_since = time.monotonic()
        seconds = time.monotonic() - start
        yield frame, frame_index, seconds, datetime.now().astimezone()
        frame_index += 1


def process(source_name, frames, fps, is_stream, model, names, cfg, args, run_id):
    output_dir = resolve_path(cfg["output_dir"], args.base_dir)
    output_dir.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    base = output_dir / f"{source_name}_{stamp}"
    tracks_path = Path(str(base) + "_tracks.jsonl")
    events_path = Path(str(base) + "_events.jsonl")
    video_path = Path(str(base) + "_tracked.mp4")

    save_video = args.save_video or (not is_stream and not args.no_video)
    writer = None
    states = {}
    event_counts = Counter()
    seen_ids, violation_ids = set(), set()
    frame_count = 0
    infer_time = 0.0
    started = time.perf_counter()

    min_conf = min(
        [float(cfg["conf"])]
        + [float(v) for v in (cfg.get("class_conf") or {}).values()]
    )

    try:
        with tracks_path.open("w", encoding="utf-8") as tf, \
             events_path.open("w", encoding="utf-8") as ef:
            for frame, frame_index, seconds, timestamp in frames:
                height, width = frame.shape[:2]
                t0 = time.perf_counter()

                # Одна модель и один проход на кадр. ByteTrack присваивает ID людям.
                result = model.track(
                    frame,
                    persist=True,
                    tracker=cfg["tracker"],
                    conf=min_conf,
                    iou=float(cfg["iou"]),
                    imgsz=int(cfg["imgsz"]),
                    verbose=False,
                )[0]

                infer_time += time.perf_counter() - t0
                persons, items = parse_result(result, names, cfg)
                assigned = assign_items(persons, items, float(cfg["min_containment"]))

                person_records, statuses = [], {}
                for person in persons:
                    tid = person["track_id"]
                    seen_ids.add(tid)
                    state = states.get(tid)
                    if state is None:
                        state = TrackState(int(cfg["window"]), frame_index)
                        states[tid] = state
                    state.last_seen = frame_index

                    person_height = person["bbox"][3] - person["bbox"][1]
                    judged = person_height / max(height, 1) >= float(cfg["min_person_height_frac"])
                    item_view = {}

                    if judged:
                        for item_name in ITEM_TO_CODE:
                            kind, confidence = observe(assigned.get(tid, []), item_name)
                            state.history[item_name].append((kind, confidence))
                            item_view[item_name] = kind
                    else:
                        item_view = {name: "unknown" for name in ITEM_TO_CODE}

                    decisions = {
                        name: decide(history, cfg) if judged else ("unknown", None)
                        for name, history in state.history.items()
                    }

                    violations = {}
                    for item_name, (decision, confidence) in decisions.items():
                        if decision == "violation":
                            negative_class = ITEM_TO_NEGATIVE_CLASS[item_name]
                            code = (cfg.get("violation_codes") or {}).get(
                                negative_class, ITEM_TO_CODE[item_name]
                            )
                            violations[code] = confidence

                    if violations:
                        overall = "violation"
                        violation_ids.add(tid)
                    elif judged and all(v[0] == "ok" for v in decisions.values()):
                        overall = "ok"
                    else:
                        overall = "unknown"

                    statuses[tid] = (overall, sorted(violations))
                    for code, confidence in violations.items():
                        previous = state.last_event.get(code)
                        if previous is None or seconds - previous >= float(cfg["event_cooldown_s"]):
                            event = {
                                "event_id": f"{run_id}-{source_name}-t{tid}-f{frame_index}-{code}",
                                "camera_id": args.camera_id,
                                "video_id": args.video_id,
                                "track_id": tid,
                                "frame_number": frame_index,
                                "timestamp": timestamp.isoformat(timespec="milliseconds"),
                                "frame_width": width,
                                "frame_height": height,
                                "model_version": cfg["model_version"],
                                "bbox": [round(v, 1) for v in person["bbox"]],
                                "violations": [{
                                    "code": code,
                                    "confidence": round(float(confidence), 3),
                                }],
                            }
                            ef.write(json.dumps(event, ensure_ascii=False) + "\n")
                            state.last_event[code] = seconds
                            event_counts[code] += 1

                    person_records.append({
                        "track_id": tid,
                        "bbox": [round(v, 1) for v in person["bbox"]],
                        "confidence": round(person["confidence"], 3),
                        "judged": judged,
                        "items": item_view,
                        "status": overall,
                        "violations": [
                            {"code": code, "confidence": round(float(conf), 3)}
                            for code, conf in sorted(violations.items())
                        ],
                    })

                tf.write(json.dumps({
                    "source": source_name,
                    "frame_id": frame_index,
                    "timestamp_s": round(seconds, 3),
                    "time": timestamp.isoformat(timespec="milliseconds"),
                    "model_version": cfg["model_version"],
                    "persons": person_records,
                }, ensure_ascii=False) + "\n")

                if save_video or args.show:
                    annotated = draw_frame(frame, persons, items, statuses)
                    if save_video and writer is None:
                        out_fps = max(1.0, fps / args.stride) if not is_stream else max(1.0, fps)
                        writer = cv2.VideoWriter(
                            str(video_path), cv2.VideoWriter_fourcc(*"mp4v"),
                            out_fps, (width, height)
                        )
                        if not writer.isOpened():
                            writer.release()
                            writer = None
                            logging.error("Не удалось создать выходное видео.")
                    if writer is not None:
                        writer.write(annotated)
                    if args.show:
                        cv2.imshow("track_ppe - q: выход", annotated)
                        if cv2.waitKey(1) & 0xFF == ord("q"):
                            break

                if frame_count % 100 == 0:
                    expired = [
                        tid for tid, state in states.items()
                        if frame_index - state.last_seen > int(cfg["max_track_age"])
                    ]
                    for tid in expired:
                        del states[tid]

                frame_count += 1
                if args.max_frames and frame_count >= args.max_frames:
                    break
                if args.max_seconds and seconds >= args.max_seconds:
                    break

    except KeyboardInterrupt:
        logging.info("Остановка по Ctrl+C.")
    finally:
        if writer is not None:
            writer.release()
        if args.show:
            cv2.destroyAllWindows()

    elapsed = time.perf_counter() - started
    avg_fps = frame_count / elapsed if elapsed > 0 else 0
    infer_ms = infer_time / frame_count * 1000 if frame_count else 0
    logging.info(
        "%s | кадров: %d | средний FPS: %.2f | инференс: %.1f мс/кадр",
        source_name, frame_count, avg_fps, infer_ms
    )
    logging.info(
        "%s | уникальных track_id: %d | с нарушениями: %d | события: %s",
        source_name, len(seen_ids), len(violation_ids), dict(event_counts)
    )
    logging.info("JSONL: %s ; %s", tracks_path, events_path)
    if save_video and writer is not None:
        logging.info("Видео: %s", video_path)


def main():
    parser = argparse.ArgumentParser(description="RTSP/video PPE tracking")
    parser.add_argument("--source", required=True,
                        help="видеофайл, папка, RTSP URL, номер камеры или env:ИМЯ")
    parser.add_argument("--config", default="config.yaml")
    parser.add_argument("--camera-id", type=int, default=None)
    parser.add_argument("--video-id", type=int, default=None)
    parser.add_argument("--show", action="store_true")
    parser.add_argument("--save-video", action="store_true",
                        help="сохранять выходное видео для RTSP")
    parser.add_argument("--no-video", action="store_true",
                        help="не сохранять видео для файлов")
    parser.add_argument("--stride", type=int, default=1,
                        help="для файлов обрабатывать каждый N-й кадр")
    parser.add_argument("--max-frames", type=int, default=0)
    parser.add_argument("--max-seconds", type=float, default=0)
    parser.add_argument("--idle-timeout", type=float, default=60)
    args = parser.parse_args()

    if args.stride < 1:
        parser.error("--stride должен быть не меньше 1")

    config_path = Path(args.config).resolve()
    args.base_dir = config_path.parent
    cfg = load_config(config_path)

    model_path = resolve_path(cfg["model"], args.base_dir)
    if not model_path.is_file():
        raise SystemExit(f"Не найден файл модели: {model_path}")

    setup_logging(resolve_path(cfg["log_file"], args.base_dir))
    logging.info("Загружаю PPE-модель: %s", model_path)

    source_value = resolve_source(args.source)
    is_stream = (
        source_value.lower().startswith(("rtsp://", "rtsps://", "rtmp://", "http://", "https://"))
        or source_value.isdigit()
    )

    run_id = datetime.now().strftime("%Y%m%d%H%M%S")

    if is_stream:
        source_name = "camera_" + datetime.now().strftime("%Y%m%d_%H%M%S")
        if source_value.isdigit():
            # Веб-камера через отдельный reader, URL остаётся строкой.
            source = RTSPSource(source_value)
            source.url = source_value
        else:
            source = RTSPSource(source_value)

        model = YOLO(str(model_path))
        names = names_dict(model)
        check_classes(names)
        fps = float(cfg["stream_fps"])

        def iterator():
            yield from stream_frames(source, args.idle_timeout)

        try:
            process(source_name, iterator(), fps, True, model, names, cfg, args, run_id)
        finally:
            source.close()
        return

    source_path = Path(source_value)
    if not source_path.is_absolute():
        source_path = (Path.cwd() / source_path).resolve()

    if source_path.is_dir():
        videos = sorted(p for p in source_path.iterdir()
                        if p.suffix.lower() in VIDEO_EXTENSIONS)
    elif source_path.is_file():
        videos = [source_path]
    else:
        raise SystemExit(f"Источник не найден: {source_path}")

    if not videos:
        raise SystemExit(f"В папке нет видео: {source_path}")

    for video in videos:
        model = YOLO(str(model_path))  # новый экземпляр сбрасывает состояние ByteTrack
        names = names_dict(model)
        check_classes(names)
        frames, fps = file_frames(video, args.stride, datetime.now().astimezone())
        logging.info("Обрабатываю: %s", video)
        process(video.stem, frames, fps, False, model, names, cfg, args, run_id)


if __name__ == "__main__":
    main()
