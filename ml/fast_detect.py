"""Быстрая обработка видео моделью СИЗ: пропуск кадров, пакетная обработка, замер FPS.

Что здесь есть:
1. frame skipping (stride): модель смотрит только каждый N-й кадр, на остальных
   кадрах показываем последние найденные рамки.
2. batch processing (batch): несколько кадров отправляются в модель одним пакетом.
   На видеокарте это заметно быстрее, на процессоре выигрыш обычно небольшой.
3. режим bench: прогоняет несколько режимов на одном видео, печатает таблицу
   и сохраняет её в fps_results.csv и fps_results.md (для отчёта).

Примеры (из папки ml):
    python fast_detect.py bench --weights ppe_v2.pt --video test.mp4
    python fast_detect.py run   --weights ppe_v2.pt --video test.mp4 --stride 2 --batch 4 --save out.mp4

Важно: при stride > 1 рамки на пропущенных кадрах чуть отстают от движения людей,
а при batch > 1 появляется задержка в batch * stride кадров. Для онлайн-камеры
берите небольшой batch (1-2), для обработки готовых видеофайлов можно больше.
"""
import argparse
import csv
import platform
import statistics
import time
from pathlib import Path

import cv2
import numpy as np

EMPTY = (np.zeros((0, 4), np.float32), np.zeros((0,), int), np.zeros((0,), np.float32))

# (название режима, stride, batch), первый режим - база для сравнения
CONFIGS = [
    ("база: каждый кадр, batch 1", 1, 1),
    ("пропуск: каждый 2-й кадр", 2, 1),
    ("пропуск: каждый 3-й кадр", 3, 1),
    ("batch 4", 1, 4),
    ("batch 8", 1, 8),
    ("пропуск 2 + batch 4", 2, 4),
]


# ---------- Модель ----------

def make_predict_fn(weights, imgsz=640, conf=0.25, device=None, half=False):
    """Возвращает функцию predict(список кадров) -> список (рамки, классы, уверенность)."""
    from ultralytics import YOLO  # импорт здесь, чтобы остальной код работал без ultralytics

    if half:
        import torch
        half = torch.cuda.is_available()  # FP16 имеет смысл только на видеокарте
        if not half:
            print("half=True проигнорирован: видеокарты нет")

    model = YOLO(weights)

    # 'half' передаём только когда он нужен: в новых версиях ultralytics сам этот
    # аргумент вызывает предупреждение на каждый вызов модели
    kwargs = dict(imgsz=imgsz, conf=conf, device=device, verbose=False)
    if half:
        kwargs["half"] = True

    def predict(frames):
        results = model.predict(frames, **kwargs)
        out = []
        for r in results:
            b = r.boxes
            out.append((b.xyxy.cpu().numpy(), b.cls.cpu().numpy().astype(int),
                        b.conf.cpu().numpy()))
        return out

    return predict, model.names


# ---------- Основной цикл ----------

def draw(frame, dets, names):
    boxes, classes, confs = dets
    for (x1, y1, x2, y2), c, p in zip(boxes, classes, confs):
        x1, y1, x2, y2 = int(x1), int(y1), int(x2), int(y2)
        cv2.rectangle(frame, (x1, y1), (x2, y2), (0, 255, 0), 2)
        label = f"{names[int(c)]} {p:.2f}" if names else f"{int(c)} {p:.2f}"
        cv2.putText(frame, label, (x1, max(y1 - 5, 12)),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.5, (0, 255, 0), 1)


def run_pipeline(predict, source, stride=1, batch=1, max_frames=None,
                 save_path=None, names=None):
    """Обрабатывает видео и возвращает словарь с измерениями.

    Кадр отдаётся на модель, если его номер делится на stride. Выбранные кадры
    копятся в пакет из batch штук. На остальных кадрах используются последние
    найденные рамки. Каждый кадр видео попадает в результат ровно один раз.
    """
    if stride < 1 or batch < 1:
        raise ValueError("stride и batch должны быть >= 1")

    cap = cv2.VideoCapture(str(source))
    if not cap.isOpened():
        raise SystemExit(f"Не удалось открыть видео: {source}")
    src_fps = cap.get(cv2.CAP_PROP_FPS) or 25.0
    width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))

    writer = None
    if save_path:
        writer = cv2.VideoWriter(str(save_path), cv2.VideoWriter_fourcc(*"mp4v"),
                                 src_fps, (width, height))

    window = []          # (кадр, выбран ли для модели) с момента прошлой отправки
    selected = 0         # сколько выбранных кадров в окне
    last = EMPTY         # последние известные рамки
    emitted = 0
    inferred = 0
    infer_time = 0.0

    def flush():
        nonlocal window, selected, last, emitted, inferred, infer_time
        if not window:
            return
        frames = [f for f, sel in window if sel]
        dets = []
        if frames:
            t = time.perf_counter()
            dets = predict(frames)
            infer_time += time.perf_counter() - t
            inferred += len(frames)
        it = iter(dets)
        for frame, sel in window:
            if sel:
                last = next(it)
            if writer is not None:
                draw(frame, last, names)
                writer.write(frame)
            emitted += 1
        window, selected = [], 0

    t0 = time.perf_counter()
    idx = 0
    while True:
        if max_frames is not None and idx >= max_frames:
            break
        ok, frame = cap.read()
        if not ok:
            break
        sel = idx % stride == 0
        window.append((frame, sel))
        selected += sel
        idx += 1
        if selected >= batch:
            flush()
    flush()
    elapsed = time.perf_counter() - t0

    cap.release()
    if writer is not None:
        writer.release()

    return {
        "frames": emitted,
        "inferred": inferred,
        "seconds": elapsed,
        "fps": emitted / elapsed if elapsed > 0 else 0.0,
        "infer_fps": inferred / infer_time if infer_time > 0 else 0.0,
        "width": width,
        "height": height,
    }


