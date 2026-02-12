# ─────────────────────────────────────────────────────────────────────────────
# RDS — Central Platform Database
#
# Hosts the platform-level data: users, coupons, instance registry,
# and synced receipts/audit trail. Per-instance operational databases
# remain local on each EC2 tenant.
# ─────────────────────────────────────────────────────────────────────────────

resource "random_password" "platform_db" {
  length  = 24
  special = false
}

resource "aws_db_subnet_group" "platform" {
  name       = "wooblay-platform"
  subnet_ids = aws_subnet.private[*].id

  tags = {
    Name = "wooblay-platform-db-subnet-group"
  }
}

resource "aws_security_group" "platform_db" {
  name_prefix = "wooblay-platform-db-"
  vpc_id      = aws_vpc.main.id

  ingress {
    description     = "Postgres from platform EC2/ECS"
    from_port       = 5432
    to_port         = 5432
    protocol        = "tcp"
    security_groups = [aws_security_group.runtime.id]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = {
    Name = "wooblay-platform-db"
  }
}

resource "aws_db_instance" "platform" {
  identifier     = "wooblay-platform"
  engine         = "postgres"
  engine_version = "16"
  instance_class = var.platform_db_instance_class

  allocated_storage     = 20
  max_allocated_storage = 100
  storage_type          = "gp3"
  storage_encrypted     = true
  kms_key_id            = aws_kms_key.secrets.arn

  db_name  = "wooblay_platform"
  username = "wooblay"
  password = random_password.platform_db.result

  db_subnet_group_name   = aws_db_subnet_group.platform.name
  vpc_security_group_ids = [aws_security_group.platform_db.id]

  multi_az            = false  # Single AZ for MVP, enable later
  publicly_accessible = false
  skip_final_snapshot = true

  backup_retention_period = 7
  backup_window           = "03:00-04:00"
  maintenance_window      = "sun:04:00-sun:05:00"

  tags = {
    Name = "wooblay-platform"
  }
}

# Store the DB URL in Secrets Manager for the platform API
resource "aws_secretsmanager_secret" "platform_db_url" {
  name       = "wooblay/platform/database-url"
  kms_key_id = aws_kms_key.secrets.arn
}

resource "aws_secretsmanager_secret_version" "platform_db_url" {
  secret_id = aws_secretsmanager_secret.platform_db_url.id
  secret_string = jsonencode({
    DATABASE_URL = "postgresql://wooblay:${random_password.platform_db.result}@${aws_db_instance.platform.endpoint}/wooblay_platform"
    DB_HOST      = aws_db_instance.platform.address
    DB_PORT      = tostring(aws_db_instance.platform.port)
    DB_NAME      = "wooblay_platform"
    DB_USER      = "wooblay"
    DB_PASSWORD  = random_password.platform_db.result
  })
}
