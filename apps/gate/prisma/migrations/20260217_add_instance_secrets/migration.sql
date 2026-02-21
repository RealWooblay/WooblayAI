-- Add secrets field to Instance for agent-visible environment variables
-- JSON array: [{ key: "OPENAI_API_KEY", encryptedValue: "enc:v1:..." }]
-- These are injected as env vars into the agent container — no connection required.
ALTER TABLE "Instance" ADD COLUMN "secrets" TEXT;
