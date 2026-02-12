# ─────────────────────────────────────────────────────────────────────────────
# Wooblay Runtime Module – Hardened EC2 Per-Tenant Deployment
#
# Provisions a single hardened EC2 instance in a private subnet running:
#   - Wooblay Gate (policy, approvals, receipts, UI)
#   - Agent Runtime (OpenClaw, etc.) — network-isolated
#   - PostgreSQL (tenant-dedicated, encrypted EBS)
#
# Security: No SSH, IMDSv2, encrypted EBS, SSM-only access, iptables isolation.
# ─────────────────────────────────────────────────────────────────────────────

terraform {
  required_version = ">= 1.5"

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
    key    = "runtime/terraform.tfstate"
    region = "us-east-1"
  }
}

provider "aws" {
  region = var.aws_region

  default_tags {
    tags = {
      Project     = "wooblay"
      ManagedBy   = "terraform"
      Environment = "runtime"
      Tenant      = var.tenant_name
    }
  }
}
