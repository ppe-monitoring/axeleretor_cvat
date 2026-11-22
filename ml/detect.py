"""Этап 3: находим людей и СИЗ на видео обученной моделью (best.pt).

Что делает скрипт:
1. Открывает видеофайл (или все видео из папки).
2. На каждом кадре ищет объекты моделью СИЗ: люди, каски, жилеты, перчатки и их отсутствие.
3. Оставляет только нужные классы (show_classes) и применяет порог уверенности для каждого класса.
4. Рисует рамки: нарушения красным, СИЗ зелёным, люди синим. Сохраняет видео.
5. Пишет результат в .jsonl (одна строка = один кадр): классы, рамки, коды нарушений.
6. Пишет в лог скорость работы и число найденных объектов по классам.

Названия классов и коды нарушений задаются в config.yaml, в коде их нет.

Запуск (из папки ml):
    python detect.py --source data/videos/light_close.mp4
    python detect.py --source data/videos                      (все видео из папки)
    python detect.py --source data/videos/a.mp4 --model best.pt --show
"""
import argparse
import json
import logging
import time
from collections import Counter
from pathlib import Path

import cv2
import yaml
from ultralytics import YOLO

VIDEO_EXTENSIONS = {".mp4", ".avi", ".mov", ".mkv"}

# Цвета в формате BGR (так их понимает OpenCV)
COLOR_VIOLATION = (0, 0, 255)   # красный: нарушение
COLOR_PERSON = (255, 140, 0)    # синий: человек
COLOR_OK = (0, 200, 0)          # зелёный: СИЗ на месте
PERSON_CLASS = "Person"


def load_config(path):
    """Читаем настройки из config.yaml."""
    with open(path, encoding="utf-8") as f:
        return yaml.safe_load(f)


def setup_logging(log_file):
    """Лог пишем и в файл, и на экран."""
    Path(log_file).parent.mkdir(parents=True, exist_ok=True)
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s | %(levelname)s | %(message)s",
        handlers=[
            logging.FileHandler(log_file, encoding="utf-8"),
            logging.StreamHandler(),
        ],
    )


def collect_videos(source):
    """Из пути делаем список видеофайлов (один файл или вся папка)."""
    source = Path(source)
    if source.is_file():
        return [source]
    if source.is_dir():
        return sorted(p for p in source.iterdir() if p.suffix.lower() in VIDEO_EXTENSIONS)
    return []


def prepare_classes(model, cfg):
    """Переводим названия классов из config.yaml в номера классов модели.

    Если название из конфига не найдено в модели (опечатка или другая модель),
    пишем предупреждение, а не молча игнорируем.
    """
    name_to_id = {name: class_id for class_id, name in model.names.items()}
    logging.info("Классы модели: %s", ", ".join(f"{i}={n}" for i, n in model.names.items()))

    def lookup(name, section):
        if name not in name_to_id:
            logging.warning("Класс '%s' (секция %s) не найден в модели, пропускаю", name, section)
            return None
        return name_to_id[name]

    show_ids = sorted(
        i for i in (lookup(n, "show_classes") for n in cfg["show_classes"]) if i is not None
    )
    thresholds = {}
    for name, value in (cfg.get("class_conf") or {}).items():
        class_id = lookup(name, "class_conf")
        if class_id is not None:
            thresholds[class_id] = float(value)
    violation_by_id = {}
    for name, code in (cfg.get("violation_codes") or {}).items():
        class_id = lookup(name, "violation_codes")
        if class_id is not None:
            violation_by_id[class_id] = code
    return show_ids, thresholds, violation_by_id


def parse_detections(result, names, thresholds, default_conf, violation_by_id, dropped=None):
    """Достаём из результата модели список объектов в нашем формате.

    Если передан список dropped, в него попадают объекты, отброшенные порогом
    (название класса, уверенность): так видно, что модель «почти увидела».
    """
    detections = []
    for box in result.boxes:
        class_id = int(box.cls[0])
        confidence = float(box.conf[0])
        # У каждого класса может быть свой порог уверенности.
        if confidence < thresholds.get(class_id, default_conf):
            if dropped is not None:
                dropped.append((names[class_id], confidence))
            continue
        x1, y1, x2, y2 = box.xyxy[0].tolist()
        detections.append(
            {
                "class": names[class_id],
                "class_id": class_id,
                "bbox": [round(v, 1) for v in (x1, y1, x2, y2)],
                "confidence": round(confidence, 3),
                "violation": violation_by_id.get(class_id),  # код нарушения или None
            }
        )
    return detections


def draw_detections(frame, detections):
    """Рисуем рамки и подписи. Нарушения красные, люди синие, СИЗ зелёные."""
    out = frame.copy()
    for d in detections:
        x1, y1, x2, y2 = (int(v) for v in d["bbox"])
        if d["violation"]:
            color = COLOR_VIOLATION
        elif d["class"] == PERSON_CLASS:
            color = COLOR_PERSON
        else:
            color = COLOR_OK
        cv2.rectangle(out, (x1, y1), (x2, y2), color, 2)

        label = f'{d["class"]} {d["confidence"]:.2f}'
        (text_w, text_h), baseline = cv2.getTextSize(label, cv2.FONT_HERSHEY_SIMPLEX, 0.5, 1)
        top = max(y1 - text_h - baseline, 0)
        cv2.rectangle(out, (x1, top), (x1 + text_w, top + text_h + baseline), color, -1)
        cv2.putText(out, label, (x1, top + text_h), cv2.FONT_HERSHEY_SIMPLEX, 0.5,
                    (255, 255, 255), 1, cv2.LINE_AA)
    return out


