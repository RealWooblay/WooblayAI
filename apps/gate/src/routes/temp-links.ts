/**
 * Temporary signed link routes.
 *
 * Agents generate short-lived signed URLs that render read-only views
 * (audit tables, policy overviews, error logs). The token IS the auth —
 * no login required. Links expire after 30 minutes.
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { randomUUID } from 'crypto';
import { prisma } from '../db/client.js';
import { config } from '../config.js';
import { resolveOrgIdForRequest } from '../middleware/org-resolve.js';

const LINK_TTL_MS = 30 * 60 * 1000; // 30 minutes

const VALID_TYPES = ['audit', 'policies', 'errors', 'contributions'] as const;
type LinkType = (typeof VALID_TYPES)[number];

export async function tempLinkRoutes(app: FastifyInstance): Promise<void> {
  /**
   * POST /api/temp-links — Create a signed temporary link.
   *
   * Auth: API key (wbl_ak_) or Clerk JWT (dual-auth middleware handles this).
   * Body: { type: 'audit' | 'policies' | 'errors' | 'contributions', filters?: Record<string, string> }
   */
  app.post('/api/temp-links', async (request: FastifyRequest, reply: FastifyReply) => {
    const body = request.body as {
      type?: string;
      filters?: Record<string, string>;
    } | null;

    if (!body?.type || !VALID_TYPES.includes(body.type as LinkType)) {
      return reply.code(400).send({
        error: `type is required and must be one of: ${VALID_TYPES.join(', ')}`,
      });
    }

    const orgId = await resolveOrgIdForRequest(prisma, request);
    if (!orgId) {
      return reply.code(401).send({ error: 'Could not resolve organization. Authenticate first.' });
    }

    try {
      const token = randomUUID();
      const expiresAt = new Date(Date.now() + LINK_TTL_MS);

      await prisma.tempLink.create({
        data: {
          token,
          orgId,
          type: body.type,
          filters: body.filters ? JSON.stringify(body.filters) : null,
          expiresAt,
        },
      });

      const gateBase = process.env.GATE_PUBLIC_URL ?? process.env.WOOBLAY_GATE_URL ?? `http://localhost:${config.PORT}`;

      return reply.code(201).send({
        url: `${gateBase}/view/${token}`,
        expiresAt: expiresAt.toISOString(),
      });
    } catch (err) {
      request.log.error(err, 'Failed to create temp link');
      return reply.code(500).send({ error: 'Internal server error' });
    }
  });

  /**
   * GET /view/:token — Render the temporary view.
   *
   * NO auth required — the token IS the auth.
   */
  app.get('/view/:token', async (request: FastifyRequest, reply: FastifyReply) => {
    const { token } = request.params as { token: string };

    try {
      const link = await prisma.tempLink.findUnique({ where: { token } });

      if (!link || link.expiresAt < new Date()) {
        return reply
          .code(410)
          .type('text/html')
          .send(renderExpiredPage());
      }

      const filters: Record<string, string> = link.filters ? JSON.parse(link.filters) : {};
      const html = await renderView(link.type as LinkType, link.orgId, filters, link.expiresAt);

      return reply.type('text/html').send(html);
    } catch (err) {
      request.log.error(err, 'Failed to render temp link view');
      return reply.code(500).type('text/html').send(renderErrorPage());
    }
  });
}