# ---------- Замер ----------

def bench(predict, video, max_frames=300, repeats=2, warmup_frames=8, configs=CONFIGS):
    """Прогоняет режимы по очереди и возвращает строки таблицы."""
    # прогрев: первые вызовы модели всегда медленнее (загрузка, выделение памяти)
    run_pipeline(predict, video, stride=1, batch=1, max_frames=warmup_frames)

    rows = []
    for label, stride, batch in configs:
        runs = [run_pipeline(predict, video, stride, batch, max_frames)
                for _ in range(repeats)]
        rows.append({
            "режим": label, "stride": stride, "batch": batch,
            "кадров": runs[0]["frames"],
            "вызовов модели": runs[0]["inferred"],
            "FPS": statistics.median(r["fps"] for r in runs),
        })
    base = rows[0]["FPS"]
    for r in rows:
        r["прирост к базе"] = r["FPS"] / base if base else 0.0
    return rows, runs[0]["width"], runs[0]["height"]


def print_table(rows):
    print(f"{'режим':32} {'stride':>6} {'batch':>5} {'модель':>7} {'FPS':>7} {'прирост':>8}")
    for r in rows:
        print(f"{r['режим']:32} {r['stride']:>6} {r['batch']:>5} "
              f"{r['вызовов модели']:>7} {r['FPS']:>7.1f} {r['прирост к базе']:>7.2f}x")


def save_results(rows, out_dir, meta):
    out_dir = Path(out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    with open(out_dir / "fps_results.csv", "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=list(rows[0].keys()))
        w.writeheader()
        for r in rows:
            w.writerow({k: (round(v, 3) if isinstance(v, float) else v) for k, v in r.items()})

    lines = ["# Замер FPS", ""]
    lines += [f"- {k}: {v}" for k, v in meta.items()]
    lines += ["", "| Режим | stride | batch | Вызовов модели | FPS | Прирост к базе |",
              "|---|---|---|---|---|---|"]
    for r in rows:
        lines.append(f"| {r['режим']} | {r['stride']} | {r['batch']} | {r['вызовов модели']} "
                     f"| {r['FPS']:.1f} | {r['прирост к базе']:.2f}x |")
    (out_dir / "fps_results.md").write_text("\n".join(lines) + "\n", encoding="utf-8")


# ---------- Командная строка ----------

def main():
    p = argparse.ArgumentParser(description="Ускорение обработки видео моделью СИЗ")
    p.add_argument("mode", choices=["run", "bench"],
                   help="run: обработать видео, bench: сравнить режимы и замерить FPS")
    p.add_argument("--weights", required=True, help="файл весов, например ppe_v2.pt")
    p.add_argument("--video", required=True, help="видеофайл (или номер камеры, например 0)")
    p.add_argument("--imgsz", type=int, default=640, help="размер кадра для модели")
    p.add_argument("--conf", type=float, default=0.25, help="порог уверенности")
    p.add_argument("--device", default=None, help="cpu или 0 (видеокарта); по умолчанию авто")
    p.add_argument("--half", action="store_true", help="FP16 (только видеокарта)")
    p.add_argument("--max-frames", type=int, default=300, help="сколько кадров обрабатывать")
    p.add_argument("--stride", type=int, default=1, help="run: смотреть каждый N-й кадр")
    p.add_argument("--batch", type=int, default=1, help="run: размер пакета")
    p.add_argument("--save", default=None, help="run: сохранить видео с рамками")
    p.add_argument("--repeats", type=int, default=2, help="bench: повторов на режим")
    p.add_argument("--out-dir", default="fps_report", help="bench: куда сохранить таблицу")
    args = p.parse_args()

    source = int(args.video) if args.video.isdigit() else args.video
    predict, names = make_predict_fn(args.weights, args.imgsz, args.conf, args.device, args.half)

    if args.mode == "run":
        m = run_pipeline(predict, source, args.stride, args.batch, args.max_frames,
                         args.save, names)
        print(f"Кадров: {m['frames']}, вызовов модели: {m['inferred']}, "
              f"время: {m['seconds']:.1f} с, FPS: {m['fps']:.1f}")
        if args.save:
            print(f"Видео с рамками: {args.save}")
        return

    rows, w, h = bench(predict, source, args.max_frames, args.repeats)
    print_table(rows)
    meta = {
        "модель": args.weights, "видео": str(args.video), "размер кадра": f"{w}x{h}",
        "imgsz": args.imgsz, "conf": args.conf, "device": args.device or "авто",
        "кадров в замере": args.max_frames, "повторов": args.repeats,
        "процессор": platform.processor() or platform.machine(),
        "дата": time.strftime("%Y-%m-%d"),
    }
    save_results(rows, args.out_dir, meta)
    print(f"Таблица сохранена: {args.out_dir}/fps_results.csv и fps_results.md")


if __name__ == "__main__":
    main()
