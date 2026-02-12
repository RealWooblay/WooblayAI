# ─────────────────────────────────────────────────────────────────────────────
# ALB Routing – Target Group + Host-Based Listener Rule
# Routes <tenant>.wooblay.run to the tenant's ECS service
# ─────────────────────────────────────────────────────────────────────────────

resource "aws_lb_target_group" "tenant" {
  name        = "wooblay-${var.tenant_name}"
  port        = 4800
  protocol    = "HTTP"
  vpc_id      = var.vpc_id
  target_type = "ip"

  health_check {
    enabled             = true
    healthy_threshold   = 2
    unhealthy_threshold = 3
    interval            = 15
    timeout             = 5
    path                = "/health"
    port                = "traffic-port"
    protocol            = "HTTP"
    matcher             = "200"
  }

  deregistration_delay = 30

  tags = {
    Name   = "wooblay-${var.tenant_name}"
    Tenant = var.tenant_name
  }
}

# ── Host-Based Listener Rule ────────────────────────────────────────────
# Routes requests for <tenant>.wooblay.run to this tenant's target group
resource "aws_lb_listener_rule" "tenant" {
  listener_arn = var.alb_https_listener_arn

  action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.tenant.arn
  }

  condition {
    host_header {
      values = ["${var.tenant_name}.${var.domain_name}"]
    }
  }

  tags = {
    Name   = "wooblay-${var.tenant_name}-rule"
    Tenant = var.tenant_name
  }
}