// ── HTML Rendering ────────────────────────────────────────────────────────

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function wrapPage(title: string, tableHtml: string, expiresAt: Date): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(title)} — Wooblay</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
      background: #0a0a0f;
      color: #e0e0e8;
      min-height: 100vh;
      padding: 2rem;
    }
    header {
      display: flex;
      align-items: center;
      gap: 0.75rem;
      margin-bottom: 1.5rem;
      padding-bottom: 1rem;
      border-bottom: 1px solid #1e1e2e;
    }
    header .logo {
      width: 28px;
      height: 28px;
      background: linear-gradient(135deg, #6366f1, #8b5cf6);
      border-radius: 6px;
    }
    header h1 {
      font-size: 1.25rem;
      font-weight: 600;
      color: #f0f0f8;
    }
    header .badge {
      margin-left: auto;
      font-size: 0.75rem;
      padding: 0.25rem 0.75rem;
      background: #1a1a2e;
      border: 1px solid #2a2a3e;
      border-radius: 999px;
      color: #a0a0b8;
    }
    .count {
      font-size: 0.875rem;
      color: #8888a0;
      margin-bottom: 1rem;
    }
    .table-wrap {
      overflow-x: auto;
      border: 1px solid #1e1e2e;
      border-radius: 8px;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      font-size: 0.8125rem;
    }
    th {
      text-align: left;
      padding: 0.625rem 0.75rem;
      background: #12121e;
      color: #9090a8;
      font-weight: 500;
      text-transform: uppercase;
      font-size: 0.6875rem;
      letter-spacing: 0.05em;
      border-bottom: 1px solid #1e1e2e;
      white-space: nowrap;
    }
    td {
      padding: 0.5rem 0.75rem;
      border-bottom: 1px solid #14141e;
      color: #c8c8d8;
      max-width: 320px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    tr:hover td { background: #0e0e1a; }
    .pill {
      display: inline-block;
      padding: 0.125rem 0.5rem;
      border-radius: 999px;
      font-size: 0.6875rem;
      font-weight: 500;
    }
    .pill-allow  { background: #0d3320; color: #4ade80; }
    .pill-deny   { background: #3b1111; color: #f87171; }
    .pill-approve { background: #2a2006; color: #fbbf24; }
    .pill-critical { background: #3b1111; color: #f87171; }
    .pill-high   { background: #3b2211; color: #fb923c; }
    .pill-medium { background: #2a2006; color: #fbbf24; }
    .pill-low    { background: #0d3320; color: #4ade80; }
    footer {
      margin-top: 1.5rem;
      padding-top: 1rem;
      border-top: 1px solid #1e1e2e;
      font-size: 0.75rem;
      color: #5a5a72;
      display: flex;
      justify-content: space-between;
    }
    .empty {
      text-align: center;
      padding: 3rem;
      color: #5a5a72;
      font-size: 0.875rem;
    }
  </style>
</head>
<body>
  <header>
    <div class="logo"></div>
    <h1>${escapeHtml(title)}</h1>
    <span class="badge">read-only view</span>
  </header>
  ${tableHtml}
  <footer>
    <span>Wooblay Gate — Temporary View</span>
    <span>Expires: ${expiresAt.toISOString().replace('T', ' ').slice(0, 19)} UTC</span>
  </footer>
</body>
</html>`;
}

function renderExpiredPage(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Link Expired — Wooblay</title>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      background: #0a0a0f;
      color: #e0e0e8;
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      flex-direction: column;
      gap: 1rem;
    }
    h1 { font-size: 1.5rem; color: #f87171; }
    p { color: #8888a0; font-size: 0.9375rem; }
  </style>
</head>
<body>
  <h1>410 — Link Expired</h1>
  <p>This temporary view link has expired or is invalid. Request a new one from your agent.</p>
</body>
</html>`;
}

function renderErrorPage(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>Error — Wooblay</title>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      background: #0a0a0f; color: #e0e0e8;
      min-height: 100vh; display: flex; align-items: center; justify-content: center; flex-direction: column; gap: 1rem;
    }
    h1 { font-size: 1.5rem; color: #fbbf24; }
    p { color: #8888a0; }
  </style>
</head>
<body>
  <h1>Something went wrong</h1>
  <p>Failed to render this view. Please try again or request a new link.</p>
</body>
</html>`;
}

function decisionPill(decision: string): string {
  const d = decision.toUpperCase();
  const cls = d === 'ALLOW' ? 'pill-allow' : d === 'DENY' ? 'pill-deny' : 'pill-approve';
  return `<span class="pill ${cls}">${escapeHtml(d)}</span>`;
}

function riskPill(risk: string): string {
  const r = risk.toLowerCase();
  const cls = r === 'critical' ? 'pill-critical' : r === 'high' ? 'pill-high' : r === 'medium' ? 'pill-medium' : 'pill-low';
  return `<span class="pill ${cls}">${escapeHtml(risk)}</span>`;
}

// ── Data Fetchers + View Renderers ────────────────────────────────────────

async function renderView(type: LinkType, orgId: string, filters: Record<string, string>, expiresAt: Date): Promise<string> {
  switch (type) {
    case 'audit':
      return renderAuditView(orgId, filters, expiresAt);
    case 'policies':
      return renderPoliciesView(orgId, filters, expiresAt);
    case 'errors':
      return renderErrorsView(orgId, filters, expiresAt);
    case 'contributions':
      return renderContributionsView(orgId, filters, expiresAt);
  }
}

async function renderAuditView(orgId: string, filters: Record<string, string>, expiresAt: Date): Promise<string> {
  const from = filters.from ? new Date(filters.from) : new Date(Date.now() - 24 * 60 * 60 * 1000);
  const to = filters.to ? new Date(filters.to) : new Date();
  const limit = Math.min(Number(filters.limit) || 200, 500);

  const orgKeys = await prisma.apiKey.findMany({ where: { orgId, revokedAt: null }, select: { id: true } });
  const orgPubkeys = orgKeys.map((k) => `apikey:${k.id}`);

  const receipts = await prisma.receipt.findMany({
    where: {
      createdAt: { gte: from, lte: to },
      ...(orgPubkeys.length > 0 ? { agentPubkey: { in: orgPubkeys } } : {}),
    },
    orderBy: { createdAt: 'desc' },
    take: limit,
    include: {
      toolCall: {
        include: { approval: true },
      },
    },
  });

  if (receipts.length === 0) {
    return wrapPage('Audit Trail', '<div class="empty">No audit entries found for this period.</div>', expiresAt);
  }

  const rows = receipts.map((r) => `
    <tr>
      <td>${escapeHtml(r.createdAt.toISOString().replace('T', ' ').slice(0, 19))}</td>
      <td>${escapeHtml(r.toolName)}</td>
      <td>${escapeHtml(r.agentPubkey.slice(0, 12))}…</td>
      <td>${decisionPill(r.policyDecision)}</td>
      <td>${riskPill(r.riskTier)}</td>
    </tr>`).join('');

  const tableHtml = `
    <p class="count">${receipts.length} entries</p>
    <div class="table-wrap">
      <table>
        <thead><tr>
          <th>Timestamp</th>
          <th>Tool</th>
          <th>Agent</th>
          <th>Decision</th>
          <th>Risk Tier</th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;

  return wrapPage('Audit Trail', tableHtml, expiresAt);
}

async function renderPoliciesView(orgId: string, filters: Record<string, string>, expiresAt: Date): Promise<string> {
  const instanceId = filters.instanceId ?? null;

  const rules = await prisma.policyRule.findMany({
    where: {
      orgId,
      ...(instanceId ? { instanceId } : {}),
      enabled: true,
    },
    orderBy: { priority: 'asc' },
  });

  if (rules.length === 0) {
    return wrapPage('Policy Rules', '<div class="empty">No active policy rules found.</div>', expiresAt);
  }

  const rows = rules.map((r) => `
    <tr>
      <td>${escapeHtml(r.matchTool)}</td>
      <td>${riskPill(r.riskTier)}</td>
      <td>${escapeHtml(r.matchCategory ?? '—')}</td>
      <td>${decisionPill(r.decision)}</td>
      <td>${escapeHtml(r.matchArgs ?? '—')}</td>
    </tr>`).join('');

  const tableHtml = `
    <p class="count">${rules.length} active rules</p>
    <div class="table-wrap">
      <table>
        <thead><tr>
          <th>Tool</th>
          <th>Risk</th>
          <th>Category</th>
          <th>Decision</th>
          <th>Match Args</th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;

  return wrapPage('Policy Rules', tableHtml, expiresAt);
}

async function renderErrorsView(orgId: string, filters: Record<string, string>, expiresAt: Date): Promise<string> {
  const from = filters.from ? new Date(filters.from) : new Date(Date.now() - 24 * 60 * 60 * 1000);
  const to = filters.to ? new Date(filters.to) : new Date();
  const limit = Math.min(Number(filters.limit) || 200, 500);

  const orgKeys = await prisma.apiKey.findMany({ where: { orgId, revokedAt: null }, select: { id: true } });
  const orgPubkeys = orgKeys.map((k) => `apikey:${k.id}`);

  const executions = await prisma.execution.findMany({
    where: {
      status: 'error',
      createdAt: { gte: from, lte: to },
      toolCall: orgPubkeys.length > 0 ? { agentPubkey: { in: orgPubkeys } } : undefined,
    },
    orderBy: { createdAt: 'desc' },
    take: limit,
    include: {
      toolCall: true,
    },
  });

  if (executions.length === 0) {
    return wrapPage('Execution Errors', '<div class="empty">No errors found for this period.</div>', expiresAt);
  }

  const rows = executions.map((e) => `
    <tr>
      <td>${escapeHtml(e.createdAt.toISOString().replace('T', ' ').slice(0, 19))}</td>
      <td>${escapeHtml(e.toolCall.toolName)}</td>
      <td title="${escapeHtml(e.stderr ?? '')}">${escapeHtml((e.stderr ?? 'Unknown error').slice(0, 120))}</td>
      <td>${e.exitCode !== null ? e.exitCode : '—'}</td>
      <td>${escapeHtml(e.toolCall.category ?? '—')}</td>
    </tr>`).join('');

  const tableHtml = `
    <p class="count">${executions.length} errors</p>
    <div class="table-wrap">
      <table>
        <thead><tr>
          <th>Timestamp</th>
          <th>Tool</th>
          <th>Error Message</th>
          <th>Exit Code</th>
          <th>Category</th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;

  return wrapPage('Execution Errors', tableHtml, expiresAt);
}

async function renderContributionsView(orgId: string, filters: Record<string, string>, expiresAt: Date): Promise<string> {
  const { computeOrgContributions } = await import('../engine/contributions.js');
  const period = (filters.period as 'day' | 'week' | 'month') || 'week';
  const data = await computeOrgContributions(prisma, orgId, { period, groupBy: 'agent' });

  if (data.totalActions === 0) {
    return wrapPage('Contributions', '<div class="empty">No contribution data found for this period.</div>', expiresAt);
  }

  const agentRows = data.byAgent.map((a) => `
    <tr>
      <td>${escapeHtml(a.agentLabel || a.agentId.slice(0, 16))}</td>
      <td>${escapeHtml(a.userId || '—')}</td>
      <td>${a.totalActions}</td>
      <td>${a.allowed}</td>
      <td>${a.denied}</td>
      <td>${a.approved}</td>
      <td>$${a.estimatedCost.toFixed(2)}</td>
    </tr>`).join('');

  const tableHtml = `
    <div style="margin-bottom:1.5rem">
      <strong>Total actions:</strong> ${data.totalActions} &nbsp;|&nbsp;
      <strong>Agents:</strong> ${data.totalAgents} &nbsp;|&nbsp;
      <strong>Users:</strong> ${data.totalUsers} &nbsp;|&nbsp;
      <strong>Auto-allow:</strong> ${Math.round(data.autoAllowRate * 100)}%
    </div>
    <div class="table-wrap">
      <table>
        <thead><tr>
          <th>Agent</th>
          <th>User</th>
          <th>Actions</th>
          <th>Allowed</th>
          <th>Denied</th>
          <th>Approval Needed</th>
          <th>Est. Cost</th>
        </tr></thead>
        <tbody>${agentRows}</tbody>
      </table>
    </div>`;

  return wrapPage('Agent Contributions', tableHtml, expiresAt);
}
