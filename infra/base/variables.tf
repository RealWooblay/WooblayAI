# ─────────────────────────────────────────────────────────────────────────────
# Wooblay Base – Input Variables
# ─────────────────────────────────────────────────────────────────────────────

variable "project_name" {
  description = "Project name used for resource naming and tagging"
  type        = string
  default     = "wooblay"
}

variable "aws_region" {
  description = "AWS region for all resources"
  type        = string
  default     = "us-east-1"
}

variable "platform_db_instance_class" {
  description = "RDS instance class for the central platform database"
  type        = string
  default     = "db.t4g.micro"
}
