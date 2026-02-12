#!/usr/bin/env bash
set -euo pipefail

###############################################################################
# Deploy backend to Finnish server via SSH + Docker
#
# Требования:
#   - SSH-доступ к серверу (ключ или пароль)
#   - Docker + docker-compose на сервере
#
# Использование:
#   DEPLOY_HOST=1.2.3.4 DEPLOY_USER=deploy DEPLOY_PATH=/opt/reservation-service bash scripts/deploy-backend.sh
###############################################################################

HOST="${DEPLOY_HOST:?Set DEPLOY_HOST}"
USER="${DEPLOY_USER:-deploy}"
REMOTE_PATH="${DEPLOY_PATH:-/opt/reservation-service}"

echo "==> Deploying backend to ${USER}@${HOST}:${REMOTE_PATH}"

# 1. Синхронизируем файлы
rsync -avz --delete \
  --exclude='node_modules' \
  --exclude='.env' \
  ./backend/ \
  ./docker-compose.yml \
  "${USER}@${HOST}:${REMOTE_PATH}/"

# 2. Копируем docker-compose в корень проекта на сервере
scp docker-compose.yml "${USER}@${HOST}:${REMOTE_PATH}/docker-compose.yml"

# 3. Пересобираем и перезапускаем контейнер
ssh "${USER}@${HOST}" "cd ${REMOTE_PATH} && docker-compose up -d --build"

echo "==> Backend deployed successfully!"
echo "==> Health check: http://${HOST}:3000/health"
