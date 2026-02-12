# ─────────────────────────────────────────────────────────────────────────────
# RDS – REMOVED
#
# PostgreSQL now runs directly on the EC2 instance (Docker container) with
# encrypted EBS storage. This provides:
#   - Data stays on the tenant's dedicated instance (no shared DB)
#   - Lower cost ($0 vs ~$15/month for db.t4g.micro)
#   - Simpler architecture (one box, one security boundary)
#
# If multi-AZ / managed backups are needed later, re-enable RDS per-tenant
# in the runtime module.
# ─────────────────────────────────────────────────────────────────────────────
