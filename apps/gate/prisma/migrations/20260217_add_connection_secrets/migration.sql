-- Add secrets field to Connection for user-defined secrets (API keys, tokens)
-- Each secret has a mode: "agent" (injected into agent env) or "exec_only" (only in ephemeral containers)
ALTER TABLE "Connection" ADD COLUMN "secrets" TEXT;
