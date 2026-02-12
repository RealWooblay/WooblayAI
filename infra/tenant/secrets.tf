# ─────────────────────────────────────────────────────────────────────────────
# Tenant Secrets – Stored in AWS Secrets Manager
# Contains DATABASE_URL and signing keys for this tenant
# ─────────────────────────────────────────────────────────────────────────────

resource "aws_secretsmanager_secret" "tenant" {
  name        = "wooblay/${var.tenant_name}/config"
  description = "Secrets for Wooblay tenant: ${var.tenant_name}"
  kms_key_id  = var.kms_key_arn

  tags = {
    Name   = "wooblay-${var.tenant_name}-secrets"
    Tenant = var.tenant_name
  }
}

resource "aws_secretsmanager_secret_version" "tenant" {
  secret_id = aws_secretsmanager_secret.tenant.id

  secret_string = jsonencode({
    database_url        = "postgresql://wooblay_${var.tenant_name}:${random_password.db.result}@${var.rds_address}:${var.rds_port}/wooblay_${var.tenant_name}"
    server_public_key   = var.server_signing_public_key
    server_private_key  = var.server_signing_private_key
    toolhost_public_key = var.toolhost_signing_public_key
    toolhost_private_key = var.toolhost_signing_private_key
  })
}

# ── Random password for tenant database role ────────────────────────────
resource "random_password" "db" {
  length  = 32
  special = false
}
