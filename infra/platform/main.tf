# ─────────────────────────────────────────────────────────────────────────────
# Wooblay Platform API — Central deployment
#
# Deploys the Gate in platform mode on a dedicated EC2 instance with:
#   - Connection to central RDS
#   - ALB routing for api.wooblay.com
#   - Clerk keys for user auth
#   - Ability to provision per-user EC2 instances
# ─────────────────────────────────────────────────────────────────────────────

terraform {
  required_version = ">= 1.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.0"
    }
  }

  backend "s3" {
    bucket = "wooblay-terraform-state"
    key    = "platform/terraform.tfstate"
    region = "us-east-1"
  }
}

provider "aws" {
  region = var.aws_region
}

# ── Variables ────────────────────────────────────────────────────────────────

variable "aws_region" {
  type    = string
  default = "us-east-1"
}

variable "gate_image" {
  description = "ECR URI for the Gate Docker image"
  type        = string
}

variable "instance_type" {
  type    = string
  default = "t4g.small"
}

variable "clerk_publishable_key" {
  type      = string
  sensitive = true
}

variable "clerk_secret_key" {
  type      = string
  sensitive = true
}

variable "server_private_key" {
  description = "Ed25519 private key for receipt signing"
  type        = string
  sensitive   = true
}

variable "server_public_key" {
  description = "Ed25519 public key for receipt verification"
  type        = string
  sensitive   = true
}

# ── Data: read base infrastructure outputs ───────────────────────────────────

data "terraform_remote_state" "base" {
  backend = "s3"
  config = {
    bucket = "wooblay-terraform-state"
    key    = "base/terraform.tfstate"
    region = "us-east-1"
  }
}

locals {
  vpc_id              = data.terraform_remote_state.base.outputs.vpc_id
  private_subnet_ids  = data.terraform_remote_state.base.outputs.private_subnet_ids
  alb_listener_arn    = data.terraform_remote_state.base.outputs.alb_http_listener_arn
  sg_runtime          = data.terraform_remote_state.base.outputs.runtime_security_group_id
  platform_db_secret  = data.terraform_remote_state.base.outputs.platform_db_secret_arn
  ecr_gate_url        = data.terraform_remote_state.base.outputs.ecr_gate_repository_url
}

# ── Secrets Manager: platform API config ─────────────────────────────────────

resource "aws_secretsmanager_secret" "platform_config" {
  name = "wooblay/platform/config"
}

resource "aws_secretsmanager_secret_version" "platform_config" {
  secret_id = aws_secretsmanager_secret.platform_config.id
  secret_string = jsonencode({
    PLATFORM_MODE              = "true"
    CLERK_PUBLISHABLE_KEY      = var.clerk_publishable_key
    CLERK_SECRET_KEY           = var.clerk_secret_key
    WOOBLAY_SERVER_PRIVATE_KEY = var.server_private_key
    WOOBLAY_SERVER_PUBLIC_KEY  = var.server_public_key
    NODE_ENV                   = "production"
  })
}

# ── IAM ──────────────────────────────────────────────────────────────────────

resource "aws_iam_role" "platform" {
  name = "wooblay-platform"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "ec2.amazonaws.com" }
      Action    = "sts:AssumeRole"
    }]
  })
}

resource "aws_iam_role_policy_attachment" "platform_ssm" {
  role       = aws_iam_role.platform.name
  policy_arn = "arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore"
}

resource "aws_iam_role_policy" "platform_ecr_secrets" {
  name = "ecr-secrets-ec2"
  role = aws_iam_role.platform.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect   = "Allow"
        Action   = ["ecr:GetAuthorizationToken", "ecr:BatchGetImage", "ecr:GetDownloadUrlForLayer"]
        Resource = "*"
      },
      {
        Effect   = "Allow"
        Action   = ["secretsmanager:GetSecretValue"]
        Resource = [
          aws_secretsmanager_secret.platform_config.arn,
          local.platform_db_secret,
        ]
      },
      {
        Effect   = "Allow"
        Action   = ["ec2:*", "iam:PassRole"]
        Resource = "*"
      },
    ]
  })
}

resource "aws_iam_instance_profile" "platform" {
  name = "wooblay-platform"
  role = aws_iam_role.platform.name
}

# ── ALB Target Group ─────────────────────────────────────────────────────────

resource "aws_lb_target_group" "platform" {
  name     = "wooblay-platform"
  port     = 4800
  protocol = "HTTP"
  vpc_id   = local.vpc_id

  health_check {
    path                = "/health"
    interval            = 30
    timeout             = 5
    healthy_threshold   = 2
    unhealthy_threshold = 3
  }
}

resource "aws_lb_listener_rule" "platform" {
  listener_arn = local.alb_listener_arn
  priority     = 1

  action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.platform.arn
  }

  condition {
    path_pattern {
      values = ["/api/*", "/health"]
    }
  }
}

# ── EC2 Instance ─────────────────────────────────────────────────────────────

data "aws_ami" "amazon_linux" {
  most_recent = true
  owners      = ["amazon"]

  filter {
    name   = "name"
    values = ["al2023-ami-*-arm64"]
  }
}

resource "aws_instance" "platform" {
  ami                    = data.aws_ami.amazon_linux.id
  instance_type          = var.instance_type
  subnet_id              = local.private_subnet_ids[0]
  vpc_security_group_ids = [local.sg_runtime]
  iam_instance_profile   = aws_iam_instance_profile.platform.name

  metadata_options {
    http_endpoint               = "enabled"
    http_tokens                 = "required"
    http_put_response_hop_limit = 1
  }

  root_block_device {
    volume_size = 30
    volume_type = "gp3"
    encrypted   = true
  }

  user_data = base64encode(templatefile("${path.module}/userdata.sh", {
    aws_region       = var.aws_region
    gate_image       = var.gate_image
    config_secret    = aws_secretsmanager_secret.platform_config.name
    db_secret        = "wooblay/platform/database-url"
  }))

  tags = {
    Name = "wooblay-platform"
  }
}

resource "aws_lb_target_group_attachment" "platform" {
  target_group_arn = aws_lb_target_group.platform.arn
  target_id        = aws_instance.platform.id
  port             = 4800
}

# ── Outputs ──────────────────────────────────────────────────────────────────

output "platform_instance_id" {
  value = aws_instance.platform.id
}

output "platform_private_ip" {
  value = aws_instance.platform.private_ip
}
