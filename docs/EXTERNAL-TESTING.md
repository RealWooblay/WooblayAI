# Wooblay — External testing checklist

Use this list to test the app end-to-end or hand to testers. Tick off as you go.

**Platform modes:** Wooblay has two modes. **Firewall** (default): CONNECT (Gateway, Credentials, Sensors), SECURE, MONITOR — no hosted agents, no Operations/Insights. **Full Platform**: adds AGENTS (dashboard) and PLATFORM (Operations, Insights). Unlock Full Platform via Settings > Platform Mode with the password from Wooblay.

---

## 1. Auth & onboarding

- [ ] Sign up (email or OAuth)
- [ ] Sign out and sign back in
- [ ] Session persists after refresh
- [ ] If onboarding is enabled: complete coupon/activation step to reach the app

---

## 2. Sidebar & navigation

- [ ] **Firewall mode:** Sidebar shows CONNECT (Gateway, Credentials, Sensors), SECURE (Policies, Approvals), MONITOR (Activity, Notifications). No AGENTS or PLATFORM section.
- [ ] **Full Platform mode:** Sidebar shows AGENTS, then CONNECT, SECURE, MONITOR, PLATFORM (Operations, Insights).
- [ ] Organization switcher at top (Clerk) — switch org if you have multiple.
- [ ] Tutorial and Settings links at bottom work.
- [ ] Unknown URL redirects to `/operations` (or dashboard in firewall if operations hidden — check behavior).

---

## 3. Gateway & API keys (external agents)

- [ ] Go to **CONNECT > Gateway** (route `/setup`).
- [ ] Page title: Setup; copy mentions credentials and policies.
- [ ] **Create API key:** Name + optional expiry (days) → Create key. Key shown once — copy it.
- [ ] Key appears in list with prefix; **Revoke** works.
- [ ] Integration modes (GPT, Claude, MCP, Custom) show correct instructions and URLs.
- [ ] **Test execute** (optional): `curl -X POST <API_BASE>/api/gateway/execute -H "Authorization: Bearer <key>" -H "Content-Type: application/json" -d '{"action":"test","params":{}}'` — expect 4xx/5xx with a clear error (e.g. connection/scope), not 401 if key is valid.
- [ ] **Capabilities** (optional): `curl <API_BASE>/api/gateway/capabilities -H "Authorization: Bearer <key>"` — returns JSON (e.g. connected providers).

---

## 4. Credentials & Sensors

- [ ] **Credentials** (`/credentials`): List of credentials (execution-only or sensing). Add credential: name, type (e.g. GitHub), paste token/keys — Save. Shows Active/Inactive. No “Sensing” badge when adding execution-only credential.
- [ ] **Sensors** (`/sensors`): Copy says to add a credential first. Webhook URL and secret per connection; sensor config; scope boundaries; available actions.
- [ ] Create manual operation from UI; optionally trigger GitHub webhook to `/api/webhooks/github/:connectionId` and see operation appear (Full Platform).

---

## 5. Dashboard — Agents (Full Platform only)

- [ ] Home (`/`) shows list of agent instances or empty state.
- [ ] **Deploy new agent:** open deploy form, fill name + model + API key, deploy.
- [ ] New agent appears with correct name/status.
- [ ] **Start** stopped agent → status running; **Stop** running → offline.
- [ ] **Restart:** warning about memory (or that state is preserved); restart works.
- [ ] **Config** (inline): change model/API key/Telegram; “requires restart” when relevant; save works.
- [ ] **Logs:** open inline logs, see container output.
- [ ] Trust bar and cost/actions show when agent is running.
- [ ] Click instance name/card → instance detail.

---

## 6. Instance detail — Overview

- [ ] Mission/status and current action (or “Idle”).
- [ ] Sub-agents section (if any) correct.
- [ ] Anomaly alerts (if any) with link to activity.
- [ ] Tabs: **Overview**, **Profile**, **Security**, **Workspace**.

---

## 7. Instance detail — Profile

