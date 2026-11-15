# PPE Monitor

Система распознавания СИЗ по видеопотоку.

## Запуск backend
```bash
docker compose up -d
python -m venv .venv && source .venv/Scripts/activate   # Mac/Linux: .venv/bin/activate
pip install -r backend/requirements.txt
cp .env.example .env
cd backend
python manage.py migrate
python manage.py createsuperuser
python manage.py runserver
```
Порт БД: 5433 (`DB_PORT` в `.env`).
Swagger: http://127.0.0.1:8000/api/docs/  Админка: http://127.0.0.1:8000/admin/
Тесты: `python manage.py test monitoring`

## API (префикс /api/)
| Метод | URL | Описание |
|---|---|---|
| GET/POST | /cameras/ | камеры |
| GET/POST | /zones/?camera=ID | зоны с правилами СИЗ |
| GET/POST | /ppe-rules/ | правила: какие СИЗ обязательны в зоне |
| GET/POST | /videos/ | загрузка видео (multipart: file, camera) |
| GET | /violations/ | лента; фильтры: camera, zone, video, code, date_from, date_to |
| POST | /violations/ | приём нарушения от ML (одно событие или список) |

## Формат от ML (POST /api/violations/)
```json
{
  "camera_id": 1,
  "zone_id": 1,
  "video_id": 5,
  "frame_number": 120,
  "timestamp": "2026-11-18T12:00:03+03:00",
  "bbox": [100, 80, 320, 540],
  "confidence": 0.91,
  "violations": ["NO_HELMET"]
}
```
- `bbox`: рамка человека `[x1, y1, x2, y2]`. `zone_id`, `video_id` необязательны.
- Коды: NO_HELMET, NO_VEST, NO_GLOVES. Код должен быть включён в правила зоны.
- Если нарушение продолжается (та же камера, зона и коды, пауза меньше 5 секунд), запись продлевается: ответ 200. Иначе создаётся новая: 201.
- Можно отправить список событий. Ответ 201 (всё принято), 207 (часть отклонена), 400 (всё отклонено). Ошибки приходят с номером события.

## Загрузка видео из консоли
```bash
python manage.py load_video path/to/video.mp4 --camera 1
```

ER-диаграмма: `docs/er-diagram.md`