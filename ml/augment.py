"""Аугментация train-части датасета (формат YOLO) под трудные условия съёмки.

Что делает скрипт:
1. Берёт картинки из <dataset>/train/images.
2. Для каждой делает N изменённых копий: темнее, размытие, шум, низкий контраст,
   дымка, сильное JPEG-сжатие (так «портит» картинку дешёвая камера).
3. Копирует разметку без изменений: эти эффекты не сдвигают рамки.
4. Папки valid и test НЕ трогает (иначе оценка качества будет нечестной).
5. Сохраняет картинку-превью (до и после) и отчёт augmentation_report.json.

Повороты, отражения и масштаб здесь не делаем: их уже делает Ultralytics во время обучения.

Запуск (из папки ml):
    python augment.py --dataset data\\ppe_dataset --factor 1
    python augment.py --dataset data\\ppe_dataset --clean     (удалить созданные копии)

ВАЖНО: если автор датасета уже применил аугментацию в Roboflow (см. README.roboflow.txt),
выбирайте небольшой factor, чтобы не получить копии копий.
"""
import argparse
import json
import shutil
from collections import Counter
from pathlib import Path

import cv2
import numpy as np

IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png", ".bmp"}
SUFFIX = "_aug"  # по этому суффиксу отличаем наши копии от оригиналов


# ---------- Эффекты (каждый принимает картинку BGR uint8 и генератор случайных чисел) ----------

def darken(img, rng):
    """Слабое освещение: умножаем яркость на 0,35-0,7."""
    alpha = rng.uniform(0.35, 0.7)
    return np.clip(img.astype(np.float32) * alpha, 0, 255).astype(np.uint8)


