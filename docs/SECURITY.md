# Wooblay Security Model

This document describes the security architecture, threat model, and guarantees provided by Wooblay's execution firewall for AI agents.

---

## Security Architecture Overview

Wooblay enforces a zero-trust model for AI agent execution. No agent process — hosted or external — has access to credentials, can bypass policy evaluation, or can approve its own actions.

```
Agent Process                    Wooblay Gate                     External System
(zero credentials)               (policy + vault)                 (Stripe, GitHub, etc.)
      │                               │                                │
      │  1. Request action             │                                │
      │──────────────────────────────►│                                │
      │                               │  2. Classify risk              │
      │                               │  3. Evaluate policy            │
      │                               │  4. Hold for approval (if needed)
      │                               │  5. Decrypt credential         │
      │                               │  6. Spawn ephemeral container  │
      │                               │──────────────────────────────►│
      │                               │  7. Execute action             │
      │                               │◄──────────────────────────────│
      │                               │  8. Destroy container          │
      │                               │  9. Sign receipt               │
      │  10. Return result             │                                │
      │◄──────────────────────────────│                                │
```

---

## Threat Model

### Threats Mitigated

| Threat | Mitigation |
|--------|-----------|
| **Credential exfiltration** | Credentials never enter the agent process. Envelope encryption at rest; decryption only into ephemeral containers with `--rm --read-only` and isolated networking. |
| **Unauthorized actions** | Every tool call passes through L1 policy evaluation before execution. No bypass path exists. |
| **Agent self-approval** | Approval/deny capabilities are removed from the agent-facing API. Approvals are human-only, delivered through authenticated channels (dashboard, Telegram, Slack, WhatsApp, Email). |
| **Agent-to-agent collusion** | Sub-agents cannot approve actions on behalf of the parent agent. The approval API requires Clerk JWT (dashboard) or cryptographically signed action tokens (notifications). |
| **Race conditions in approvals** | Atomic resolution via `UPDATE WHERE status = PENDING`. A second concurrent approval attempt returns false — only one decision is recorded. |
| **Link preview bot triggers** | Notification action links render an HTML confirmation page on GET. The actual decision requires a POST with the token in the request body. |
| **Privilege escalation via approvals** | Policies can require a specific org role (e.g., `cto`, `security-lead`). The approver's Clerk org membership is verified before accepting the decision. `admin` and `owner` roles bypass role checks. |
| **Receipt tampering** | Every receipt is ed25519-signed and SHA-256 hash-chained. Modifying any receipt breaks the chain. Independent verification via `GET /api/audit/chain-integrity`. |
| **Replay attacks** | Notification action tokens are single-use and time-limited. Gateway API uses idempotency hashing (SHA-256 of caller + action + params, 24h cache). |
| **Prompt injection bypass** | Wooblay operates at the execution layer, not the prompt layer. The policy engine evaluates the actual tool call and arguments, not the agent's stated intent. |
| **Credential leakage via logs** | Redaction patterns strip known secret formats from all log output. Vault plaintext exists only inside ephemeral containers. |
| **Container escape** | Ephemeral containers run with `--read-only`, `--pids-limit 128`, `--memory 1g`, `--cpus 1`, isolated Docker network, `noexec` tmpfs. No Docker socket access. |

### Threats Acknowledged (Out of Scope)

| Threat | Notes |
|--------|-------|
| **Compromised Gate server** | If the Gate process is compromised, the attacker has access to the vault master key in memory. Mitigation: run Gate on hardened infrastructure, restrict SSH access, use AWS KMS for KEK in production. |
| **Insider threat (Wooblay operator)** | A Wooblay operator with database access could read encrypted credentials (but not decrypt without KEK). Mitigation: KMS-backed KEK with CloudTrail auditing in production. |
| **DDoS against Gate** | Rate limiting is in-memory per-instance. High-volume attacks could exhaust resources. Mitigation: ALB rate limiting, WAF rules, horizontal scaling. |
| **LLM API compromise** | If the OpenAI API key is compromised, the attacker could influence risk classification. Mitigation: AI can only raise risk tier, never lower it. Structural regex analysis is the baseline. |

---

## Credential Security

### Encryption at Rest

All credentials are encrypted using envelope encryption:

1. **Data Encryption Key (DEK)** — random 32-byte key generated per secret
2. **Encryption** — AES-256-GCM with 12-byte nonce
3. **Key Encryption Key (KEK)** — wraps the DEK
   - Production: AWS KMS (CloudTrail audited)
   - Development: derived from `VAULT_MASTER_KEY` environment variable

**Storage format:** `enc:v1:<keyId>:<dekNonce>:<wrappedDek>:<dataNonce>:<ciphertext>`

### Credential Lifecycle

```
Store:  plaintext → AES-256-GCM encrypt with DEK → wrap DEK with KEK → store ciphertext
Use:    load ciphertext → unwrap DEK with KEK → decrypt with DEK → inject into ephemeral container env
After:  container destroyed → plaintext gone → no residual
```

Credentials exist in plaintext only:
1. Briefly in Gate process memory during decryption
2. As environment variables inside the ephemeral container (destroyed after execution)

### Secret Classes

| Class | Visibility | Storage | Use Case |
|-------|-----------|---------|----------|
| **Exec-only** | Agent cannot access | Vault → ephemeral container only | GitHub PAT, AWS keys, Stripe secret key, database passwords |
| **Agent env var** | Agent can access | Injected into agent container | LLM API keys (Anthropic, OpenAI) |

---

## Approval Security

