#!/usr/bin/env bash
set -euo pipefail

###############################################################################
# Deploy frontend to GitHub Pages
#
# Требования:
#   - gh-pages установлен (devDependency во frontend)
#   - git remote настроен
#
# Использование:
#   bash scripts/deploy-frontend.sh
###############################################################################

echo "==> Building frontend..."
cd frontend
npm run build

echo "==> Deploying to GitHub Pages..."
npx gh-pages -d dist

echo "==> Frontend deployed to GitHub Pages!"
echo "==> URL: https://<username>.github.io/reservation-service/"
