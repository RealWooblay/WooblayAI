# ─────────────────────────────────────────────────────────────────────────────
# Runtime Module – Outputs
# ─────────────────────────────────────────────────────────────────────────────

output "instance_id" {
  description = "EC2 instance ID"
  value       = aws_instance.runtime.id
}

output "private_ip" {
  description = "EC2 private IP address"
  value       = aws_instance.runtime.private_ip
}

output "tenant_url" {
  description = "URL to access the Wooblay UI for this tenant (via ALB)"
  value       = "http://${data.aws_lb.main.dns_name}"
}

output "health_url" {
  description = "Health check URL"
  value       = "http://${data.aws_lb.main.dns_name}/health"
}

output "ssm_command" {
  description = "Command to connect via SSM Session Manager (emergency access)"
  value       = "aws ssm start-session --target ${aws_instance.runtime.id} --region ${var.aws_region}"
}

output "secret_arn" {
  description = "Secrets Manager secret ARN"
  value       = aws_secretsmanager_secret.tenant.arn
}

output "target_group_arn" {
  description = "ALB target group ARN"
  value       = aws_lb_target_group.runtime.arn
}

# Data source to get ALB DNS name
data "aws_lb" "main" {
  arn = var.alb_arn
}
