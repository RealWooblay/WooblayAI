# ─────────────────────────────────────────────────────────────────────────────
# DNS & SSL — Route53 + ACM
#
# This module sets up:
#   - Route53 hosted zone for wooblay.com (if not already managed)
#   - ACM certificate for *.wooblay.com + wooblay.com
#   - DNS records for api.wooblay.com -> ALB
#
# The frontend (app.wooblay.com) is handled by Vercel with its own DNS.
#
# IMPORTANT: After creating the hosted zone, update your domain registrar's
# nameservers to point to the Route53 NS records.
# ─────────────────────────────────────────────────────────────────────────────

variable "domain_name" {
  description = "Root domain name"
  type        = string
  default     = "wooblay.com"
}

variable "create_hosted_zone" {
  description = "Whether to create a new Route53 hosted zone. Set false if zone already exists."
  type        = bool
  default     = true
}

# ── Route53 Hosted Zone ──────────────────────────────────────────────────────

resource "aws_route53_zone" "main" {
  count = var.create_hosted_zone ? 1 : 0
  name  = var.domain_name
}

# Look up existing zone if not creating
data "aws_route53_zone" "existing" {
  count = var.create_hosted_zone ? 0 : 1
  name  = var.domain_name
}

locals {
  zone_id = var.create_hosted_zone ? aws_route53_zone.main[0].zone_id : data.aws_route53_zone.existing[0].zone_id
}

# ── ACM Certificate ──────────────────────────────────────────────────────────

resource "aws_acm_certificate" "main" {
  domain_name               = var.domain_name
  subject_alternative_names = ["*.${var.domain_name}"]
  validation_method         = "DNS"

  lifecycle {
    create_before_destroy = true
  }
}

resource "aws_route53_record" "cert_validation" {
  for_each = {
    for dvo in aws_acm_certificate.main.domain_validation_options : dvo.domain_name => {
      name   = dvo.resource_record_name
      record = dvo.resource_record_value
      type   = dvo.resource_record_type
    }
  }

  zone_id = local.zone_id
  name    = each.value.name
  type    = each.value.type
  ttl     = 60
  records = [each.value.record]

  allow_overwrite = true
}

resource "aws_acm_certificate_validation" "main" {
  certificate_arn         = aws_acm_certificate.main.arn
  validation_record_fqdns = [for record in aws_route53_record.cert_validation : record.fqdn]
}

# ── DNS Records ──────────────────────────────────────────────────────────────

# api.wooblay.com -> ALB
resource "aws_route53_record" "api" {
  zone_id = local.zone_id
  name    = "api.${var.domain_name}"
  type    = "A"

  alias {
    name                   = aws_lb.main.dns_name
    zone_id                = aws_lb.main.zone_id
    evaluate_target_health = true
  }
}

# ── HTTPS Listener on ALB ────────────────────────────────────────────────────

resource "aws_lb_listener" "https" {
  load_balancer_arn = aws_lb.main.arn
  port              = 443
  protocol          = "HTTPS"
  certificate_arn   = aws_acm_certificate_validation.main.certificate_arn
  ssl_policy        = "ELBSecurityPolicy-TLS13-1-2-2021-06"

  default_action {
    type = "fixed-response"
    fixed_response {
      content_type = "text/plain"
      message_body = "Wooblay API"
      status_code  = "404"
    }
  }
}

# ── Outputs ──────────────────────────────────────────────────────────────────

output "zone_id" {
  description = "Route53 hosted zone ID"
  value       = local.zone_id
}

output "nameservers" {
  description = "Nameservers for the hosted zone (update your registrar)"
  value       = var.create_hosted_zone ? aws_route53_zone.main[0].name_servers : []
}

output "certificate_arn" {
  description = "ACM certificate ARN for *.wooblay.com"
  value       = aws_acm_certificate.main.arn
}
