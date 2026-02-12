# ─────────────────────────────────────────────────────────────────────────────
# Secrets Manager – Tenant Configuration
#
# Stores all sensitive config for this tenant's runtime:
#   - Database password (random, never exposed)
#   - Wooblay server signing keys
#   - Container image URIs
# ─────────────────────────────────────────────────────────────────────────────

resource "random_password" "db" {
  length  = 32
  special = false
}

resource "aws_secretsmanager_secret" "tenant" {
  name       = "wooblay/${var.tenant_name}/config"
  kms_key_id = var.kms_key_arn

  tags = {
    Name   = "wooblay-${var.tenant_name}-config"
    Tenant = var.tenant_name
  }
}

resource "aws_secretsmanager_secret_version" "tenant" {
  secret_id = aws_secretsmanager_secret.tenant.id

  secret_string = jsonencode({
    tenant_name                = var.tenant_name
    db_user                    = "wooblay"
    db_password                = random_password.db.result
    db_name                    = "wooblay_${replace(var.tenant_name, "-", "_")}"
    wooblay_server_private_key = var.server_private_key
    wooblay_server_public_key  = var.server_public_key
    gate_image                 = var.gate_image
    agent_image                = var.agent_image
    tool_filter                = var.tool_filter
  })
}
