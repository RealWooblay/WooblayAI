# ─────────────────────────────────────────────────────────────────────────────
# ALB – Public-facing Application Load Balancer
# Routes traffic to tenant EC2 instances in private subnets.
# MVP: HTTP only (no custom domain). Add ACM cert + HTTPS when domain is ready.
# ─────────────────────────────────────────────────────────────────────────────

# ── ALB Security Group ──────────────────────────────────────────────────
resource "aws_security_group" "alb" {
  name_prefix = "${var.project_name}-alb-"
  vpc_id      = aws_vpc.main.id
  description = "Security group for Wooblay ALB"

  ingress {
    from_port   = 80
    to_port     = 80
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
    description = "HTTP from anywhere"
  }

  ingress {
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
    description = "HTTPS from anywhere (future)"
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
    description = "Allow all outbound"
  }

  tags = {
    Name = "${var.project_name}-alb"
  }

  lifecycle {
    create_before_destroy = true
  }
}

# ── Application Load Balancer ───────────────────────────────────────────
resource "aws_lb" "main" {
  name               = "${var.project_name}-alb"
  internal           = false
  load_balancer_type = "application"
  security_groups    = [aws_security_group.alb.id]
  subnets            = aws_subnet.public[*].id

  enable_deletion_protection = false

  tags = {
    Name = "${var.project_name}-alb"
  }
}

# ── HTTP Listener (default 404) ────────────────────────────────────────
# Tenant routing rules are added by the runtime module.
resource "aws_lb_listener" "http" {
  load_balancer_arn = aws_lb.main.arn
  port              = 80
  protocol          = "HTTP"

  default_action {
    type = "fixed-response"
    fixed_response {
      content_type = "application/json"
      message_body = "{\"error\":\"not_found\",\"message\":\"No tenant matched this request\"}"
      status_code  = "404"
    }
  }

  tags = {
    Name = "${var.project_name}-http-listener"
  }
}
