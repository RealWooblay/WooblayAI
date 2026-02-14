# ─────────────────────────────────────────────────────────────────────────────
# Runtime Module – Input Variables
# ─────────────────────────────────────────────────────────────────────────────

variable "tenant_name" {
  description = "Unique tenant identifier (lowercase, alphanumeric + hyphens)"
  type        = string

  validation {
    condition     = can(regex("^[a-z0-9][a-z0-9-]{1,30}[a-z0-9]$", var.tenant_name))
    error_message = "Tenant name must be 3-32 chars, lowercase alphanumeric + hyphens."
  }
}

variable "aws_region" {
  description = "AWS region"
  type        = string
  default     = "us-east-1"
}

# ── Base Infrastructure References ──────────────────────────────────────
variable "vpc_id" {
  description = "VPC ID from base infrastructure"
  type        = string
}

variable "private_subnet_id" {
  description = "Private subnet ID for the EC2 instance"
  type        = string
}

variable "public_subnet_ids" {
  description = "Public subnet IDs (for ALB target group)"
  type        = list(string)
}

variable "runtime_security_group_id" {
  description = "Base runtime security group ID"
  type        = string
}

variable "alb_arn" {
  description = "ALB ARN"
  type        = string
}

variable "alb_http_listener_arn" {
  description = "ALB HTTP listener ARN for adding routing rules"
  type        = string
}

variable "kms_key_arn" {
  description = "KMS key ARN for encrypting secrets and EBS"
  type        = string
}

variable "log_group_name" {
  description = "CloudWatch log group name"
  type        = string
}

# ── Container Images ────────────────────────────────────────────────────
variable "gate_image" {
  description = "Full ECR URI for the Wooblay Gate image"
  type        = string
}

variable "agent_image" {
  description = "Full ECR URI for the agent runtime image"
  type        = string
}

# ── Signing Keys (sensitive) ────────────────────────────────────────────
variable "server_private_key" {
  description = "Wooblay server ed25519 private key (hex-encoded DER)"
  type        = string
  sensitive   = true
}

variable "server_public_key" {
  description = "Wooblay server ed25519 public key (hex-encoded DER)"
  type        = string
  sensitive   = true
}

# ── Instance Configuration ──────────────────────────────────────────────
variable "instance_type" {
  description = "EC2 instance type"
  type        = string
  default     = "t4g.medium"
}

variable "volume_size_gb" {
  description = "EBS volume size in GB"
  type        = number
  default     = 30
}

variable "tool_filter" {
  description = "Wooblay tool filter: all, risky, or custom"
  type        = string
  default     = "risky"
}
