# ─────────────────────────────────────────────────────────────────────────────
# IAM – Minimal EC2 Instance Profile
#
# Permissions:
#   - SSM Session Manager (SSH-less access)
#   - ECR pull (download container images)
#   - Secrets Manager read (tenant config)
#   - CloudWatch Logs write (observability)
#   - KMS decrypt (for encrypted secrets)
# ─────────────────────────────────────────────────────────────────────────────

resource "aws_iam_role" "runtime" {
  name = "wooblay-runtime-${var.tenant_name}"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Action = "sts:AssumeRole"
        Effect = "Allow"
        Principal = {
          Service = "ec2.amazonaws.com"
        }
      }
    ]
  })

  tags = {
    Name = "wooblay-runtime-${var.tenant_name}"
  }
}

# SSM Session Manager (replaces SSH)
resource "aws_iam_role_policy_attachment" "ssm" {
  role       = aws_iam_role.runtime.name
  policy_arn = "arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore"
}

# ECR pull + Secrets Manager + CloudWatch
resource "aws_iam_role_policy" "runtime" {
  name = "wooblay-runtime-${var.tenant_name}-policy"
  role = aws_iam_role.runtime.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "ECRPull"
        Effect = "Allow"
        Action = [
          "ecr:GetDownloadUrlForLayer",
          "ecr:BatchGetImage",
          "ecr:GetAuthorizationToken",
          "ecr:BatchCheckLayerAvailability"
        ]
        Resource = "*"
      },
      {
        Sid    = "SecretsManagerRead"
        Effect = "Allow"
        Action = [
          "secretsmanager:GetSecretValue"
        ]
        Resource = [
          aws_secretsmanager_secret.tenant.arn
        ]
      },
      {
        Sid    = "KMSDecrypt"
        Effect = "Allow"
        Action = [
          "kms:Decrypt"
        ]
        Resource = [var.kms_key_arn]
      },
      {
        Sid    = "CloudWatchLogs"
        Effect = "Allow"
        Action = [
          "logs:CreateLogStream",
          "logs:PutLogEvents",
          "logs:DescribeLogStreams"
        ]
        Resource = "arn:aws:logs:${var.aws_region}:*:log-group:/wooblay/*"
      },
      {
        Sid    = "CloudWatchMetrics"
        Effect = "Allow"
        Action = [
          "cloudwatch:PutMetricData"
        ]
        Resource = "*"
        Condition = {
          StringEquals = {
            "cloudwatch:namespace" = "Wooblay"
          }
        }
      }
    ]
  })
}

resource "aws_iam_instance_profile" "runtime" {
  name = "wooblay-runtime-${var.tenant_name}"
  role = aws_iam_role.runtime.name
}
