# Wooblay Dashboard

React-based dashboard for managing AI agent governance — approvals, policies, audit, connections, and real-time monitoring.

## Stack

- React 19 with TypeScript
- Vite 6 (dev server and build)
- Tailwind CSS v4
- TanStack Query v5 (data fetching and caching)
- Clerk (authentication and org management)
- React Router (client-side routing)

## Pages

| Route | Page | Purpose |
|-------|------|---------|
| `/` | Command Center | Live overview: pending actions, cost tracking, agent activity, setup checklist |
| `/approvals` | Approvals | Pending approval queue with keyboard shortcuts (j/k/a/d), role enforcement |
| `/policies` | Policies | Priority-ordered rules, presets, category filters, AI optimization |
| `/audit` | Audit | Full activity log with search, risk/status filters, receipt verification, export |
| `/setup` | Gateway | Agent configuration, MCP server management, CLI quickstart |
| `/credentials` | Credentials | Connection management, scope boundaries, secret storage |
| `/sensors` | Sensors | Webhook sensor configuration and status |
| `/operations` | Operations | Event-driven operation queue with AI routing |
| `/insights` | Insights | Cost breakdowns, action volume, policy hit rates |
| `/notifications` | Notifications | Multi-channel notification settings (Telegram, Slack, WhatsApp, Email) |
| `/usage` | Usage | Contribution tracking by agent, user, tool, outcome, cost |

## Development

```bash
# From repo root
pnpm --filter @wooblay/ui dev

# Runs on http://localhost:5173
# Proxies API requests to Gate at http://localhost:4800
```

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `VITE_CLERK_PUBLISHABLE_KEY` | For auth | Clerk frontend publishable key |
| `VITE_API_URL` | No | Gate API base URL (empty = same origin) |

## Build

```bash
pnpm --filter @wooblay/ui build
# Output: apps/ui/dist/
```

The production build is embedded into the Gate Docker image and served as static files.