- [ ] **Quick edit:** Role + Goal; “Save profile” updates DB and writes SOUL.md + IDENTITY.md (no restart).
- [ ] “SOUL.md + IDENTITY.md (live from container)”: both files load.
- [ ] Role/Goal pre-fill from live SOUL.md when available.
- [ ] Edit SOUL.md / IDENTITY.md raw → Save → content persists.
- [ ] Warning: “Save profile overwrites… To keep agent-evolved content, edit the files below.”

---

## 8. Instance detail — Security (Access)

- [ ] **Risk warning** visible: “Direct Access — Bypasses Tool Gateway” with link to Sensors.
- [ ] **GitHub:** expand, paste token, Save → shows “configured”.
- [ ] **AWS / GCP:** add keys, Save → shows “configured”.
- [ ] Changing credentials doesn’t require restart (hot-inject).

---

## 9. Instance detail — Workspace

- [ ] Default path `/root/.openclaw/workspace` (or equivalent); directory listing loads.
- [ ] **~** (home) goes to `/root`; click folder → navigate; breadcrumbs work.
- [ ] Click file → content loads or download.
- [ ] **Download** file works.
- [ ] **Live** checkbox: off = no auto-refresh; on = refetch every 5s. With agent writing files, see new files appear.

---

## 10. Activity

- [ ] Chain integrity banner (verified / issues).
- [ ] Session summary (counts, AI flags).
- [ ] **Anomaly flags:** Dismiss single; **Dismiss all** clears active.
- [ ] **Show dismissed:** toggles list; pagination/arrows work.
- [ ] Filters: date range, risk, status.
- [ ] Action log: expand row for details (tool, risk, receipt).
- [ ] Pagination when > 30 items.
- [ ] Export JSON / Export CSV.

---

## 11. Policies

- [ ] **Global only:** No agent dropdown. Header shows “X rules — apply to all agents in this org”.
- [ ] **No rules:** empty state says monitor-only mode; AI detection still runs.
- [ ] **Presets:** click preset → confirm replace → rules apply.
- [ ] **AI Security Supervisor:** Enable → analysis runs; summary and suggestions appear.
- [ ] **Suggestions:** Apply single → suggestion disappears; **Apply all** / **Dismiss all** behave correctly.
- [ ] **Duplicate:** applying same suggestion again (or existing rule) prevented or marked “already exists”.
- [ ] **Add rules with AI:** prompt → Create → rules created if AI responds.
- [ ] Advanced: expand, see all rules; toggle enable/disable; delete rule.

---

## 12. Operations & Approvals (Full Platform)

- [ ] **Operations** (`/operations`): list shows routing status (auto_routed / pending / unassigned); inline Approve / Assign / Dismiss.
- [ ] **Operation detail** (`/operations/:id`): routing, runs list, create run.
- [ ] **Approvals:** pending actions appear; Approve / Deny updates activity.

---

## 13. Settings

- [ ] **Profile:** name, email shown.
- [ ] **Account:** Plan (e.g. Beta Access), member since.
- [ ] **Appearance:** Dark / Light / System — switch and see UI update; preference persists.
- [ ] **Platform Mode:** Firewall vs Full Platform; unlock with password when gated.
- [ ] **Session:** Sign out works.
- [ ] Organization is **not** in Settings (only in sidebar org switcher).

---

## 14. Edge cases & errors

- [ ] Workspace with agent **stopped** → clear message (e.g. “agent not running” or empty).
- [ ] Profile with agent stopped → message that profile needs agent running.
- [ ] Invalid API key or config → error message (no silent fail).
- [ ] 404 / missing instance → handled (redirect or error message).
- [ ] Long names/roles truncate (no layout break).
- [ ] Simulation timeout/failure: gateway and tool routes **block** execution (503 or DENY), not allow-through.

---

## 15. Cross-browser / device (optional)

- [ ] Chrome/Edge
- [ ] Safari (if available)
- [ ] Mobile: layout usable, key flows work

---

## Quick handoff

1. Share app URL (e.g. `https://wooblay.com`) and this doc.
2. Sign up and complete onboarding if required.
3. **Firewall:** Gateway (create API key), Credentials, Sensors, Policies, Activity.
4. **Full Platform:** Add Agents (deploy one), instance detail (Overview, Profile, Security, Workspace), Operations, Approvals.
5. Note anything broken, unclear, or slow — and which section.

---

*Last updated: Feb 2026*
