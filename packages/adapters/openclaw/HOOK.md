---
name: wooblay
description: "Wooblay enterprise agent supervision — audit logging, receipt generation, and timeline tracking for all tool executions"
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

# Wooblay Supervision Hook

Enterprise agent supervision for OpenClaw. Provides audit logging, signed receipt generation, and real-time timeline tracking for all tool executions.

## What It Does

- Listens for `tool:start` events and logs tool calls to Wooblay Gate
- Captures `tool:result` events and generates signed receipts
- Tracks session lifecycle (`command:new`, `command:stop`) for audit trail
- All data is available in the Wooblay UI (timeline, receipts, audit)

## How It Works

This hook is the **audit/logging** component of Wooblay. It runs alongside the Exec Approval Bridge, which handles the actual blocking/approval of tool calls via OpenClaw's native Exec Approvals system.

- **Hook** (this): Fire-and-forget audit logging (non-blocking)
- **Bridge** (separate service): Blocking approval decisions via Exec Approvals

## Requirements

- `GATE_URL` environment variable pointing to Wooblay Gate
- Wooblay Gate must be running and accessible

## Configuration

Set via environment variables:

- `GATE_URL`: Wooblay Gate URL (default: `http://localhost:4800`)
- `WOOBLAY_TOOL_FILTER`: Which tools to track — `all`, `risky`, or `custom` (default: `risky`)
