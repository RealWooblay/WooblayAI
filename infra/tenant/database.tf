# ─────────────────────────────────────────────────────────────────────────────
# Tenant Database – CREATE DATABASE and CREATE ROLE via provisioner
# Uses null_resource to run SQL commands against the shared RDS instance.
# ─────────────────────────────────────────────────────────────────────────────

resource "null_resource" "tenant_database" {
  triggers = {
    tenant_name = var.tenant_name
    rds_address = var.rds_address
  }

  provisioner "local-exec" {
    command = <<-EOT
      export PGPASSWORD="$DB_ADMIN_PASSWORD"

      echo "Creating database and role for tenant: ${var.tenant_name}"

      # Create the tenant database role
      psql -h ${var.rds_address} -p ${var.rds_port} -U wooblay_admin -d wooblay -c \
        "DO \$\$
        BEGIN
          IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'wooblay_${var.tenant_name}') THEN
            CREATE ROLE wooblay_${var.tenant_name} WITH LOGIN PASSWORD '${random_password.db.result}';
          END IF;
        END
        \$\$;"

      # Create the tenant database
      psql -h ${var.rds_address} -p ${var.rds_port} -U wooblay_admin -d wooblay -c \
        "SELECT 'CREATE DATABASE wooblay_${var.tenant_name} OWNER wooblay_${var.tenant_name}'
         WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'wooblay_${var.tenant_name}')\gexec"

      # Grant privileges
      psql -h ${var.rds_address} -p ${var.rds_port} -U wooblay_admin -d wooblay_${var.tenant_name} -c \
        "GRANT ALL PRIVILEGES ON DATABASE wooblay_${var.tenant_name} TO wooblay_${var.tenant_name};
         GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO wooblay_${var.tenant_name};
         ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO wooblay_${var.tenant_name};"

      echo "Database setup complete for tenant: ${var.tenant_name}"
    EOT

    environment = {
      DB_ADMIN_PASSWORD = "CHANGE_ME_BEFORE_PRODUCTION"
    }
  }

  depends_on = [random_password.db]
}
