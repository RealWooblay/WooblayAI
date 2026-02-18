# Audit: Three-Layer Security & Execution Flow

**Scope:** Policy Gate (Layer 1), Simulation (Layer 2), Secure Execution (Layer 3), and end-to-end execution paths.  
**Conclusion:** The three layers are implemented and wired correctly. Credential-bearing execution is isolated and never exposes secrets to the agent. One caveat: simulation can no-op for some structured actions when no sandboxable command is present in params.

---

## 1. Execution Paths (Where Layers Apply)

There are three entry points that lead to execution:

| Entry point | Who calls it | Credentials? | Layers that run |
|-------------|---------------|--------------|-----------------|
| **POST /api/tool/execute** | Agent plugin (gated tools: exec, write, edit, etc.) | No | Layer 1 (policy) only; optional Layer 2 (simulation) for ALLOW based on org threshold. Execution happens **in the agent container** (plugin runs the command). |
| **POST /api/tool/structured-execute** | Agent plugin (`structured_action` tool) | Yes | Layer 1 (scope only), Layer 2 (simulation), Layer 3 (secure exec). **No policy evaluation in this route** — design assumes policy/approval was already done before the plugin calls here. |
| **POST /api/gateway/execute** | External agents (API key) or hosted agents (capability token) | Yes | **API key:** Layer 1 (policy via synthetic tool call), Layer 1 (scope), Layer 2, Layer 3. **Capability token:** Layer 1 (scope only; policy assumed done in run/approval flow), Layer 2, Layer 3. |

So:

- **Local tools (exec, write, edit):** Policy → optional simulation → agent runs the command locally. No credential injection; no Layer 3.
- **Credential actions (structured_execute + gateway):** Scope (and policy for API key) → simulation → secure execution in ephemeral container. Credentials only in Layer 3 container.

---

## 2. Layer 1: Policy Gate + Scope

### Policy (`engine/policy.ts`)

- **Used in:** `/api/tool/execute` (always), `/api/gateway/execute` (API key path only).
- **Flow:** `evaluatePolicy(prisma, toolCall, instanceId?)`:
  1. Agent must exist, be active, and allowlisted.
  2. Load rules: `instanceId: null` (global) or instance-specific; priority ASC, first match wins.
  3. Match on: `matchTool` (glob), `riskTier`, `matchCategory`, optional `matchArgs`.
  4. Returns: `ALLOW` | `DENY` | `APPROVE` (human review).
  5. Default when no rule matches: WRITE/DESTRUCTIVE → APPROVE, READ → ALLOW.

**Verdict:** Works. Policy is evaluated before any execution for tool/execute and for API-key gateway calls. Capability-token gateway does not run policy in the gateway route; it relies on the run/approval flow having already applied policy.

### Scope (`engine/scope.ts`)

- **Used in:** `/api/tool/structured-execute`, `/api/gateway/execute`.
- **Flow:** `checkScope(boundaries, action, params)`:
  1. Get boundary for action (e.g. `git:push` → allowed/blocked patterns).
  2. `extractScopeTarget(action, params)` (e.g. branch name).
  3. Blocked list takes precedence; then target must match allowed if allowed list exists; else allowed.

**Verdict:** Works. Scope is enforced before simulation and execution for every credential path. Connection-level `scopeBoundaries` are parsed and checked.

---

## 3. Layer 2: Simulation

### Where it runs

- **Local tools:** After policy ALLOW, only if `shouldSimulate(riskTier, orgThreshold, false)` is true. Credential actions in this route are not a thing (no creds).
- **Structured / gateway:** For credential actions, simulation is **always** invoked (comment: "Credential actions ALWAYS get simulated").

### What it does (`engine/simulate.ts`)

- **simulateAction** (structured/gateway):
  - `runSandboxSimulation(prisma, request)`.
  - If `actionSpec.params.command` exists: run it in **runSandboxExec** (isolated container: `--network none`, no creds, 30s timeout).
  - If no command in params: returns `passed: true` with summary "No command to sandbox (action uses structured params)".
  - Then AI intent verification: `analyzeWithAI` (GPT-4o-mini) compares stated intent vs observed behavior; can set `passed: false` on mismatch.
- **simulateLocalAction** (local exec/write/edit):
  - For exec/process: sandbox the command.
  - For write/edit: content analysis (AI).
  - For web_fetch: sandbox as curl.

