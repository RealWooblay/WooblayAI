# Tenant Module (DEPRECATED)

This module has been superseded by `infra/runtime/` which deploys hardened
EC2 instances instead of ECS Fargate tasks.

The runtime module provides:
- Single hardened EC2 instance per tenant (private subnet, no public IP)
- IMDSv2 required, hop limit 1 (blocks container SSRF)
- Encrypted EBS storage
- No SSH access (SSM Session Manager only)
- iptables network isolation for the agent container
- PostgreSQL on-instance (no shared RDS)

See `../runtime/` for the current deployment approach.
