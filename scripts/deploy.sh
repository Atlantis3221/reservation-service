#!/usr/bin/env bash
set -euo pipefail

###############################################################################
# Full deploy: build frontend + sync everything + restart on server
#
# Usage:
#   DEPLOY_HOST=185.255.132.151 DEPLOY_USER=root bash scripts/deploy.sh
#
# Or via npm:
#   DEPLOY_HOST=185.255.132.151 DEPLOY_USER=root npm run deploy
###############################################################################

HOST="${DEPLOY_HOST:?Set DEPLOY_HOST}"
USER="${DEPLOY_USER:-root}"
REMOTE_PATH="${DEPLOY_PATH:-/opt/reservation-service}"

echo "==> Deploying to ${USER}@${HOST}:${REMOTE_PATH}"

# 1. Build frontend + admin
echo "==> Building frontend..."
cd frontend
npm run build
cd ..

echo "==> Building admin panel..."
cd admin
npm run build
cd ..

# 2. Sync project files to server
echo "==> Syncing files to server..."
rsync -avz --delete \
  --exclude='node_modules' \
  --exclude='.env' \
  --exclude='data/' \
  --exclude='certbot/' \
  --exclude='frontend-dist/' \
  --exclude='.git' \
  --exclude='backend/data/' \
  --exclude='admin-dist/' \
  ./ \
  "${USER}@${HOST}:${REMOTE_PATH}/"

# 3. Sync built frontend to frontend-dist on server
echo "==> Syncing frontend build..."
rsync -avz --delete \
  frontend/dist/ \
  "${USER}@${HOST}:${REMOTE_PATH}/frontend-dist/"

# 4. Sync built admin to admin-dist on server
echo "==> Syncing admin build..."
rsync -avz --delete \
  admin/dist/ \
  "${USER}@${HOST}:${REMOTE_PATH}/admin-dist/"

# 5. Rebuild and restart containers
echo "==> Restarting containers..."
ssh "${USER}@${HOST}" "cd ${REMOTE_PATH} && docker-compose up -d --build"

echo ""
echo "==> Deploy complete!"
echo "==> https://slotik.tech"
echo "==> Health: https://slotik.tech/health"
