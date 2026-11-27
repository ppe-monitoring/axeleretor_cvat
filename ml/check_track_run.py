"""Проверка результата track_ppe.py: треки людей, события для бэкенда, сводки.

Не запускает нейросеть: читает три файла, которые создал track_ppe.py.

Запуск (из папки ml):
    python check_track_run.py --prefix outputs_tracking/light_close

prefix = папка вывода + имя видео без расширения. Скрипт сам добавит
_tracks.jsonl, _events.jsonl и _summaries.jsonl.
"""
import argparse
import json
from collections import Counter, defaultdict
from datetime import datetime
from pathlib import Path

ALLOWED_CODES = {"NO_HELMET", "NO_VEST", "NO_GLOVES"}
SHORT_TRACK_FRAMES = 15   # трек короче этого подозрителен (шум или «прыжок» номера)

errors, warnings = [], []


def read_jsonl(path):
    if not path.exists():
        errors.append(f"Нет файла {path.name}")
        return []
    rows = []
    with open(path, encoding="utf-8") as f:
        for number, line in enumerate(f, 1):
            line = line.strip()
            if not line:
                continue
            try:
                rows.append(json.loads(line))
            except json.JSONDecodeError as exc:
                errors.append(f"{path.name}, строка {number}: не JSON ({exc})")
    return rows


def is_number(x):
    return isinstance(x, (int, float)) and not isinstance(x, bool)


def check_tracks(rows):
    print("== ТРЕКИ ЛЮДЕЙ")
    if not rows:
        errors.append("В *_tracks.jsonl нет кадров")
        return {}
    tracks = defaultdict(lambda: {"frames": 0, "judged": 0, "first": None, "last": None,
                                  "status": Counter(), "codes": Counter()})
    max_persons = 0
    for row in rows:
        persons = row.get("persons", [])
        max_persons = max(max_persons, len(persons))
        for p in persons:
            t = tracks[p["track_id"]]
            t["frames"] += 1
            t["judged"] += bool(p.get("judged"))
            t["first"] = row["timestamp_s"] if t["first"] is None else t["first"]
            t["last"] = row["timestamp_s"]
            t["status"][p.get("status", "?")] += 1
            for v in p.get("violations", []):
                t["codes"][v["code"]] += 1

    print(f"Кадров в файле: {len(rows)}. Больше всего людей в одном кадре: {max_persons}. "
          f"Всего номеров (track_id): {len(tracks)}")
    if not tracks:
        warnings.append("Ни одного человека с номером не найдено")
        return {}
    print(f"{'ID':>4} {'кадров':>7} {'с-по (с)':>14} {'оценён':>7}  статусы / нарушения")
    for tid in sorted(tracks):
        t = tracks[tid]
        status = ", ".join(f"{k}:{v}" for k, v in sorted(t["status"].items()))
        codes = ", ".join(f"{k}:{v}" for k, v in sorted(t["codes"].items())) or "нет"
        print(f"{tid:>4} {t['frames']:>7} {t['first']:>6.1f}-{t['last']:<6.1f} {t['judged']:>7}  "
              f"{status} | {codes}")
    short = [tid for tid, t in tracks.items() if t["frames"] < SHORT_TRACK_FRAMES]
    if short:
        warnings.append(f"Короткие треки (меньше {SHORT_TRACK_FRAMES} кадров): {sorted(short)}. "
                        "Это шум или номер человека «перескочил».")
    if len(tracks) > max_persons + 1:
        warnings.append(f"Номеров {len(tracks)}, а одновременно в кадре не больше {max_persons}: "
                        "похоже, номера людей меняются. Проверьте видео и порог person_conf.")
    return tracks


