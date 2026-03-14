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

COMPOSE="docker-compose"

echo "==> Starting SSL initialization for ${DOMAIN}"

# 1. Switch to HTTP-only nginx config for initial cert request
echo "==> Using HTTP-only nginx config..."
cp nginx/nginx-init.conf nginx/nginx-active.conf
$COMPOSE run --rm --entrypoint "" nginx sh -c "cp /dev/null /etc/nginx/conf.d/default.conf" 2>/dev/null || true

# Ensure certbot directories exist
mkdir -p certbot/conf certbot/www

# 2. Start nginx with init config (HTTP only)
$COMPOSE down 2>/dev/null || true

# Temporarily point nginx to init config
NGINX_CONF="nginx/nginx-init.conf"
sed -i.bak "s|./nginx/nginx.conf:/etc/nginx/conf.d/default.conf|./${NGINX_CONF}:/etc/nginx/conf.d/default.conf|" docker-compose.yml

$COMPOSE up -d nginx backend
echo "==> Waiting for nginx to start..."
sleep 5

# 3. Request certificate
echo "==> Requesting certificate from Let's Encrypt..."
STAGING_FLAG=""
if [ "$STAGING" -eq 1 ]; then
  STAGING_FLAG="--staging"
  echo "    (using staging server — cert will NOT be trusted)"
fi

$COMPOSE run --rm certbot certonly \
  --webroot \
  --webroot-path=/var/www/certbot \
  --email "$EMAIL" \
  --agree-tos \
  --no-eff-email \
  -d "$DOMAIN" \
  -d "www.${DOMAIN}" \
  $STAGING_FLAG

# 4. Switch to full HTTPS config
echo "==> Switching to HTTPS nginx config..."
sed -i.bak "s|./${NGINX_CONF}:/etc/nginx/conf.d/default.conf|./nginx/nginx.conf:/etc/nginx/conf.d/default.conf|" docker-compose.yml
rm -f docker-compose.yml.bak

# 5. Restart everything with SSL
$COMPOSE down
$COMPOSE up -d

echo ""
echo "==> SSL initialized successfully!"
echo "==> https://${DOMAIN} is now live"
echo "==> Certificate auto-renewal is handled by certbot container"
