# CI/CD для PPE Monitor

**CI** проверяет код после пуша в ветку и в pull request в `main`. GitHub Actions собирает Docker-образы Django и React, запускает их с чистой PostgreSQL, применяет миграции, выполняет тесты Django и проверяет HTTP-ответы фронтенда, API и админки.

**CD** обновляет тестовый сервер после успешного CI для пуша в `main`. GitHub Actions передаёт по SSH те же Docker-образы, которые прошли проверку. Docker Compose дожидается готовности сервисов. PostgreSQL и загруженные видео хранятся в отдельных томах, которые сохраняются между деплоями.

Без тестового сервера можно проверить весь CI. Задача `Deploy to staging` будет пропущена, пока переменная `STAGING_ENABLED` отсутствует или отличается от `true`. ML-скрипты из `ml/` запускаются отдельно. Стенд содержит интерфейс, API и базу.

## 1. Подготовить сервер

Подойдёт отдельная Linux-машина `x86_64` с SSH, доступным с GitHub-hosted runner, и исходящим доступом к Docker Hub для загрузки PostgreSQL. Для Ubuntu установи Docker Engine и плагин Docker Compose согласно [официальной инструкции](https://docs.docker.com/engine/install/ubuntu/).

Попроси администратора создать отдельного пользователя, например `deploy`, с доступом к Docker без `sudo`. Доступ к Docker даёт права уровня администратора сервера, поэтому используй отдельный тестовый хост и тестовые данные. Под пользователем `deploy` проверь команды:

```bash
docker info
docker compose version
```

Под тем же пользователем один раз создай каталог и файл с секретами. Команды выполняются на Linux-сервере. Если `.env` уже существует, перенаправление завершится ошибкой и сохранит текущий файл.

```bash
mkdir -p "$HOME/ppe-staging"
cd "$HOME/ppe-staging"
(
  set -o noclobber
  umask 077
  printf 'DB_PASSWORD=%s\nSECRET_KEY=%s\nML_API_KEY=%s\nSTAGING_HTTP_PORT=8080\n' \
    "$(openssl rand -hex 32)" "$(openssl rand -hex 48)" "$(openssl rand -hex 32)" > .env
)
```

Приложение будет слушать только `127.0.0.1:8080` на сервере. PostgreSQL и Django доступны по сети Docker. Для просмотра приложения используй SSH-туннель из шага 4.

## 2. Подготовить SSH для GitHub Actions

1. На своём компьютере в PowerShell создай отдельный ключ. На оба запроса пароля ключа нажми Enter, чтобы GitHub Actions мог подключаться без ручного ввода.

   ```powershell
   New-Item -ItemType Directory -Force "$env:USERPROFILE\.ssh" | Out-Null
   ssh-keygen -t ed25519 -C "ppe-staging-actions" -f "$env:USERPROFILE\.ssh\ppe_staging_actions"
   Get-Content "$env:USERPROFILE\.ssh\ppe_staging_actions.pub"
   ```

2. Добавь строку из файла `.pub` в `~deploy/.ssh/authorized_keys` на сервере. При первом создании этого каталога установи права `700` на `.ssh` и `600` на `authorized_keys`. Приватный файл `ppe_staging_actions` понадобится для секрета GitHub.
3. Получи публичный ключ **самого сервера** для проверки его личности. В PowerShell замени адрес и порт на свои.

   ```powershell
   $serverIp = "203.0.113.10"
   $sshPort = 22
   ssh-keyscan -t ed25519 -p $sshPort $serverIp |
     Set-Content -Encoding ascii "$env:USERPROFILE\.ssh\ppe_staging_known_hosts"
   ssh-keygen -lf "$env:USERPROFILE\.ssh\ppe_staging_known_hosts"
   ```

   Сверь отпечаток с выводом `ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub` в консоли хостинга или с отпечатком, который передал администратор. Используй в GitHub тот же адрес и порт, что в `ssh-keyscan`.

## 3. Включить автодеплой в GitHub

Эти настройки делает администратор репозитория. Открой **Settings → Environments**, создай окружение `staging` и в **Deployment branches and tags** разреши ветку `main`. [Документация GitHub по окружениям](https://docs.github.com/en/actions/how-tos/deploy/configure-and-manage-deployments/manage-environments).

| Где добавить | Имя | Значение |
| --- | --- | --- |
| `staging` → Environment variables | `STAGING_SSH_HOST` | Домен или IPv4 сервера |
| `staging` → Environment variables | `STAGING_SSH_USER` | Пользователь, например `deploy` |
| `staging` → Environment variables | `STAGING_SSH_PORT` | Порт SSH, по умолчанию `22` |
| `staging` → Environment secrets | `STAGING_SSH_PRIVATE_KEY` | Всё содержимое файла `ppe_staging_actions`, включая первую и последнюю строку ключа |
| `staging` → Environment secrets | `STAGING_SSH_KNOWN_HOSTS` | Строка из проверенного файла `ppe_staging_known_hosts` |

Последним шагом открой **Settings → Secrets and variables → Actions → Variables** и добавь **переменную репозитория** `STAGING_ENABLED` со значением `true`. Ключи храни в Secrets, параметры подключения — в Variables, пароль базы и секреты Django и ML — в серверном `.env`. [Документация GitHub по переменным](https://docs.github.com/en/actions/how-tos/write-workflows/choose-what-workflows-do/use-variables).

## 4. Проверить тестовым пушем

1. Пуш в рабочую ветку запускает `Build and test`. На вкладке **Actions → CI/CD** открой запуск по своему коммиту. Зелёный статус означает, что образы собраны и временный стенд прошёл проверки.
2. После настройки сервера и GitHub смержи pull request с пайплайном в `main`. Это создаст пуш в `main` и запустит первую выкладку. Если пайплайн уже в `main`, дождись следующего merge или сделай пустой коммит, если правила репозитория разрешают прямой пуш.

   ```powershell
   git switch main
   git pull --ff-only origin main
   git commit --allow-empty -m "Verify staging deployment"
   git push origin main
   ```

3. В запуске GitHub Actions открой `Deploy to staging`. Зелёный статус и сообщение `Staging is healthy for commit` с SHA означают, что сервер принял образы, запустил сервисы и ответил на запросы приложения.
4. Открой туннель из PowerShell, используя свой обычный SSH-доступ к серверу. Оставь окно открытым. Если на сервере задан другой `STAGING_HTTP_PORT`, укажи его вместо последнего `8080`.

   ```powershell
   ssh -N -L 18080:127.0.0.1:8080 -p 22 deploy@203.0.113.10
   ```

   В браузере открой `http://127.0.0.1:18080/` для интерфейса или `http://127.0.0.1:18080/api/docs/` для Swagger. Данные появятся после заполнения базы или отправки событий.

## Если деплой остановился

| Сообщение | Что проверить |
| --- | --- |
| `Deploy to staging` пропущен | Пуш должен попасть в `main`, CI должен пройти, а переменная репозитория `STAGING_ENABLED` должна быть равна `true`. |
| `Permission denied (publickey)` | Пользователя, публичный ключ в его `authorized_keys` и соответствующий приватный ключ в GitHub Secrets. |
| `Host key verification failed` | Совпадение адреса и порта с `known_hosts`. При смене ключа сервера сначала сверь новый отпечаток. |
| SSH не подключается | Доступность адреса и SSH-порта с GitHub-hosted runner. |
| Docker Compose сообщает о нездоровом сервисе | В конце шага деплоя будут статусы контейнеров и последние строки их логов. При сбое после миграции часть изменений могла уже примениться. |

После первого успешного деплоя посмотреть состояние сервисов на сервере можно так:

```bash
cd "$HOME/ppe-staging"
docker compose -p ppe-staging --env-file .env --env-file current/images.env -f current/compose.staging.yml ps
docker compose -p ppe-staging --env-file .env --env-file current/images.env -f current/compose.staging.yml logs --tail=100
```

`current` указывает на последний релиз, который прошёл проверку готовности. Чтобы приостановить будущие выкладки, установи переменную `STAGING_ENABLED` в `false`.
