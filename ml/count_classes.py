"""Считает картинки и объекты по классам в каждой части датасета YOLO (train, valid, test).

Запуск (из папки ml):
    python count_classes.py --dataset data/ppe_dataset
"""
import argparse
from collections import Counter
from pathlib import Path

import yaml

IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png", ".bmp"}


def main():
    parser = argparse.ArgumentParser(description="Статистика датасета YOLO")
    parser.add_argument("--dataset", required=True, help="папка датасета (где data.yaml)")
    args = parser.parse_args()

    root = Path(args.dataset)
    with open(root / "data.yaml", encoding="utf-8") as f:
        names = yaml.safe_load(f)["names"]

    for split in ["train", "valid", "test"]:
        images_dir = root / split / "images"
        labels_dir = root / split / "labels"
        if not images_dir.is_dir():
            print(f"{split}: папки нет")
            continue
        images = [p for p in images_dir.iterdir() if p.suffix.lower() in IMAGE_EXTENSIONS]
        count = Counter()
        for label_file in labels_dir.glob("*.txt"):
            for line in label_file.read_text(encoding="utf-8").splitlines():
                if line.strip():
                    count[int(line.split()[0])] += 1
        total = sum(count.values())
        print(f"\n{split}: картинок {len(images)}, объектов {total}")
        for class_id in range(len(names)):
            print(f"   {names[class_id]:<16} {count.get(class_id, 0)}")


if __name__ == "__main__":
    main()
