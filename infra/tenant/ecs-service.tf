# ─────────────────────────────────────────────────────────────────────────────
# ECS Task Definition & Service – Per-Tenant
# Two containers: agent-runtime (OpenClaw + toolhost) + wooblay-gate
# ─────────────────────────────────────────────────────────────────────────────

resource "aws_ecs_task_definition" "tenant" {
  family                   = "wooblay-${var.tenant_name}"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = "1024" # 1 vCPU
  memory                   = "2048" # 2 GB
  execution_role_arn       = var.ecs_execution_role_arn
  task_role_arn            = var.ecs_task_role_arn

  container_definitions = jsonencode([
    # ── Agent Runtime Container ───────────────────────────────────────
    {
      name      = "agent-runtime"
      image     = var.agent_runtime_image
      essential = true
      cpu       = 512
      memory    = 1024

      environment = [
        { name = "GATE_URL", value = "http://localhost:4800" },
        { name = "TOOLHOST_PORT", value = "8990" },
      ]

      secrets = [
        {
          name      = "TOOLHOST_PUBLIC_KEY"
          valueFrom = "${aws_secretsmanager_secret.tenant.arn}:toolhost_public_key::"
        },
        {
          name      = "TOOLHOST_PRIVATE_KEY"
          valueFrom = "${aws_secretsmanager_secret.tenant.arn}:toolhost_private_key::"
        },
      ]

      logConfiguration = {
        logDriver = "awslogs"
        options = {
          "awslogs-group"         = var.ecs_log_group_name
          "awslogs-region"        = var.aws_region
          "awslogs-stream-prefix" = "${var.tenant_name}-agent"
        }
      }

      dependsOn = [
        {
          containerName = "wooblay-gate"
          condition     = "HEALTHY"
        }
      ]
    },

    # ── Wooblay Gate Container ────────────────────────────────────────
    {
      name      = "wooblay-gate"
      image     = var.gate_image
      essential = true
      cpu       = 512
      memory    = 1024

      portMappings = [
        {
          containerPort = 4800
          protocol      = "tcp"
        }
      ]

      environment = [
        { name = "NODE_ENV", value = "production" },
        { name = "PORT", value = "4800" },
      ]

      secrets = [
        {
          name      = "DATABASE_URL"
          valueFrom = "${aws_secretsmanager_secret.tenant.arn}:database_url::"
        },
        {
          name      = "SERVER_SIGNING_PUBLIC_KEY"
          valueFrom = "${aws_secretsmanager_secret.tenant.arn}:server_public_key::"
        },
        {
          name      = "SERVER_SIGNING_PRIVATE_KEY"
          valueFrom = "${aws_secretsmanager_secret.tenant.arn}:server_private_key::"
        },
      ]

      healthCheck = {
        command     = ["CMD-SHELL", "wget --spider -q http://localhost:4800/health || exit 1"]
        interval    = 15
        timeout     = 5
        retries     = 3
        startPeriod = 30
      }

      logConfiguration = {
        logDriver = "awslogs"
        options = {
          "awslogs-group"         = var.ecs_log_group_name
          "awslogs-region"        = var.aws_region
          "awslogs-stream-prefix" = "${var.tenant_name}-gate"
        }
      }
    }
  ])

  tags = {
    Name   = "wooblay-${var.tenant_name}"
    Tenant = var.tenant_name
  }
}

# ── ECS Service ─────────────────────────────────────────────────────────
resource "aws_ecs_service" "tenant" {
  name            = "wooblay-${var.tenant_name}"
  cluster         = var.ecs_cluster_arn
  task_definition = aws_ecs_task_definition.tenant.arn
  desired_count   = 1
  launch_type     = "FARGATE"

  network_configuration {
    subnets          = var.private_subnet_ids
    security_groups  = [aws_security_group.tenant.id]
    assign_public_ip = false
  }

  load_balancer {
    target_group_arn = aws_lb_target_group.tenant.arn
    container_name   = "wooblay-gate"
    container_port   = 4800
  }

  deployment_maximum_percent         = 200
  deployment_minimum_healthy_percent = 100

  tags = {
    Name   = "wooblay-${var.tenant_name}"
    Tenant = var.tenant_name
  }

  depends_on = [aws_lb_listener_rule.tenant]
}
