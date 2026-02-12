#!/bin/bash
set -euo pipefail

echo "=== Wooblay Platform API Bootstrap ==="

# ── Install Docker ─────────────────────────────────────────────────────────
dnf install -y docker jq
systemctl enable docker
systemctl start docker

# ── ECR Login ──────────────────────────────────────────────────────────────
ACCOUNT=$(aws sts get-caller-identity --query Account --output text)
aws ecr get-login-password --region ${aws_region} | docker login --username AWS --password-stdin "$ACCOUNT.dkr.ecr.${aws_region}.amazonaws.com"

# ── Fetch secrets ──────────────────────────────────────────────────────────
CONFIG=$(aws secretsmanager get-secret-value --secret-id "${config_secret}" --region ${aws_region} --query SecretString --output text)
DB_CONFIG=$(aws secretsmanager get-secret-value --secret-id "${db_secret}" --region ${aws_region} --query SecretString --output text)

DATABASE_URL=$(echo "$DB_CONFIG" | jq -r '.DATABASE_URL')

# ── Write .env ─────────────────────────────────────────────────────────────
mkdir -p /opt/wooblay
cat > /opt/wooblay/.env << EOF
DATABASE_URL=$DATABASE_URL
PORT=4800
PLATFORM_MODE=true
NODE_ENV=production
CLERK_PUBLISHABLE_KEY=$(echo "$CONFIG" | jq -r '.CLERK_PUBLISHABLE_KEY')
CLERK_SECRET_KEY=$(echo "$CONFIG" | jq -r '.CLERK_SECRET_KEY')
WOOBLAY_SERVER_PRIVATE_KEY=$(echo "$CONFIG" | jq -r '.WOOBLAY_SERVER_PRIVATE_KEY')
WOOBLAY_SERVER_PUBLIC_KEY=$(echo "$CONFIG" | jq -r '.WOOBLAY_SERVER_PUBLIC_KEY')
EOF

# ── Run Prisma migrate then start ──────────────────────────────────────────
docker pull ${gate_image}

# Run migrations
docker run --rm --env-file /opt/wooblay/.env ${gate_image} npx prisma migrate deploy || echo "WARN: migrate failed, may need manual intervention"

# Start the Gate in platform mode
docker run -d \
  --name wooblay-platform \
  --restart unless-stopped \
  --env-file /opt/wooblay/.env \
  -p 4800:4800 \
  -v /var/run/docker.sock:/var/run/docker.sock \
  ${gate_image}

echo "=== Wooblay Platform API started on port 4800 ==="