### Human-Only Enforcement

Agent-facing APIs (MCP proxy, Gateway) have no approve/deny endpoints. The approval/denial of pending actions can only be performed through:

1. **Dashboard UI** — authenticated via Clerk JWT with org membership verification
2. **Notification action links** — authenticated via cryptographically signed, single-use tokens scoped to a specific approver and approval request

### Atomic Resolution

Approval state transitions use database-level atomicity:

```sql
UPDATE approvals SET status = $1, approver = $2, decided_at = NOW()
WHERE id = $3 AND status = 'PENDING'
```

If two approvers click simultaneously, only one succeeds. The second receives a "already resolved" response. No double-execution is possible.

### Role-Based Enforcement

Policy rules can specify `requiredApproverRole`. When set:

1. The role is copied from the policy rule to the `Approval` record at creation time
2. When an approver acts, their Clerk org role is retrieved and normalized (strip `org:` prefix)
3. The approver's role must match the required role, OR be `admin` or `owner`
4. Mismatched roles receive a 403 response with a clear message

### Notification Security

| Property | Implementation |
|----------|---------------|
| Token generation | `crypto.randomBytes(32).toString('hex')` — 256 bits of entropy |
| Token scope | Bound to specific approval ID + approver user ID |
| Token storage | Hashed in database, never stored in plaintext |
| Expiration | Configurable TTL (default: 1 hour) |
| Single use | Token is invalidated after first successful use |
| Bot protection | GET renders confirmation page; POST performs action |
| Channel security | Telegram (bot API), Slack (incoming webhooks over HTTPS), WhatsApp (Business API over HTTPS), Email (SMTP/TLS) |

---

## Receipt Chain Integrity

### Cryptographic Properties

| Property | Algorithm | Purpose |
|----------|-----------|---------|
| Signature | ed25519 | Proves the Gate server produced this receipt |
| Hash | SHA-256 | Content-addressable receipt ID |
| Serialization | RFC 8785 (canonical JSON) | Deterministic byte representation for reproducible hashes |
| Chain | `chainPrev` field | Links each receipt to the previous, creating tamper-evident chain |

### Verification

Any party can verify the chain without trusting the server:

1. Fetch the full receipt chain
2. For each receipt: serialize to canonical JSON, compute SHA-256, verify it matches the receipt ID
3. Verify ed25519 signature using the server's public key
4. Verify `chainPrev` of receipt N equals the hash of receipt N-1

**Built-in verification:** `GET /api/audit/chain-integrity` runs this check and returns `{ valid: boolean, total: number, brokenAt?: number }`.

---

## Network Security

### Container Isolation

```
Docker Networks:
  gate_net (172.20.0.0/24)      — Gate ↔ PostgreSQL only
  agent_net (172.21.0.0/24)     — Gate ↔ agent containers
  wooblay-exec-net              — ephemeral execution containers (isolated)
```

| Component | Can reach | Cannot reach |
|-----------|----------|-------------|
| Agent container | Gate API, external internet (LLM APIs) | PostgreSQL, other agents, ephemeral containers, Docker socket |
| Ephemeral container | Target external system only | Agent, Gate, PostgreSQL, other containers, Docker socket |
| Gate | PostgreSQL, all containers, Docker socket | — |

### Ephemeral Container Hardening

Every credential-bearing action runs in a container with:

| Flag | Purpose |
|------|---------|
| `--rm` | Auto-destroy after exit |
| `--read-only` | Immutable filesystem |
| `--network wooblay-exec-net` | Isolated network segment |
| `--memory 1g` | Memory ceiling |
| `--cpus 1` | CPU ceiling |
| `--pids-limit 128` | Fork bomb prevention |
| `--tmpfs /tmp:rw,noexec,nosuid,size=256m` | Writable temp with no exec |

---

## Authentication

### Dashboard (Human Users)

- **Method:** Clerk JWT with org membership
- **Session:** Short-lived JWTs, refresh via Clerk
- **Multi-tenancy:** All queries automatically scoped to the user's active organization
- **Roles:** Clerk org roles (`admin`, `owner`, `member`, custom) used for approval routing

### Agent-to-Gate (MCP Proxy, Gateway)

- **Method:** API key (`wbl_ak_...`) or ed25519 signed request
- **Scoping:** API keys are org-scoped; actions are attributed to the key's creator
- **Rotation:** Keys can be revoked from the dashboard; new keys issued instantly

### Notification Actions

- **Method:** Cryptographically signed action tokens (256-bit entropy)
- **Scoping:** Token bound to specific approval + approver
- **Lifetime:** Single-use, time-limited

---

## Compliance Posture

Wooblay's architecture is designed to support the following compliance frameworks. Formal certifications are on the roadmap.

| Framework | Relevant Capabilities |
|-----------|----------------------|
| **SOC 2 Type II** | Cryptographic audit trail, role-based access control, encryption at rest and in transit, change management via receipt chain |
| **HIPAA** | Credential isolation (PHI access via exec-only secrets), audit logging, access controls, encryption |
| **GDPR** | Data processing records via receipt chain, org-scoped data isolation, right to audit |
| **NIST AI RMF** | Pre-execution risk assessment, human oversight, documented decisions, anomaly detection |
| **EU AI Act** | Human-in-the-loop for high-risk actions, risk classification, audit trail, transparency |

---

## Responsible Disclosure

If you discover a security vulnerability, please email **security@wooblay.com**. We will acknowledge receipt within 24 hours and provide a timeline for remediation.

Do not disclose vulnerabilities publicly until a fix is available.