def blur(img, rng):
    """Размытие: обычное или как от движения."""
    if rng.random() < 0.5:
        k = int(rng.choice([3, 5, 7, 9]))
        return cv2.GaussianBlur(img, (k, k), 0)
    k = int(rng.choice([5, 9, 13]))
    kernel = np.zeros((k, k), np.float32)
    kernel[k // 2, :] = 1.0
    matrix = cv2.getRotationMatrix2D(((k - 1) / 2, (k - 1) / 2), float(rng.uniform(0, 180)), 1.0)
    kernel = cv2.warpAffine(kernel, matrix, (k, k))
    kernel /= max(float(kernel.sum()), 1e-6)
    return cv2.filter2D(img, -1, kernel)


def noise(img, rng):
    """Зернистость (шум), как на тёмной съёмке."""
    sigma = rng.uniform(5, 20)
    noisy = img.astype(np.float32) + rng.normal(0, sigma, img.shape)
    return np.clip(noisy, 0, 255).astype(np.uint8)


def low_contrast(img, rng):
    """Низкий контраст: картинка «выцветает»."""
    alpha = rng.uniform(0.5, 0.8)
    mean = float(img.mean())
    return np.clip((img.astype(np.float32) - mean) * alpha + mean, 0, 255).astype(np.uint8)


def haze(img, rng):
    """Лёгкая дымка или пыль: подмешиваем светло-серый."""
    w = rng.uniform(0.15, 0.35)
    return np.clip(img.astype(np.float32) * (1 - w) + 200 * w, 0, 255).astype(np.uint8)


def jpeg(img, rng):
    """Сильное сжатие, как у видеопотока с камеры."""
    quality = int(rng.integers(15, 45))
    ok, buf = cv2.imencode(".jpg", img, [cv2.IMWRITE_JPEG_QUALITY, quality])
    return cv2.imdecode(buf, cv2.IMREAD_COLOR) if ok else img


EFFECTS = {
    "darken": darken,
    "blur": blur,
    "noise": noise,
    "low_contrast": low_contrast,
    "haze": haze,
    "jpeg": jpeg,
}


# ---------- Вспомогательные функции ----------

def read_image(path):
    """Читаем файл так, чтобы работали и русские буквы в пути."""
    data = np.fromfile(str(path), dtype=np.uint8)
    return cv2.imdecode(data, cv2.IMREAD_COLOR)


def write_image(path, img):
    ok, buf = cv2.imencode(".jpg", img, [cv2.IMWRITE_JPEG_QUALITY, 95])
    if not ok:
        raise RuntimeError(f"Не удалось сохранить {path}")
    buf.tofile(str(path))


def augment_one(img, rng):
    """Применяем 1-3 случайных эффекта. Возвращаем картинку и названия эффектов."""
    names = list(EFFECTS)
    count = int(rng.integers(1, 4))
    chosen = [names[i] for i in rng.choice(len(names), size=count, replace=False)]
    for name in chosen:
        img = EFFECTS[name](img, rng)
    return img, chosen


def make_preview(pairs, out_path):
    """Склеиваем картинки «до | после» в один файл для проверки глазами."""
    rows = []
    for before, after in pairs:
        rows.append(np.hstack([cv2.resize(before, (320, 240)), cv2.resize(after, (320, 240))]))
    if rows:
        write_image(out_path, np.vstack(rows))


def find_originals(images_dir):
    return sorted(p for p in images_dir.iterdir()
                  if p.suffix.lower() in IMAGE_EXTENSIONS and SUFFIX not in p.stem)


def clean(images_dir, labels_dir):
    removed = 0
    for folder in (images_dir, labels_dir):
        for p in folder.iterdir():
            if SUFFIX in p.stem:
                p.unlink()
                removed += 1
    return removed


def main():
    parser = argparse.ArgumentParser(description="Аугментация train-части датасета YOLO")
    parser.add_argument("--dataset", required=True, help="папка датасета (где train, valid, test)")
    parser.add_argument("--factor", type=int, default=1, help="сколько копий на каждую картинку")
    parser.add_argument("--seed", type=int, default=42, help="число для повторяемости результата")
    parser.add_argument("--preview", type=int, default=4, help="сколько пар до/после в превью")
    parser.add_argument("--clean", action="store_true", help="удалить ранее созданные копии и выйти")
    args = parser.parse_args()

    root = Path(args.dataset)
    images_dir = root / "train" / "images"
    labels_dir = root / "train" / "labels"
    if not images_dir.is_dir() or not labels_dir.is_dir():
        raise SystemExit(f"Не найдены {images_dir} и {labels_dir}. Проверьте путь --dataset.")

    if args.clean:
        print(f"Удалено файлов-копий: {clean(images_dir, labels_dir)}")
        return

    already = [p for p in images_dir.iterdir() if SUFFIX in p.stem]
    if already:
        raise SystemExit(f"Копии уже есть ({len(already)} шт.). Сначала запустите с --clean, "
                         "иначе картинки задвоятся.")

    originals = find_originals(images_dir)
    if not originals:
        raise SystemExit("В train/images нет картинок.")

    rng = np.random.default_rng(args.seed)
    used = Counter()
    created = 0
    skipped = 0
    preview_pairs = []

    for path in originals:
        img = read_image(path)
        if img is None:
            print(f"Пропускаю (не читается): {path.name}")
            skipped += 1
            continue
        label = labels_dir / f"{path.stem}.txt"
        if not label.exists():
            print(f"Пропускаю (нет разметки): {path.name}")
            skipped += 1
            continue

        for k in range(1, args.factor + 1):
            new_img, names = augment_one(img, rng)
            new_stem = f"{path.stem}{SUFFIX}{k}"
            write_image(images_dir / f"{new_stem}.jpg", new_img)
            shutil.copyfile(label, labels_dir / f"{new_stem}.txt")
            created += 1
            used.update(names)
            if len(preview_pairs) < args.preview:
                preview_pairs.append((img, new_img))

    make_preview(preview_pairs, root / "aug_preview.jpg")

    report = {
        "seed": args.seed,
        "factor": args.factor,
        "originals_in_train": len(originals) - skipped,
        "created_copies": created,
        "train_total_after": len(originals) - skipped + created,
        "skipped_unreadable": skipped,
        "effects_used": dict(used),
        "effect_ranges": {
            "darken": "яркость x0.35-0.7",
            "blur": "гауссово 3-9 или от движения 5-13",
            "noise": "гауссов шум, сигма 5-20",
            "low_contrast": "контраст x0.5-0.8",
            "haze": "примесь светло-серого 15-35%",
            "jpeg": "качество JPEG 15-45",
        },
        "note": "valid и test не изменялись",
    }
    with open(root / "augmentation_report.json", "w", encoding="utf-8") as f:
        json.dump(report, f, ensure_ascii=False, indent=2)

    print(f"Готово: создано копий {created}, всего в train теперь {report['train_total_after']}.")
    print(f"Превью: {root / 'aug_preview.jpg'}")
    print(f"Отчёт:  {root / 'augmentation_report.json'}")


if __name__ == "__main__":
    main()
