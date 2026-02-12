# ─────────────────────────────────────────────────────────────────────────────
# KMS – Encryption Key for Secrets Manager
# ─────────────────────────────────────────────────────────────────────────────

resource "aws_kms_key" "secrets" {
  description             = "KMS key for Wooblay Secrets Manager encryption"
  deletion_window_in_days = 7
  enable_key_rotation     = true

  tags = {
    Name = "${var.project_name}-secrets-kms"
  }
}

resource "aws_kms_alias" "secrets" {
  name          = "alias/${var.project_name}-secrets"
  target_key_id = aws_kms_key.secrets.key_id
}