def check_events(rows, camera_required=True):
    print("\n== СОБЫТИЯ ДЛЯ БЭКЕНДА (*_events.jsonl)")
    print(f"Событий: {len(rows)}")
    seen_ids = set()
    for i, e in enumerate(rows, 1):
        tag = f"событие {i}"
        for key in ("event_id", "track_id", "frame_number", "timestamp", "frame_width",
                    "frame_height", "model_version", "bbox", "violations"):
            if key not in e:
                errors.append(f"{tag}: нет поля {key}")
        if camera_required and e.get("camera_id") is None:
            warnings.append(f"{tag}: camera_id не задан (бэкенд требует его; "
                            "запускайте с --camera-id)")
        eid = e.get("event_id")
        if eid in seen_ids:
            errors.append(f"{tag}: повторяющийся event_id {eid}")
        seen_ids.add(eid)
        bbox = e.get("bbox")
        if not (isinstance(bbox, list) and len(bbox) == 4 and all(is_number(v) for v in bbox)
                and bbox[2] > bbox[0] and bbox[3] > bbox[1]):
            errors.append(f"{tag}: bbox должен быть [x1, y1, x2, y2], где x2 > x1 и y2 > y1")
        violations = e.get("violations")
        if not isinstance(violations, list) or not violations:
            errors.append(f"{tag}: violations пустой")
        else:
            for v in violations:
                if v.get("code") not in ALLOWED_CODES:
                    errors.append(f"{tag}: неизвестный код {v.get('code')}")
                conf = v.get("confidence")
                if not (is_number(conf) and 0.0 <= conf <= 1.0):
                    errors.append(f"{tag}: confidence должен быть числом от 0 до 1")
        try:
            datetime.fromisoformat(e.get("timestamp", ""))
        except (TypeError, ValueError):
            errors.append(f"{tag}: timestamp не ISO-время")
        w, h = e.get("frame_width"), e.get("frame_height")
        if isinstance(bbox, list) and len(bbox) == 4 and is_number(w) and is_number(h):
            if bbox[2] > w + 1 or bbox[3] > h + 1:
                warnings.append(f"{tag}: рамка выходит за кадр {w}x{h}")
    if not rows:
        warnings.append("Событий нет: нарушений не зафиксировано")
    else:
        codes = Counter(v["code"] for e in rows for v in e.get("violations", []) if "code" in v)
        print("Событий по кодам:", dict(codes))


def check_summaries(rows):
    print("\n== СВОДКИ (*_summaries.jsonl)")
    print(f"Сводок: {len(rows)}")
    for i, s in enumerate(rows, 1):
        tag = f"сводка {i}"
        for key in ("camera_id", "timestamp", "people_checked", "violators", "model_version"):
            if key not in s:
                errors.append(f"{tag}: нет поля {key}")
        if s.get("camera_id") is None:
            warnings.append(f"{tag}: camera_id не задан")
        pc, vi = s.get("people_checked"), s.get("violators")
        if is_number(pc) and is_number(vi) and vi > pc:
            errors.append(f"{tag}: violators ({vi}) больше people_checked ({pc})")
        try:
            datetime.fromisoformat(s.get("timestamp", ""))
        except (TypeError, ValueError):
            errors.append(f"{tag}: timestamp не ISO-время")
    if not rows:
        warnings.append("Сводок нет: бэкенд не сможет показать, что ML работает")
    else:
        print("people_checked / violators по сводкам:",
              [(s.get("people_checked"), s.get("violators")) for s in rows])


def main():
    parser = argparse.ArgumentParser(description="Проверка результата track_ppe.py")
    parser.add_argument("--prefix", required=True,
                        help="например outputs_tracking/light_close")
    args = parser.parse_args()
    base = Path(args.prefix)
    tracks_rows = read_jsonl(Path(f"{base}_tracks.jsonl"))
    events_rows = read_jsonl(Path(f"{base}_events.jsonl"))
    summaries_rows = read_jsonl(Path(f"{base}_summaries.jsonl"))

    tracks = check_tracks(tracks_rows)
    check_events(events_rows)
    check_summaries(summaries_rows)

    in_events = {e.get("track_id") for e in events_rows}
    in_tracks = {tid for tid, t in tracks.items() if t["codes"]}
    if in_events != in_tracks:
        warnings.append(f"Нарушители в треках {sorted(in_tracks)} не совпадают "
                        f"с нарушителями в событиях {sorted(in_events)}")

    print("\n== ИТОГ")
    for w in warnings:
        print("ВНИМАНИЕ:", w)
    for e in errors[:20]:
        print("ОШИБКА:", e)
    if len(errors) > 20:
        print(f"... и ещё {len(errors) - 20} ошибок")
    if errors:
        print(f"Найдено ошибок: {len(errors)}")
        raise SystemExit(1)
    print("Формат файлов в порядке." + (" Есть предупреждения, посмотрите выше." if warnings else ""))


if __name__ == "__main__":
    main()
