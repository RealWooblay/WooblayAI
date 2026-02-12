# ─────────────────────────────────────────────────────────────────────────────
# Tenant Outputs
# ─────────────────────────────────────────────────────────────────────────────

output "tenant_url" {
  description = "Public URL for this tenant"
  value       = "https://${var.tenant_name}.${var.domain_name}"
}

output "health_url" {
  description = "Health check URL for this tenant"
  value       = "https://${var.tenant_name}.${var.domain_name}/health"
}

output "ecs_service_name" {
  description = "ECS service name"
  value       = aws_ecs_service.tenant.name
}

output "target_group_arn" {
  description = "ALB target group ARN"
  value       = aws_lb_target_group.tenant.arn
}

output "secret_arn" {
  description = "Secrets Manager secret ARN"
  value       = aws_secretsmanager_secret.tenant.arn
}
