# ─────────────────────────────────────────────────────────────────────────────
# Wooblay Tenant – Input Variables
# ─────────────────────────────────────────────────────────────────────────────

variable "tenant_name" {
  description = "Unique tenant identifier (used in URLs, DB names, etc.)"
  type        = string
}

variable "aws_region" {
  description = "AWS region"
  type        = string
  default     = "us-east-1"
}

variable "domain_name" {
  description = "Root domain for tenant URLs"
  type        = string
  default     = "wooblay.run"
}

# ── Container Images ────────────────────────────────────────────────────
variable "agent_runtime_image" {
  description = "Docker image for the agent runtime container"
  type        = string
}

variable "gate_image" {
  description = "Docker image for the Wooblay Gate container"
  type        = string
}

# ── Base Infrastructure Outputs ─────────────────────────────────────────
variable "vpc_id" {
  description = "VPC ID from base module"
  type        = string
}

variable "private_subnet_ids" {
  description = "Private subnet IDs from base module"
  type        = list(string)
}

variable "public_subnet_ids" {
  description = "Public subnet IDs from base module"
  type        = list(string)
}

variable "ecs_cluster_arn" {
  description = "ECS cluster ARN from base module"
  type        = string
}

variable "ecs_cluster_name" {
  description = "ECS cluster name from base module"
  type        = string
}

variable "ecs_execution_role_arn" {
  description = "ECS task execution role ARN from base module"
  type        = string
}

variable "ecs_task_role_arn" {
  description = "ECS task role ARN from base module"
  type        = string
}

variable "ecs_tasks_security_group_id" {
  description = "ECS tasks security group ID from base module"
  type        = string
}

variable "ecs_log_group_name" {
  description = "CloudWatch log group name from base module"
  type        = string
}

variable "alb_https_listener_arn" {
  description = "HTTPS listener ARN from base module"
  type        = string
}

variable "rds_address" {
  description = "RDS hostname from base module"
  type        = string
}

variable "rds_port" {
  description = "RDS port from base module"
  type        = number
  default     = 5432
}

variable "kms_key_arn" {
  description = "KMS key ARN for secrets encryption"
  type        = string
}

# ── Signing Keys ────────────────────────────────────────────────────────
variable "server_signing_public_key" {
  description = "Server ed25519 public key (hex-encoded)"
  type        = string
  sensitive   = true
}

variable "server_signing_private_key" {
  description = "Server ed25519 private key (hex-encoded)"
  type        = string
  sensitive   = true
}

variable "toolhost_signing_public_key" {
  description = "Toolhost ed25519 public key (hex-encoded)"
  type        = string
  sensitive   = true
}

variable "toolhost_signing_private_key" {
  description = "Toolhost ed25519 private key (hex-encoded)"
  type        = string
  sensitive   = true
}
