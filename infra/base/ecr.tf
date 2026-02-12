# ─────────────────────────────────────────────────────────────────────────────
# ECR – Container Registries with Lifecycle Policies
# ─────────────────────────────────────────────────────────────────────────────

# ── Gate ECR Repository ─────────────────────────────────────────────────
resource "aws_ecr_repository" "gate" {
  name                 = "${var.project_name}-gate"
  image_tag_mutability = "MUTABLE"
  force_delete         = true

  image_scanning_configuration {
    scan_on_push = true
  }

  tags = {
    Name = "${var.project_name}-gate"
  }
}

resource "aws_ecr_lifecycle_policy" "gate" {
  repository = aws_ecr_repository.gate.name

  policy = jsonencode({
    rules = [
      {
        rulePriority = 1
        description  = "Keep last 10 images"
        selection = {
          tagStatus   = "any"
          countType   = "imageCountMoreThan"
          countNumber = 10
        }
        action = {
          type = "expire"
        }
      }
    ]
  })
}

# ── OpenClaw Runtime ECR Repository ─────────────────────────────────────
resource "aws_ecr_repository" "openclaw" {
  name                 = "openclaw-${var.project_name}"
  image_tag_mutability = "MUTABLE"
  force_delete         = true

  image_scanning_configuration {
    scan_on_push = true
  }

  tags = {
    Name = "openclaw-${var.project_name}"
  }
}

resource "aws_ecr_lifecycle_policy" "openclaw" {
  repository = aws_ecr_repository.openclaw.name

  policy = jsonencode({
    rules = [
      {
        rulePriority = 1
        description  = "Keep last 10 images"
        selection = {
          tagStatus   = "any"
          countType   = "imageCountMoreThan"
          countNumber = 10
        }
        action = {
          type = "expire"
        }
      }
    ]
  })
}
