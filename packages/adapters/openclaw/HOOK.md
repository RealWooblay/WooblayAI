---
name: wooblay
description: "Wooblay Gate enforcement — every tool call is policy-evaluated, with audit logging and receipt generation"
homepage: https://github.com/wooblay/wooblay
metadata:
  openclaw:
    emoji: "🛡️"
    events:
      - "tool"
      - "command"
    requires:
      env:
        - "GATE_URL"
    export: "default"
---

# Wooblay Gate Hook

Every tool call — from any source (built-in, plugin, MCP server) — is routed through Wooblay Gate for AI risk classification and policy evaluation.

## What It Does

- **Enforces policy**: On `tool:start`, submits to Gate. If Gate says DENY, throws to abort execution. If Gate is unreachable, blocks (fail-safe).
- **Audit trail**: Captures `tool:result` events and generates signed receipts for the cryptographic audit chain.
- **Session tracking**: Logs `command:new` and `command:stop` for session lifecycle.

No skip lists. No hardcoded exceptions. Every action goes through Gate.

## Requirements

- `GATE_URL` environment variable pointing to Wooblay Gate
- Wooblay Gate must be running and accessible
- If Gate is unreachable, all tool calls are blocked (fail-safe)

## Configuration

Set via environment variables:

- `GATE_URL`: Wooblay Gate URL (default: `http://localhost:4800`)
