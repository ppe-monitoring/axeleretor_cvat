"""Этап 4: видеопоток (RTSP или файл), трекинг людей и привязка СИЗ к человеку.

Как это работает:
1. Кадры берутся из файла, папки с видео, веб-камеры или RTSP-потока.
2. Готовая модель YOLOv8n (COCO) находит людей, трекер ByteTrack даёт каждому номер track_id.
3. Модель СИЗ (ppe_v2.pt) находит каски, жилеты, перчатки и их отсутствие.
4. Каждый предмет СИЗ привязывается к человеку по положению внутри его рамки.
5. По последним кадрам (окно) для каждого человека принимается решение «есть нарушение»:
   так одно ошибочное срабатывание не создаёт нарушение, а мигающая рамка не мигает.
6. Результаты пишутся в три файла (папка outputs):
   *_tracks.jsonl     по кадрам: люди, их track_id и статус СИЗ
   *_events.jsonl     события нарушений в формате бэкенда (POST /api/violations/)
   *_summaries.jsonl  сводки раз в минуту (POST /api/summaries/)

Запуск (из папки ml):
    python track_ppe.py --source data/videos/light_close.mp4
    python track_ppe.py --source data/videos --camera-id 1 --video-id 5
    python track_ppe.py --source "rtsp://логин:пароль@192.168.1.64:554/stream1" --camera-id 1
    python track_ppe.py --source env:CAMERA_URL --camera-id 1      (адрес в переменной окружения)

Пароль камеры лучше не вписывать в команду: задайте адрес в переменной окружения CAMERA_URL.
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
STREAM_PREFIXES = ("rtsp://", "rtsps://", "rtmp://", "http://", "https://")

COLOR_VIOLATION = (0, 0, 255)    # красный (BGR)
COLOR_OK = (0, 200, 0)           # зелёный
COLOR_UNKNOWN = (160, 160, 160)  # серый: данных мало, решение не принято


# ---------------------------------------------------------------- общие мелочи

def load_config(path):
    with open(path, encoding="utf-8") as f:
        return yaml.safe_load(f)


def setup_logging(log_file):
    Path(log_file).parent.mkdir(parents=True, exist_ok=True)
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s | %(levelname)s | %(message)s",
        handlers=[logging.FileHandler(log_file, encoding="utf-8"), logging.StreamHandler()],
    )


def mask_url(url):
    """Прячем логин и пароль камеры, чтобы они не попадали в лог."""
    return re.sub(r"//[^/@]*@", "//***@", url)


def resolve_source(value):
    """Значение env:ИМЯ означает «взять адрес из переменной окружения»."""
    if value.startswith("env:"):
        name = value[4:]
        url = os.environ.get(name)
        if not url:
            raise SystemExit(f"Переменная окружения {name} не задана. "
                             f'В PowerShell: $env:{name} = "rtsp://..."')
        return url
    return value


def source_kind(source):
    if source.lower().startswith(STREAM_PREFIXES):
        return "stream"
    if source.isdigit():
        return "camera"
    return "file"


# ---------------------------------------------------------------- источники кадров

class FileSource:
    """Видеофайл: кадры идут по порядку, время = начало + номер кадра / FPS."""

    def __init__(self, path, stride, start_dt):
        self.path = Path(path)
        self.name = self.path.stem
        self.stride = max(1, stride)
        self.start_dt = start_dt
        self.cap = cv2.VideoCapture(str(self.path))
        self.fps = (self.cap.get(cv2.CAP_PROP_FPS) or 25.0) if self.cap.isOpened() else 25.0
        self.expected = int(self.cap.get(cv2.CAP_PROP_FRAME_COUNT)) if self.cap.isOpened() else 0

    def opened(self):
        return self.cap.isOpened()

    def frames(self):
        index = 0
        while True:
            ok, frame = self.cap.read()
            if not ok:
                break
            if index % self.stride == 0:
                seconds = index / self.fps
                yield frame, index, seconds, self.start_dt + timedelta(seconds=seconds)
            index += 1
        self.cap.release()

    def close(self):
        self.cap.release()


class StreamSource:
    """RTSP-поток или веб-камера.

    Читает кадры в отдельном потоке и хранит только самый свежий: если нейросеть
    не успевает, старые кадры выбрасываются, а картинка не отстаёт от жизни.
    При обрыве связи переподключается сама.
    """

    def __init__(self, url, name, assumed_fps=10.0, reconnect_delay=3.0):
        self.url = url
        self.name = name
        self.fps = assumed_fps
        self.reconnect_delay = reconnect_delay
        self.reconnects = 0
        self._frame = None
        self._lock = threading.Lock()
        self._new = threading.Event()
        self._stop = threading.Event()
        os.environ.setdefault("OPENCV_FFMPEG_CAPTURE_OPTIONS", "rtsp_transport;tcp")
        self._thread = threading.Thread(target=self._run, daemon=True)

    def _open(self):
        if self.url.isdigit():
            return cv2.VideoCapture(int(self.url))
        return cv2.VideoCapture(self.url, cv2.CAP_FFMPEG)

    def _run(self):
        while not self._stop.is_set():
            cap = self._open()
            if not cap.isOpened():
                logging.warning("Не удалось подключиться к %s, повтор через %.0f с",
                                mask_url(self.url), self.reconnect_delay)
                cap.release()
                self.reconnects += 1
                self._stop.wait(self.reconnect_delay)
                continue
            logging.info("Подключились к %s", mask_url(self.url))
            while not self._stop.is_set():
                ok, frame = cap.read()
                if not ok:
                    logging.warning("Поток прервался, переподключаюсь")
                    break
                with self._lock:
                    self._frame = frame
                self._new.set()
            cap.release()
            self.reconnects += 1
            self._stop.wait(self.reconnect_delay)

    def opened(self):
        self._thread.start()
        return True

    def read(self, timeout):
        """Ждём свежий кадр. Если за timeout секунд ничего не пришло, возвращаем None."""
        if not self._new.wait(timeout):
            return None
        self._new.clear()
        with self._lock:
            return self._frame

    def frames(self, idle_timeout):
        t0 = time.monotonic()
        index = 0
        idle_since = time.monotonic()
        while True:
            frame = self.read(timeout=1.0)
            if frame is None:
                if idle_timeout and time.monotonic() - idle_since > idle_timeout:
                    logging.error("Нет кадров %.0f с, останавливаюсь", idle_timeout)
                    break
                continue
            idle_since = time.monotonic()
            yield frame, index, time.monotonic() - t0, datetime.now().astimezone()
            index += 1

    def close(self):
        self._stop.set()


# ---------------------------------------------------------------- геометрия и привязка

def box_area(b):
    return max(0.0, b[2] - b[0]) * max(0.0, b[3] - b[1])


def containment(item, person):
    """Какая доля рамки предмета лежит внутри рамки человека (от 0 до 1)."""
    ix1, iy1 = max(item[0], person[0]), max(item[1], person[1])
    ix2, iy2 = min(item[2], person[2]), min(item[3], person[3])
    inter = max(0.0, ix2 - ix1) * max(0.0, iy2 - iy1)
    area = box_area(item)
    return inter / area if area > 0 else 0.0


def assign_items(persons, items, items_cfg, min_containment):
    """Привязываем каждый найденный предмет СИЗ к одному человеку.

    Предмет принадлежит человеку, если он (1) почти целиком внутри рамки человека и
    (2) стоит на «своей» высоте: каска в верхней части, жилет в середине и т.д.
    Если подходит несколько людей, выбираем того, у кого вложенность больше,
    а при равенстве того, кто меньше по размеру.
    """
    owned = {p["track_id"]: [] for p in persons}
    for it in items:
        lo, hi = items_cfg[it["item"]]["region"]
        center_y = (it["bbox"][1] + it["bbox"][3]) / 2
        best = None
        for p in persons:
            top, bottom = p["bbox"][1], p["bbox"][3]
            height = bottom - top
            if height <= 0:
                continue
            share = containment(it["bbox"], p["bbox"])
            if share < min_containment:
                continue
            if not (lo <= (center_y - top) / height <= hi):
                continue
            key = (share, -box_area(p["bbox"]))
            if best is None or key > best[0]:
                best = (key, p)
        if best is not None:
            owned[best[1]["track_id"]].append(it)
    return owned


def observe(person_items, item_name):
    """Что видно у человека по одному виду СИЗ в этом кадре: pos (есть), neg (нет), none (не видно)."""
    pos = max((i["conf"] for i in person_items if i["item"] == item_name and i["polarity"] == "pos"),
              default=0.0)
    neg = max((i["conf"] for i in person_items if i["item"] == item_name and i["polarity"] == "neg"),
              default=0.0)
    if neg > pos:
        return "neg", neg
    if pos > 0:
        return "pos", pos
    return "none", 0.0


# ---------------------------------------------------------------- состояние человека и решение

class TrackState:
    """Память о человеке: последние наблюдения по каждому СИЗ и служебные отметки."""

    def __init__(self, window, item_names, frame_index):
        self.obs = {name: deque(maxlen=window) for name in item_names}
        self.last_seen = frame_index
        self.last_emit = None
        self.emitted_codes = set()


def decide(state, item_name, rules, absence_on):
    """Решаем по окну последних кадров, есть ли нарушение по этому СИЗ.

    Нарушение, если: доля кадров с «NO-…» не меньше neg_rate_min (модель прямо видит отсутствие)
    или (если включено) доля кадров с СИЗ не больше pos_rate_max (СИЗ почти не находили).
    """
    obs = state.obs[item_name]
    n = len(obs)
    if n < rules["min_frames"]:
        return None
    neg = [c for kind, c in obs if kind == "neg"]
    pos = [c for kind, c in obs if kind == "pos"]
    if len(neg) / n >= rules["neg_rate_min"]:
        return {"confidence": sum(neg) / len(neg), "basis": "class"}
    if absence_on and len(pos) / n <= rules["pos_rate_max"]:
        return {"confidence": 1.0 - len(pos) / n, "basis": "absence"}
    return None


# ---------------------------------------------------------------- модели

def track_persons(person_model, frame, cfg):
    """Находим людей и присваиваем им номера (track_id)."""
    result = person_model.track(
        frame, persist=True, tracker=cfg["tracker"], classes=[0], conf=cfg["person_conf"],
        iou=cfg["iou"], imgsz=cfg["imgsz"], verbose=False,
    )[0]
    boxes = result.boxes
    if boxes is None or len(boxes) == 0:
        return []
    xyxy, confs = boxes.xyxy.tolist(), boxes.conf.tolist()
    ids = boxes.id.tolist() if boxes.id is not None else [None] * len(xyxy)
    persons = []
    for box, conf, track_id in zip(xyxy, confs, ids):
        if track_id is None:      # трекер ещё не подтвердил этого человека
            continue
        persons.append({"track_id": int(track_id), "bbox": [float(v) for v in box], "conf": float(conf)})
    return persons


def detect_ppe(ppe_model, frame, cfg, class_map, show_ids, thresholds, min_conf):
    """Находим СИЗ и приводим к списку предметов с видом (item) и знаком (pos/neg)."""
    result = ppe_model.predict(
        frame, classes=show_ids, conf=min_conf, iou=cfg["iou"], imgsz=cfg["imgsz"], verbose=False,
    )[0]
    boxes = result.boxes
    if boxes is None or len(boxes) == 0:
        return []
    items = []
    for box, cls, conf in zip(boxes.xyxy.tolist(), boxes.cls.tolist(), boxes.conf.tolist()):
        name = ppe_model.names[int(cls)]
        if conf < thresholds.get(name, cfg["ppe_conf"]):
            continue
        item, polarity = class_map[name]
        items.append({"item": item, "polarity": polarity, "class": name,
                      "conf": float(conf), "bbox": [float(v) for v in box]})
    return items


# ---------------------------------------------------------------- рисование

def draw_frame(frame, persons, owned, person_status, items):
    out = frame.copy()
    for it in items:
        x1, y1, x2, y2 = (int(v) for v in it["bbox"])
        color = COLOR_VIOLATION if it["polarity"] == "neg" else COLOR_OK
        cv2.rectangle(out, (x1, y1), (x2, y2), color, 1)
    for p in persons:
        status, codes = person_status[p["track_id"]]
        color = {"violation": COLOR_VIOLATION, "ok": COLOR_OK}.get(status, COLOR_UNKNOWN)
        x1, y1, x2, y2 = (int(v) for v in p["bbox"])
        cv2.rectangle(out, (x1, y1), (x2, y2), color, 2)
        label = f'#{p["track_id"]} ' + " ".join(codes) if codes else f'#{p["track_id"]}'
        (tw, th), base = cv2.getTextSize(label, cv2.FONT_HERSHEY_SIMPLEX, 0.5, 1)
        top = max(y1 - th - base, 0)
        cv2.rectangle(out, (x1, top), (x1 + tw, top + th + base), color, -1)
        cv2.putText(out, label, (x1, top + th), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (255, 255, 255), 1,
                    cv2.LINE_AA)
    return out


# ---------------------------------------------------------------- обработка одного источника

def run_source(source, models, setup, cfg, args, run_id):
    person_model, ppe_model = models
    class_map, show_ids, thresholds, min_conf = setup
    items_cfg, rules = cfg["items"], cfg["rules"]
    item_names = list(items_cfg)
    absence = cfg["rules"].get("absence_enabled", {})

    out_dir = Path(cfg["output_dir"])
    out_dir.mkdir(parents=True, exist_ok=True)
    base = out_dir / source.name
    tracks_f = open(f"{base}_tracks.jsonl", "w", encoding="utf-8")
    events_f = open(f"{base}_events.jsonl", "w", encoding="utf-8")
    summaries_f = open(f"{base}_summaries.jsonl", "w", encoding="utf-8")

    is_stream = isinstance(source, StreamSource)
    save_video = args.save_video or (not is_stream and not args.no_video)
    writer = None
    states = {}
    seen_in_interval, violators_in_interval = set(), set()
    next_summary = cfg["events"]["summary_interval_s"]
    events_count = Counter()
    track_ids_seen, violator_ids = set(), set()
    frames_done, infer_time = 0, 0.0
    t_start = time.perf_counter()
    last_dt = None

    def write_summary(dt):
        record = {"camera_id": args.camera_id, "timestamp": dt.isoformat(timespec="milliseconds"),
                  "people_checked": len(seen_in_interval), "violators": len(violators_in_interval),
                  "model_version": cfg["model_version"]}
        summaries_f.write(json.dumps(record, ensure_ascii=False) + "\n")
        seen_in_interval.clear()
        violators_in_interval.clear()

    frame_iter = source.frames(args.idle_timeout) if is_stream else source.frames()
    try:
        for frame, index, seconds, dt in frame_iter:
            last_dt = dt
            height, width = frame.shape[:2]
            t0 = time.perf_counter()
            persons = track_persons(person_model, frame, cfg)
            items = detect_ppe(ppe_model, frame, cfg, class_map, show_ids, thresholds, min_conf) \
                if persons else []
            infer_time += time.perf_counter() - t0

            owned = assign_items(persons, items, items_cfg, rules["min_containment"])
            person_status, person_records = {}, []

            for p in persons:
                tid = p["track_id"]
                state = states.setdefault(tid, TrackState(rules["window"], item_names, index))
                state.last_seen = index
                judged = (p["bbox"][3] - p["bbox"][1]) / height >= rules["min_person_height_frac"]
                frame_view = {}
                if judged:
                    for name in item_names:
                        kind, conf = observe(owned[tid], name)
                        state.obs[name].append((kind, conf))
                        frame_view[name] = kind
                    seen_in_interval.add(tid)
                    track_ids_seen.add(tid)

                active = {}
                if judged:
                    for name in item_names:
                        verdict = decide(state, name, rules, absence.get(name, False))
                        if verdict:
                            active[items_cfg[name]["code"]] = verdict
                if active:
                    violators_in_interval.add(tid)
                    violator_ids.add(tid)
                status = "violation" if active else ("ok" if judged and
                                                      len(state.obs[item_names[0]]) >= rules["min_frames"]
                                                      else "unknown")
                person_status[tid] = (status, sorted(active))

                # Событие для бэкенда: сразу при появлении нарушения и затем не чаще раза в interval_s.
                if active:
                    new_codes = set(active) - state.emitted_codes
                    due = state.last_emit is None or seconds - state.last_emit >= cfg["events"]["interval_s"]
                    if new_codes or due:
                        event = {
                            "event_id": f"{run_id}-t{tid}-f{index}",
                            "camera_id": args.camera_id, "video_id": args.video_id,
                            "track_id": tid, "frame_number": index,
                            "timestamp": dt.isoformat(timespec="milliseconds"),
                            "frame_width": width, "frame_height": height,
                            "model_version": cfg["model_version"],
                            "bbox": [round(v, 1) for v in p["bbox"]],
                            "violations": [{"code": code, "confidence": round(v["confidence"], 3)}
                                           for code, v in sorted(active.items())],
                        }
                        events_f.write(json.dumps(event, ensure_ascii=False) + "\n")
                        events_count.update(list(active))
                        state.last_emit = seconds
                        state.emitted_codes |= set(active)
                else:
                    state.emitted_codes = set()

                person_records.append({
                    "track_id": tid, "bbox": [round(v, 1) for v in p["bbox"]],
                    "confidence": round(p["conf"], 3), "judged": judged, "items": frame_view,
                    "status": status,
                    "violations": [{"code": c, "confidence": round(v["confidence"], 3), "basis": v["basis"]}
                                   for c, v in sorted(active.items())],
                })

            tracks_f.write(json.dumps({
                "source": source.name, "frame_id": index, "timestamp_s": round(seconds, 3),
                "time": dt.isoformat(timespec="milliseconds"), "persons": person_records,
            }, ensure_ascii=False) + "\n")

            if save_video or args.show:
                annotated = draw_frame(frame, persons, owned, person_status, items)
                if save_video:
                    if writer is None:
                        writer = cv2.VideoWriter(f"{base}_tracked.mp4", cv2.VideoWriter_fourcc(*"mp4v"),
                                                 source.fps / getattr(source, "stride", 1), (width, height))
                    writer.write(annotated)
                if args.show:
                    cv2.imshow("track_ppe (q - выход)", annotated)
                    if cv2.waitKey(1) & 0xFF == ord("q"):
                        logging.info("Остановлено пользователем")
                        break

            if seconds >= next_summary:
                write_summary(dt)
                next_summary += cfg["events"]["summary_interval_s"]

            # Забываем людей, которых давно не видели (чтобы память не росла на длинных потоках).
            if frames_done % 200 == 0:
                for tid in [t for t, s in states.items() if index - s.last_seen > 600]:
                    del states[tid]

            frames_done += 1
            if args.max_frames and frames_done >= args.max_frames:
                break
            if args.max_seconds and seconds >= args.max_seconds:
                break
    except KeyboardInterrupt:
        logging.info("Остановлено (Ctrl+C)")
    finally:
        if last_dt is not None and (seen_in_interval or violators_in_interval):
            write_summary(last_dt)
        for f in (tracks_f, events_f, summaries_f):
            f.close()
        if writer is not None:
            writer.release()
        if args.show:
            cv2.destroyAllWindows()
        source.close()

    total = time.perf_counter() - t_start
    logging.info("%s | кадров обработано: %d | средний FPS: %.1f | нейросети: %.1f мс/кадр",
                 source.name, frames_done, frames_done / total if total > 0 else 0.0,
                 infer_time / frames_done * 1000 if frames_done else 0.0)
    logging.info("%s | людей оценено (уникальных track_id): %d, из них с нарушением: %d",
                 source.name, len(track_ids_seen), len(violator_ids))
    logging.info("%s | событий по кодам: %s", source.name, dict(events_count) if events_count else "нет")


# ---------------------------------------------------------------- запуск

def main():
    parser = argparse.ArgumentParser(description="Трекинг людей и привязка СИЗ к человеку")
    parser.add_argument("--source", required=True,
                        help="файл, папка, rtsp://..., номер веб-камеры или env:ИМЯ_ПЕРЕМЕННОЙ")
    parser.add_argument("--config", default="pipeline.yaml", help="файл настроек")
    parser.add_argument("--camera-id", type=int, default=None, help="id камеры в бэкенде")
    parser.add_argument("--video-id", type=int, default=None, help="id видео в бэкенде (для файлов)")
    parser.add_argument("--start-time", help="время начала файла, ISO (по умолчанию: сейчас)")
    parser.add_argument("--run-id", help="метка запуска для event_id (по умолчанию: дата и время)")
    parser.add_argument("--stride", type=int, default=1, help="для файлов: брать каждый N-й кадр")
    parser.add_argument("--show", action="store_true", help="показывать окно")
    parser.add_argument("--save-video", action="store_true", help="сохранять видео и для потока")
    parser.add_argument("--no-video", action="store_true", help="для файлов не сохранять видео")
    parser.add_argument("--max-seconds", type=float, default=0, help="остановиться через N секунд")
    parser.add_argument("--max-frames", type=int, default=0, help="остановиться после N кадров")
    parser.add_argument("--idle-timeout", type=float, default=60,
                        help="поток: остановиться, если кадров нет N секунд (0 = ждать бесконечно)")
    args = parser.parse_args()

    cfg = load_config(args.config)
    setup_logging(cfg["log_file"])
    run_id = args.run_id or datetime.now().strftime("%Y%m%d%H%M%S")
    start_dt = (datetime.fromisoformat(args.start_time) if args.start_time
                else datetime.now()).astimezone()

    value = resolve_source(args.source)
    kind = source_kind(value)

    logging.info("Загружаем модели: люди %s, СИЗ %s (версия %s)",
                 cfg["person_model"], cfg["ppe_model"], cfg["model_version"])
    ppe_model = YOLO(cfg["ppe_model"])

    class_map = {}
    for item, spec in cfg["items"].items():
        class_map[spec["positive"]] = (item, "pos")
        class_map[spec["negative"]] = (item, "neg")
    unknown = [n for n in class_map if n not in ppe_model.names.values()]
    for name in unknown:
        logging.warning("Класс '%s' из pipeline.yaml не найден в модели СИЗ", name)
    show_ids = sorted(i for i, n in ppe_model.names.items() if n in class_map)
    if not show_ids:
        logging.error("Ни один класс СИЗ из pipeline.yaml не найден в модели. Проверьте настройки.")
        return
    thresholds = {k: float(v) for k, v in (cfg.get("ppe_class_conf") or {}).items()}
    min_conf = min([cfg["ppe_conf"]] + list(thresholds.values()))
    setup = (class_map, show_ids, thresholds, min_conf)

    sources = []
    if kind == "file":
        path = Path(value)
        if path.is_dir():
            sources = [("file", p) for p in sorted(path.iterdir()) if p.suffix.lower() in VIDEO_EXTENSIONS]
        elif path.is_file():
            sources = [("file", path)]
    else:
        sources = [(kind, value)]
    if not sources:
        logging.error("Источник не найден: %s", mask_url(value))
        return

    for kind_i, item in sources:
        # Новая копия модели людей на каждый источник: так номера трекера начинаются заново.
        person_model = YOLO(cfg["person_model"])
        if kind_i == "file":
            source = FileSource(item, args.stride, start_dt)
            if not source.opened():
                logging.error("Не удалось открыть видео: %s", item)
                continue
        else:
            name = f"{'camera' if kind_i == 'camera' else 'stream'}_{datetime.now():%Y%m%d_%H%M%S}"
            source = StreamSource(item, name, assumed_fps=cfg.get("stream_fps", 10.0))
            source.opened()
        logging.info("Источник: %s", source.name)
        run_source(source, (person_model, ppe_model), setup, cfg, args, run_id)


if __name__ == "__main__":
    main()