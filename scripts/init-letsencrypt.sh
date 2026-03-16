#!/usr/bin/env bash
set -euo pipefail

###############################################################################
# Initial SSL certificate setup via Let's Encrypt
#
# Run ONCE on the server after the first deploy:
#   cd /opt/reservation-service && bash scripts/init-letsencrypt.sh
#
# After this, certbot container auto-renews every 12h.
###############################################################################

DOMAIN="slotik.tech"
EMAIL="admin@slotik.tech"
STAGING=${STAGING:-0}  # Set STAGING=1 to test without rate limits

echo "==> Starting SSL initialization for ${DOMAIN}"

# 1. Prepare directories
mkdir -p certbot/conf certbot/www frontend-dist
touch frontend-dist/index.html

# 2. Stop everything
docker-compose down 2>/dev/null || true

# 3. Temporarily use HTTP-only nginx config
cp docker-compose.yml docker-compose.yml.bak
sed -i "s|./nginx/nginx.conf:/etc/nginx/conf.d/default.conf|./nginx/nginx-init.conf:/etc/nginx/conf.d/default.conf|" docker-compose.yml

# 4. Start nginx + backend (HTTP only)
docker-compose up -d nginx backend
echo "==> Waiting for nginx to start..."
sleep 5

# 5. Request certificate
echo "==> Requesting certificate from Let's Encrypt..."
STAGING_FLAG=""
if [ "$STAGING" -eq 1 ]; then
  STAGING_FLAG="--staging"
  echo "    (using staging server — cert will NOT be trusted)"
fi

restore_compose() {
  echo "==> Restoring original docker-compose.yml..."
  mv docker-compose.yml.bak docker-compose.yml
}
trap restore_compose EXIT

docker run --rm \
  -v "$(pwd)/certbot/conf:/etc/letsencrypt" \
  -v "$(pwd)/certbot/www:/var/www/certbot" \
  certbot/certbot certonly \
  --webroot \
  --webroot-path=/var/www/certbot \
  --email "$EMAIL" \
  --agree-tos \
  --no-eff-email \
  -d "$DOMAIN" \
  $STAGING_FLAG

# 6. Restore HTTPS config and restart (trap handles docker-compose.yml.bak)
echo "==> Switching to HTTPS nginx config..."
trap - EXIT
restore_compose
docker-compose down
docker-compose up -d

echo ""
echo "==> SSL initialized successfully!"
echo "==> https://${DOMAIN} is now live"
echo "==> Certificate auto-renewal is handled by certbot container"
