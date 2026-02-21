# ─────────────────────────────────────────────────────────────────────────────
# Outputs – Resource ARNs/IDs needed by the runtime module
# ─────────────────────────────────────────────────────────────────────────────

# ── VPC ──────────────────────────────────────────────────────────────────
output "vpc_id" {
  description = "VPC ID"
  value       = aws_vpc.main.id
}

output "vpc_cidr" {
  description = "VPC CIDR block"
  value       = aws_vpc.main.cidr_block
}

output "public_subnet_ids" {
  description = "Public subnet IDs"
  value       = aws_subnet.public[*].id
}

output "private_subnet_ids" {
  description = "Private subnet IDs"
  value       = aws_subnet.private[*].id
}

# ── Security Groups ─────────────────────────────────────────────────────
output "runtime_security_group_id" {
  description = "Security group ID for runtime EC2 instances"
  value       = aws_security_group.runtime.id
}

output "alb_security_group_id" {
  description = "ALB security group ID"
  value       = aws_security_group.alb.id
}

# ── ALB ──────────────────────────────────────────────────────────────────
output "alb_arn" {
  description = "ALB ARN"
  value       = aws_lb.main.arn
}

output "alb_dns_name" {
  description = "ALB DNS name (use this to access tenants)"
  value       = aws_lb.main.dns_name
}

output "alb_http_listener_arn" {
  description = "HTTP listener ARN for tenant routing rules"
  value       = aws_lb_listener.http.arn
}

# ── ECR ──────────────────────────────────────────────────────────────────
output "ecr_gate_repository_url" {
  description = "ECR repository URL for Gate image"
  value       = aws_ecr_repository.gate.repository_url
}

output "ecr_openclaw_repository_url" {
  description = "ECR repository URL for OpenClaw runtime image"
  value       = aws_ecr_repository.openclaw.repository_url
}

# ── KMS ──────────────────────────────────────────────────────────────────
output "kms_key_arn" {
  description = "KMS key ARN for Secrets Manager encryption"
  value       = aws_kms_key.secrets.arn
}

output "kms_key_id" {
  description = "KMS key ID"
  value       = aws_kms_key.secrets.key_id
}

# ── CloudWatch ───────────────────────────────────────────────────────────
output "log_group_name" {
  description = "CloudWatch log group name"
  value       = aws_cloudwatch_log_group.runtime.name
}

# ── Platform Database ────────────────────────────────────────────────────
output "platform_db_endpoint" {
  description = "RDS endpoint for the central platform database"
  value       = aws_db_instance.platform.endpoint
}

output "platform_db_secret_arn" {
  description = "Secrets Manager ARN with platform DB credentials"
  value       = aws_secretsmanager_secret.platform_db_url.arn
}