def process_video(video_path, model, cfg, class_setup, show=False):
    """Обрабатываем одно видео от начала до конца."""
    show_ids, thresholds, violation_by_id = class_setup

    cap = cv2.VideoCapture(str(video_path))
    if not cap.isOpened():
        logging.error("Не удалось открыть видео: %s", video_path)
        return

    fps_in = cap.get(cv2.CAP_PROP_FPS) or 25.0
    width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    expected_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))

    out_dir = Path(cfg["output_dir"])
    out_dir.mkdir(parents=True, exist_ok=True)
    video_out = out_dir / f"{video_path.stem}_detected.mp4"
    json_out = out_dir / f"{video_path.stem}_detections.jsonl"

    writer = cv2.VideoWriter(
        str(video_out), cv2.VideoWriter_fourcc(*"mp4v"), fps_in, (width, height)
    )

    # Нижняя граница порога для самой модели: самый низкий из всех порогов.
    min_conf = min([cfg["conf"]] + list(thresholds.values()))
    model_version = cfg.get("model_version", "unknown")

    frame_id = 0
    infer_time = 0.0
    class_counts = Counter()        # сколько раз встретился каждый класс
    violation_frames = Counter()    # в скольких кадрах был каждый код нарушения
    dropped_counts = Counter()      # сколько раз объект класса отсеял порог уверенности
    dropped_max = {}                # самая высокая уверенность среди отсеянных
    t_start = time.perf_counter()

    with open(json_out, "w", encoding="utf-8") as jf:
        while True:
            ok, frame = cap.read()
            if not ok:
                break

            t0 = time.perf_counter()
            result = model.predict(
                frame,
                classes=show_ids,
                conf=min_conf,
                iou=cfg["iou"],
                imgsz=cfg["imgsz"],
                verbose=False,
            )[0]
            infer_time += time.perf_counter() - t0

            dropped = []
            detections = parse_detections(
                result, model.names, thresholds, cfg["conf"], violation_by_id, dropped
            )
            for name, confidence in dropped:
                dropped_counts[name] += 1
                dropped_max[name] = max(dropped_max.get(name, 0.0), confidence)
            codes = sorted({d["violation"] for d in detections if d["violation"]})

            record = {
                "source": video_path.name,
                "frame_id": frame_id,
                "timestamp": round(frame_id / fps_in, 3),
                "model_version": model_version,
                "detections": detections,
                "violations": codes,
            }
            jf.write(json.dumps(record, ensure_ascii=False) + "\n")

            annotated = draw_detections(frame, detections)
            writer.write(annotated)

            if show:
                cv2.imshow("detect (q - выход)", annotated)
                if cv2.waitKey(1) & 0xFF == ord("q"):
                    logging.info("Остановлено пользователем")
                    break

            frame_id += 1
            class_counts.update(d["class"] for d in detections)
            violation_frames.update(codes)

    cap.release()
    writer.release()
    if show:
        cv2.destroyAllWindows()

    total_time = time.perf_counter() - t_start
    avg_fps = frame_id / total_time if total_time > 0 else 0.0
    ms_per_frame = (infer_time / frame_id * 1000) if frame_id else 0.0

    logging.info(
        "%s | кадров: %d из %d | средний FPS: %.1f | инференс: %.1f мс/кадр",
        video_path.name, frame_id, expected_frames, avg_fps, ms_per_frame,
    )
    logging.info("%s | объектов по классам: %s", video_path.name,
                 dict(class_counts) if class_counts else "ничего не найдено")
    logging.info("%s | кадров с нарушением по кодам: %s", video_path.name,
                 dict(violation_frames) if violation_frames else "нет")
    if dropped_counts:
        details = {
            name: f"{count} раз, макс. уверенность {dropped_max[name]:.2f}"
            for name, count in dropped_counts.items()
        }
        logging.info("%s | отсеяно порогом уверенности: %s", video_path.name, details)
    else:
        logging.info("%s | порогом ничего не отсеяно", video_path.name)
    if expected_frames and frame_id < expected_frames:
        logging.warning(
            "%s: обработано меньше кадров, чем ожидалось (%d из %d)",
            video_path.name, frame_id, expected_frames,
        )


def main():
    parser = argparse.ArgumentParser(description="Поиск людей и СИЗ на видео")
    parser.add_argument("--source", required=True, help="видеофайл или папка с видео")
    parser.add_argument("--config", default="config.yaml", help="файл настроек")
    parser.add_argument("--model", help="файл весов (перекрывает model из config.yaml)")
    parser.add_argument("--show", action="store_true", help="показывать окно с видео")
    args = parser.parse_args()

    cfg = load_config(args.config)
    if args.model:
        cfg["model"] = args.model
    setup_logging(cfg["log_file"])

    videos = collect_videos(args.source)
    if not videos:
        logging.error("Видео не найдено по пути: %s", args.source)
        return

    if not Path(cfg["model"]).exists():
        logging.warning(
            "Файл модели '%s' не найден рядом. Ultralytics попробует скачать его сам, "
            "это работает только для стандартных моделей (например yolov8n.pt). "
            "Для своей модели положите best.pt в папку ml.", cfg["model"],
        )

    logging.info("Загружаем модель %s (версия: %s)", cfg["model"], cfg.get("model_version", "unknown"))
    model = YOLO(cfg["model"])

    class_setup = prepare_classes(model, cfg)
    if not class_setup[0]:
        logging.error("Ни один класс из show_classes не найден в модели. Проверьте config.yaml.")
        return

    for video in videos:
        process_video(video, model, cfg, class_setup, show=args.show)


if __name__ == "__main__":
    main()