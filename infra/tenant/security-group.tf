# ─────────────────────────────────────────────────────────────────────────────
# Per-Tenant Security Group
# Allows ALB → Gate traffic and Gate → RDS traffic
# ─────────────────────────────────────────────────────────────────────────────

resource "aws_security_group" "tenant" {
  name_prefix = "wooblay-${var.tenant_name}-"
  vpc_id      = var.vpc_id
  description = "Security group for tenant ${var.tenant_name} ECS tasks"

  # Allow inbound from ALB on Gate port
  ingress {
    from_port       = 4800
    to_port         = 4800
    protocol        = "tcp"
    security_groups = [] # ALB SG ID will be added via the base ECS tasks SG
    cidr_blocks     = [] # Restricted to VPC
    description     = "Gate port from ALB (via ECS tasks SG)"
  }

  # Allow internal communication between containers in the same task
  ingress {
    from_port   = 8990
    to_port     = 8990
    protocol    = "tcp"
    self        = true
    description = "Toolhost port (intra-task)"
  }

  # Allow all outbound (for RDS, ECR, Secrets Manager, etc.)
  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
    description = "Allow all outbound"
  }

  # Allow outbound to RDS
  egress {
    from_port   = 5432
    to_port     = 5432
    protocol    = "tcp"
    cidr_blocks = ["10.0.0.0/16"]
    description = "Postgres to RDS in VPC"
  }

  tags = {
    Name   = "wooblay-${var.tenant_name}"
    Tenant = var.tenant_name
  }

  lifecycle {
    create_before_destroy = true
  }
}
