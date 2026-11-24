# PPE Monitor

Система распознавания СИЗ по видеопотоку.

## CI/CD и тестовый сервер

GitHub Actions собирает Django и React и проверяет их на временном стенде с PostgreSQL.
После подключения сервера успешный пуш в `main` автоматически обновляет тестовый стенд.
[Пошаговая настройка и проверка CI/CD](docs/ci-cd.md).

## Запуск backend + PostgreSQL в Docker (рекомендуется)
```bash

cp .env.example .env
docker compose up -d --build
docker compose exec backend python manage.py check_db      # проверка подключения к БД
docker compose exec backend python manage.py createsuperuser
```

| | Хост | Порт | БД / логин / пароль |
|---|---|---|---|
| PostgreSQL из контейнеров | `db` | `5432` | `ppe` / `ppe` / `ppe` |
| PostgreSQL с компьютера | `localhost` | `5433` | `ppe` / `ppe` / `ppe` |
| Backend | `localhost` | `8000` | — |

## Запуск backend локально (база в Docker)
```bash
docker compose up -d db
python -m venv .venv && source .venv/Scripts/activate
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

## Формат от ML (POST /api/violations/, заголовок X-API-Key)
Одно событие = один человек на кадре. Можно прислать список событий. `bbox` это рамка человека.
```json
{
  "event_id": "run42-t7-f120",
  "camera_id": 1, "zone_id": 1, "video_id": 5,
  "track_id": 7, "frame_number": 120,
  "timestamp": "2026-11-20T12:00:03+03:00",
  "frame_width": 1280, "frame_height": 720,
  "model_version": "yolov8n-ppe-0.3",
  "bbox": [185.2, 40.1, 410.7, 520.3],
  "violations": [
    {"code": "NO_HELMET", "confidence": 0.91},
    {"code": "NO_VEST", "confidence": 0.84}
  ]
}
```
- Обязательны `camera_id`, `bbox`, `violations`. Коды: NO_HELMET, NO_VEST, NO_GLOVES (должны быть в правилах зоны).
- Инцидент = камера + зона + track_id + код. Пауза больше 5 секунд начинает новый. Уверенность хранится максимальная.
- Повтор с тем же `event_id` не создаёт дублей. События пачки сортируются по `timestamp`.
- `timestamp` для видеофайлов: время начала + кадр / FPS (в видео, а не время обработки).

## Сводка от ML (POST /api/summaries/, раз в минуту на камеру)
```json
{"camera": 1, "timestamp": "2026-11-20T12:01:00+03:00", "people_checked": 12, "violators": 2}
```
Если сводок нет 3 минуты, `GET /api/cameras/` покажет `ml_online: false` (на фронте «нет данных»).

Статус записи: `PATCH /api/violations/{id}/` с `{"status": "confirmed"}` (new / confirmed / false_positive).

## Загрузка видео из консоли
```bash
python manage.py load_video path/to/video.mp4 --camera 1
```

ER-диаграмма: `docs/er-diagram.md`



## ML: обработка видео и оптимизация PPE-модели

В модуле `ml` выполняется обнаружение средств индивидуальной защиты (СИЗ) на видеозаписях.

### Основные файлы

- `ml/detect.py` — основной скрипт обработки видео: запуск модели, обработка кадров, сохранение видео с аннотациями и журнала обнаружений.
- `ml/config.yaml` — настройки модели, пороги обнаружения, отображаемые классы, режим обработки и пути к результатам.
- `ml/fast_detect.py` — экспериментальный скрипт для проверки производительности и сравнения настроек, включая варианты пакетной обработки (batch processing).

### Frame skipping (пропуск кадров)

В `detect.py` реализован пропуск кадров с помощью параметра `stride`, задаваемого в `config.yaml`:

- `stride: 1` — обработка каждого кадра;
- `stride: 2` — обработка каждого второго кадра;
- при пропущенных кадрах используются последние полученные обнаружения.

Использование `stride: 2` сокращает число вызовов модели. Повторное использование предыдущих обнаружений на пропущенных кадрах не является полноценным трекингом: при движении объектов рамки могут временно не совпадать с их текущим положением.

### Экспериментальная проверка batch processing

В `fast_detect.py` отдельно проверялись варианты пакетной обработки и настройки производительности. Эти эксперименты использовались для сравнения режимов. Итоговое сравнение `stride: 1` и `stride: 2` проводилось в основном скрипте `detect.py`.

### Результаты сравнения FPS

Для сравнения использовалось одно видео `test_data/video_4.mp4` (712 кадров).

| Показатель | `stride: 1` | `stride: 2` |
|---|---:|---:|
| Количество кадров | 712 | 712 |
| Вызовы модели | 712 | 356 |
| FPS | 17,0 | 24,5 |

При `stride: 2` измеренный FPS вырос с 17,0 до 24,5 — приблизительно на 44,1% (в 1,44 раза).

### Настройки

Основные параметры текущего тестового режима:

- модель: `ppe_v2.pt`;
- `conf: 0.25`;
- `iou: 0.5`;
- `imgsz: 640`;
- `stride: 2`.

Остальные настройки (список классов, индивидуальные пороги классов нарушений, коды нарушений и пути вывода) задаются в `config.yaml`.

### Выходные файлы

Основной скрипт сохраняет обработанное видео и журнал обнаружений в директории, указанной в `config.yaml` (в текущем режиме — `outputs` и `logs/run.log` соответственно). Экспериментальные запуски Ultralytics могут сохранять свои результаты отдельно, например, в `runs/detect/predict`.

### Ограничения и дальнейшая работа

Во время тестирования модель не всегда обнаруживала все видимые объекты СИЗ. Дополнительный прямой запуск модели с более низким порогом confidence улучшил количество визуально замеченных обнаружений, но не устранил все пропуски. Эта проблема относится к качеству модели, а не непосредственно к оптимизации FPS; дальнейшее улучшение и дообучение модели рассматриваются отдельно.
