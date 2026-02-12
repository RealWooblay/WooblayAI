# ─────────────────────────────────────────────────────────────────────────────
# ALB Routing – Routes traffic to this tenant's EC2 instance
# ─────────────────────────────────────────────────────────────────────────────

resource "aws_lb_target_group" "runtime" {
  name        = "wooblay-${var.tenant_name}"
  port        = 4800
  protocol    = "HTTP"
  vpc_id      = var.vpc_id
  target_type = "instance"

  health_check {
    enabled             = true
    path                = "/health"
    port                = "4800"
    protocol            = "HTTP"
    healthy_threshold   = 2
    unhealthy_threshold = 3
    timeout             = 5
    interval            = 15
    matcher             = "200"
  }

  tags = {
    Name   = "wooblay-${var.tenant_name}"
    Tenant = var.tenant_name
  }
}

# Register the EC2 instance with the target group
resource "aws_lb_target_group_attachment" "runtime" {
  target_group_arn = aws_lb_target_group.runtime.arn
  target_id        = aws_instance.runtime.id
  port             = 4800
}

# ALB listener rule: route by path prefix /t/<tenant>/*
# Since we don't have a custom domain, use path-based routing:
#   http://<alb-dns>/t/<tenant-name>/* -> this instance
resource "aws_lb_listener_rule" "runtime" {
  listener_arn = var.alb_http_listener_arn
  priority     = 100 + random_integer.priority.result

  action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.runtime.arn
  }

  condition {
    path_pattern {
      values = ["/*"]
    }
  }

  # For MVP with single tenant, catch all traffic.
  # When multiple tenants exist, switch to host-based routing with custom domain.

  tags = {
    Tenant = var.tenant_name
  }
}

# Random priority offset to avoid collisions between tenants
resource "random_integer" "priority" {
  min = 1
  max = 100
}