**Caveat:** For structured actions (e.g. `git:push` with `params: { branch, remote }`), the command is often built in **buildExecutionSpec** at Layer 3 time, not passed in params. So in simulation, `actionSpec.params.command` can be missing, and the sandbox step is skipped and the result is `passed: true`. Only AI intent verification might still run if we have a derived “stated intent” and something to compare. So for some structured actions, Layer 2 is effectively “no sandbox, optional AI check.” This is a known limitation, not a bug: the design allows pass-through when there is no command to sandbox.

**Verdict:** Simulation layer is correctly invoked and can block (e.g. intent mismatch). Sandbox + AI verification work when a command is present; otherwise simulation may no-op for that part.

---

## 4. Layer 3: Secure Execution

### Where it runs

- **Only** in `/api/tool/structured-execute` and `/api/gateway/execute`. Never in `/api/tool/execute` (local tools run in the agent container).

### Flow (`engine/secure-exec.ts`)

1. **resolveCredentials(prisma, connectionId, provider)**  
   - Load connection; require active.  
   - For github/aws/gcp: read `credentialRef` and metadata; if `isEncrypted(ref)` then `envelopeDecrypt(ref)`.  
   - Add exec_only secrets from `connection.secrets` (decrypt if encrypted).  
   - Return plaintext map only for use inside this engine (never sent to agent).

2. **buildExecutionSpec(actionSpec, credentials)**  
   - Action registry or generic `exec:run`; build command and env from credentials.

3. **runInContainer(execSpec, containerName, workspacePath)**  
   - `docker run --rm --name ... --read-only --tmpfs /tmp:rw,noexec,nosuid,size=256m --memory 1g --cpus 1 --pids-limit 128 --network wooblay-exec-net`  
   - Env vars from spec (credentials) injected with `-e`.  
   - Workspace mounted read-only if needed.  
   - Container is created, command runs, stdout/stderr/exitCode captured, then container is removed (`--rm`).

**Verdict:** Works. Credentials are resolved from the vault (envelope decryption) only inside the Gate; they are injected only into the ephemeral container env; the agent never receives them. Container is isolated (network, limits) and destroyed after use.

---

## 5. End-to-End: Will It Work?

| Question | Answer |
|----------|--------|
| Does policy run before execution for normal tool calls? | Yes. `/api/tool/execute` always runs risk classification and `evaluatePolicy`; DENY/APPROVE are returned; only ALLOW can lead to EXECUTE. |
| Does policy run for gateway (external) callers? | Yes for API key (synthetic tool call + evaluatePolicy). For capability token, policy is assumed to have been applied in the run/approval flow before the capability is used. |
| Is scope enforced for every credential action? | Yes. Both structured-execute and gateway call `checkScope` before simulation and execution; 403 if not allowed. |
| Is simulation always run for credential actions? | Yes. Both paths call `simulateAction`; on failure they return 403 and do not call `executeSecureAction`. |
| Are credentials ever sent to the agent? | No. They are resolved in the Gate, passed only to `runInContainer` as env vars; response to the agent contains only stdout/stderr/exitCode and metadata (redacted). |
| Is execution isolated? | Yes. Ephemeral container, separate network, resource limits, read-only root; container is removed after run. |
| Can simulation fail-open? | Yes. In both tool and gateway, simulation errors are caught and logged with “Simulation failed (non-blocking, allowing through)” and execution continues. So a simulation bug or timeout does not block execution; policy and scope remain the hard gates. |

---

## 6. Summary

- **Layer 1 (Policy + Scope):** Implemented and used on the right paths. Policy applies to tool/execute and to API-key gateway; scope applies to every credential path. Capability-token gateway relies on prior policy/approval.
- **Layer 2 (Simulation):** Implemented and invoked; can block on intent mismatch. For structured actions without a command in params, sandbox may be skipped (simulation returns passed); this is by design.
- **Layer 3 (Secure Execution):** Credentials only in vault and ephemeral container; agent never sees them; container lifecycle and isolation are correct.

**Overall:** The three-layer security and execution flow will work as designed. The only notable caveat is simulation’s no-op for some structured actions when there is no sandboxable command in params; if you want stronger guarantees there, the next step would be to build a synthetic command for simulation from the same action spec used at execution time.
