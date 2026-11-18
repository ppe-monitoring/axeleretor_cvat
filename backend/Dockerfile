# Образ backend (Django). Собирается командой `docker compose build backend`.
FROM python:3.13-slim AS base

# Не создавать .pyc и сразу выводить логи (без буферизации)
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

WORKDIR /app

# Сначала только зависимости, чтобы Docker кэшировал этот слой
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Затем сам код
COPY . .

EXPOSE 8000

FROM base AS staging

RUN pip install --no-cache-dir gunicorn==27.0.1

CMD ["sh", "-c", "python manage.py migrate --noinput && python manage.py collectstatic --noinput && exec gunicorn --bind 0.0.0.0:8000 --workers 2 --timeout 120 config.wsgi:application"]

FROM base AS development

CMD ["sh", "-c", "python manage.py migrate --noinput && python manage.py runserver 0.0.0.0:8000"]
