# External Agents — Plug Wooblay into Any AI Agent

Wooblay isn't just an agent hoster. External agents (OpenAI GPTs, Claude MCP, LangChain, CrewAI, or any HTTP client) can call the Wooblay gateway with the **same security enforcement** as Wooblay-hosted agents.

---

## How it works

1. **Create an API key** in Settings > External API Keys
2. **Paste the key** into your external agent (GPT Action, MCP server, custom tool)
3. The agent calls `POST /api/gateway/execute` with the key, an action name, and a command
4. Wooblay runs the full security pipeline:
   - Policy evaluation (org-level rules — same as hosted agents)
   - Scope boundaries (per-connection allowed/blocked targets)
   - Pre-execution simulation (dry-run, API check)
   - Ephemeral secure execution (Docker container, credentials injected from vault, destroyed after)
5. The agent gets the result. Credentials are never exposed.

**There is no fixed action list.** Any action can be executed. The action name is used for policy matching and audit trail.

---

## Quick start

### 1. Create an API key

Settings page > External API Keys > Create. Copy the key (shown once).

### 2. Call the gateway

```bash
curl -X POST https://gate.wooblay.com/api/gateway/execute \
  -H "Authorization: Bearer wbl_ak_your_key_here" \
  -H "Content-Type: application/json" \
  -d '{
    "action": "deploy:staging",
    "params": {
      "command": "npm run deploy -- --env staging",
      "provider": "your-provider",
      "image": "node:20-slim"
    }
  }'
```

### 3. Check connected providers

```bash
curl https://gate.wooblay.com/api/gateway/capabilities \
  -H "Authorization: Bearer wbl_ak_your_key_here"
```

Returns which providers are connected (and therefore which credentials are available).

---

## OpenAI GPT Actions

1. In your GPT, go to Configure > Actions > Create new action
2. Import the OpenAPI spec: `docs/openapi-gateway.yaml`
3. Set authentication to "API Key" > Bearer > paste your `wbl_ak_` key
4. The GPT can now call `executeAction` — any action, through the secure gateway

---

## Claude MCP

Write a thin MCP server that bridges tool calls to the Wooblay gateway:

```typescript
const WOOBLAY_KEY = process.env.WOOBLAY_API_KEY;
const GATE_URL = 'https://gate.wooblay.com/api/gateway/execute';

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const response = await fetch(GATE_URL, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${WOOBLAY_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      action: request.params.name,
      params: {
        command: request.params.arguments?.command,
        provider: request.params.arguments?.provider,
        ...request.params.arguments,
      },
    }),
  });
  return { content: [{ type: 'text', text: JSON.stringify(await response.json()) }] };
});
```

---

## LangChain / CrewAI / any framework

Any framework that supports custom tools can call the gateway:

```python
import requests

def wooblay_execute(action: str, command: str, provider: str, **kwargs) -> dict:
    response = requests.post(
        "https://gate.wooblay.com/api/gateway/execute",
        headers={
            "Authorization": f"Bearer {WOOBLAY_API_KEY}",
            "Content-Type": "application/json",
        },
        json={
            "action": action,
            "params": {"command": command, "provider": provider, **kwargs},
        },
    )
    return response.json()
```

---

## Same functionality checklist

| Capability | Hosted agent | External agent (API key) |
|------------|-------------|--------------------------|
| Policy (allow/deny by rule) | Via tool/execute | Via gateway (inline policy eval) |
| Scope boundaries (branch/repo) | Via gateway | Same |
| Credential vault | Via gateway | Same |
| Simulation (dry-run) | Via gateway | Same |
| Secure execution (ephemeral container) | Via gateway | Same |
| Audit trail (events) | Run events + receipts | Event log (gateway.executed) |
| Cost attribution | Per-run | Per-invocation (event log) |

---

## API key management

- **Create**: Settings > External API Keys > name + optional expiry
- **Revoke**: Click "Revoke" on any key
- **Key is shown once** at creation — copy it immediately
- Keys are stored as SHA-256 hashes (plaintext never persisted)
- Keys are org-scoped — they inherit the org's policies and connections
