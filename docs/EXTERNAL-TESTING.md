# Wooblay — External testing checklist

Use this list to test the app end-to-end or hand to friends. Tick off as you go.

---

## 1. Auth & onboarding

- [ ] Sign up (email or OAuth)
- [ ] Sign out and sign back in
- [ ] Session persists after refresh

---

## 2. Dashboard (home)

- [ ] See list of agent instances (or empty state)
- [ ] Sidebar: **Operations**, **Connections**
- [ ] **Deploy new agent**: open deploy form, fill name + model + API key, deploy
- [ ] New agent appears in list with correct name/status
- [ ] **Start** a stopped agent → status goes running
- [ ] **Stop** a running agent → status goes offline
- [ ] **Restart**: confirm warning “memory lost” appears; restart works
- [ ] **Config** (inline): change model/API key/telegram; see “requires restart” warning when relevant; save works
- [ ] **Logs**: open inline logs, see container output
- [ ] **Trust bar** and cost/actions show when agent is running
- [ ] Click instance name/card → goes to instance detail

---

## 3. Instance detail — Overview

- [ ] Mission/status and current action (or “Idle”)
- [ ] Sub-agents section (if any) shows correctly
- [ ] Anomaly alerts (if any) with link to activity
- [ ] Tabs: Overview, Profile, Access, Workspace

---

## 4. Instance detail — Profile

- [ ] **Quick edit**: Role + Goal fields; “Save profile” updates DB and writes SOUL.md + IDENTITY.md (no restart)
- [ ] Open “SOUL.md + IDENTITY.md (live from container)”: both files load
- [ ] Role/Goal in quick edit pre-fill from live SOUL.md when available
- [ ] Edit SOUL.md raw → Save → content persists
- [ ] Edit IDENTITY.md raw → Save → content persists
- [ ] Warning visible: “Save profile overwrites… To keep agent-evolved content, edit the files below.”

---

## 5. Instance detail — Access

- [ ] **Risk warning** visible: “Direct Access — Bypasses Tool Gateway” with link to Sensors page
- [ ] **GitHub**: expand, paste token, Save → shows “configured”
- [ ] **AWS**: expand, add key/secret/region, Save → shows “configured”
- [ ] **GCP**: expand, upload JSON or paste key + project ID, Save → shows “configured”
- [ ] Changing credentials doesn’t require restart (hot-inject)

---

## 6. Instance detail — Workspace

- [ ] Default path is `/root/.openclaw/workspace` (or equivalent)
- [ ] Directory listing loads (files/folders)
- [ ] **~** (home) goes to `/root`
- [ ] Click folder → navigates into it; breadcrumbs work
- [ ] Click file → content loads (or download)
- [ ] **Download** file → file downloads
- [ ] **Live** checkbox: off = no auto-refresh; on = list refetches every 5s
- [ ] With agent running and writing files, turn Live on and see new files appear

---

## 7. Activity

- [ ] Chain integrity banner (verified / issues)
- [ ] Session summary (counts, AI flags)
- [ ] **Anomaly flags**: if any, “Dismiss” single flag works
- [ ] **Dismiss all** clears all active flags
- [ ] **Show dismissed**: toggles list of dismissed flags; left/right arrows and page numbers work
- [ ] Filters: date range, risk, status
- [ ] Action log: expand row for details (tool, risk, receipt)
- [ ] Pagination (prev/next) when > 30 items
- [ ] Export JSON / Export CSV

---

## 8. Policies

- [ ] Select an agent from dropdown
- [ ] **No rules**: empty state says “monitor-only mode”, AI detection still runs
- [ ] **Presets**: click preset → confirm replace → rules apply
- [ ] **AI Security Supervisor**: Enable → analysis runs; summary and suggestions appear
- [ ] **Suggestions**: Apply single suggestion → suggestion disappears from list
- [ ] **Duplicate**: try applying same suggestion again (or already-existing rule) → prevented or marked “already exists”
- [ ] **Apply all** applies non-duplicate suggestions; count/skipped message
- [ ] **Dismiss all** clears suggestion list
- [ ] **Add rules with AI**: type prompt, Create → rules created (if AI responds)
- [ ] Advanced: expand, see all rules; toggle enable/disable; delete rule

---

## 9. Operations & Sensors (sensor-first)

- [ ] **Operations** (`/operations`): list shows routing status (auto_routed / pending / unassigned); inline Approve / Assign / Dismiss
- [ ] **Operation detail** (`/operations/:id`): routing section (assigned agent, confidence, AI reason), runs list, create run
- [ ] **Connections** (`/connections`): dual-role cards (sensing + execution); webhook URL and secret (copy); sensor config; scope boundaries; available actions
- [ ] Create manual operation from UI; optional: trigger GitHub webhook to `/api/webhooks/github/:connectionId` and see operation appear with correct org

## 10. Approvals (if you use gated actions)

- [ ] Pending actions appear (e.g. on dashboard or Approvals page)
- [ ] Approve / deny works and updates activity

---

## 11. Edge cases & errors

- [ ] Open Workspace with agent **stopped** → clear message (e.g. “agent not running” or empty)
- [ ] Open Profile with agent stopped → message that profile needs agent running
- [ ] Invalid API key or config → error message (no silent fail)
- [ ] 404 on a missing instance → handled (redirect or error message)
- [ ] Long names/roles truncate nicely (no layout break)

---

## 12. Cross-browser / device (optional)

- [ ] Chrome/Edge
- [ ] Safari (if available)
- [ ] Mobile: layout usable, key flows work

---

## Quick handoff

1. Share app URL (e.g. `https://wooblay.com`) and this doc.
2. Sign up and go through sections 1–2 (auth + one deploy).
3. Then 3–6 (instance detail: overview, profile, access, workspace).
4. Then 7–9 (activity, policies, operations & sensors) if they have time.
5. Note anything broken, unclear, or slow — and which section.

---

*Last updated: Feb 2026*
