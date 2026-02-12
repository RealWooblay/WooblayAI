# ─────────────────────────────────────────────────────────────────────────────
# EC2 – Hardened Runtime Instance
#
# Security:
#   - Private subnet (no public IP)
#   - IMDSv2 required, hop limit 1 (blocks container SSRF)
#   - Encrypted EBS (KMS)
#   - No SSH key pair (SSM Session Manager only)
#   - Userdata bootstrap: Docker, iptables, compose stack
# ─────────────────────────────────────────────────────────────────────────────

# Latest Amazon Linux 2023 AMI
data "aws_ami" "al2023" {
  most_recent = true
  owners      = ["amazon"]

  filter {
    name   = "name"
    values = ["al2023-ami-2023*-x86_64"]
  }

  filter {
    name   = "state"
    values = ["available"]
  }

  filter {
    name   = "virtualization-type"
    values = ["hvm"]
  }
}

# ── Launch Template ─────────────────────────────────────────────────────
resource "aws_launch_template" "runtime" {
  name_prefix   = "wooblay-${var.tenant_name}-"
  image_id      = data.aws_ami.al2023.id
  instance_type = var.instance_type

  # NO SSH key pair — SSM only
  # key_name = <intentionally omitted>

  # IMDSv2 required + hop limit 1 (prevents container SSRF to metadata)
  metadata_options {
    http_endpoint               = "enabled"
    http_tokens                 = "required" # IMDSv2 only
    http_put_response_hop_limit = 1          # Host only, not containers
    instance_metadata_tags      = "enabled"
  }

  # Encrypted root volume
  block_device_mappings {
    device_name = "/dev/xvda"

    ebs {
      volume_size           = var.volume_size_gb
      volume_type           = "gp3"
      encrypted             = true
      kms_key_id            = var.kms_key_arn
      delete_on_termination = true
    }
  }

  # Instance profile for SSM + ECR + Secrets Manager
  iam_instance_profile {
    arn = aws_iam_instance_profile.runtime.arn
  }

  # Network interface with security group and subnet
  network_interfaces {
    associate_public_ip_address = false
    security_groups             = [var.runtime_security_group_id]
    subnet_id                   = var.private_subnet_id
  }

  # Userdata script (base64-encoded)
  user_data = base64encode(templatefile("${path.module}/userdata.sh", {
    tenant_name = var.tenant_name
    aws_region  = var.aws_region
    secret_arn  = aws_secretsmanager_secret.tenant.arn
  }))

  tag_specifications {
    resource_type = "instance"
    tags = {
      Name   = "wooblay-${var.tenant_name}"
      Tenant = var.tenant_name
    }
  }

  tag_specifications {
    resource_type = "volume"
    tags = {
      Name   = "wooblay-${var.tenant_name}-vol"
      Tenant = var.tenant_name
    }
  }

  tags = {
    Name = "wooblay-${var.tenant_name}-lt"
  }
}

# ── EC2 Instance ────────────────────────────────────────────────────────
resource "aws_instance" "runtime" {
  launch_template {
    id      = aws_launch_template.runtime.id
    version = "$Latest"
  }

  # subnet and security group are in the launch template's network_interfaces

  tags = {
    Name   = "wooblay-${var.tenant_name}"
    Tenant = var.tenant_name
  }

  # Wait for instance to pass status checks before considering it "created"
  timeouts {
    create = "10m"
  }
}
