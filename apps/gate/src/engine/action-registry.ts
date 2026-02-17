/**
 * Action Registry — optional convenience shortcuts for common actions.
 *
 * The registry is NOT a gatekeeper. Any action can be executed through the
 * gateway — if it's not in the registry, it's treated as generic execution:
 * the agent provides { command, provider, image? } and Wooblay runs it in an
 * ephemeral container with the provider's credentials.
 *
 * Registry entries are shortcuts: if an agent sends "git:push" with { branch },
 * the registry knows how to build the git command, which image to use, etc.
 * But the agent could also send a generic action with the raw command.
 *
 * The three-layer security moat (policy → simulation → secure exec) applies
 * to ALL actions regardless of whether they're in the registry.
 */

import type { ActionSpec, ExecutionSpec, ActionDefinition } from '../types/actions.js';
export type { ActionSpec, ExecutionSpec, ActionDefinition };

// ── Action Definitions ──────────────────────────────────────────────────

const ACTIONS: Record<string, ActionDefinition> = {
  // ── Git Operations ──────────────────────────────────────────────────

  'git:push': {
    provider: 'github',
    image: 'alpine/git:latest',
    allowedEndpoints: ['github.com:443', 'github.com:22'],
    mountWorkspace: true,
    timeoutMs: 120_000,
    buildCommand: (p) => {
      const remote = sanitize(String(p.remote ?? 'origin'));
      const branch = sanitize(String(p.branch));
      return `git -C /workspace push ${remote} ${branch}`;
    },
    buildEnv: () => ({}),
    describe: (p) => `Push branch "${p.branch}" to ${p.remote ?? 'origin'}`,
    validate: (p) => {
      if (!p.branch) return { valid: false, error: 'branch is required' };
      if (typeof p.branch !== 'string') return { valid: false, error: 'branch must be a string' };
      return { valid: true };
    },
  },

  'git:clone': {
    provider: 'github',
    image: 'alpine/git:latest',
    allowedEndpoints: ['github.com:443', 'github.com:22'],
    mountWorkspace: false,
    timeoutMs: 300_000,
    buildCommand: (p) => {
      const url = sanitize(String(p.url));
      const depth = p.depth ? `--depth ${Number(p.depth)}` : '';
      const branch = p.branch ? `-b ${sanitize(String(p.branch))}` : '';
      return `git clone ${depth} ${branch} ${url} /workspace/repo`.trim().replace(/\s+/g, ' ');
    },
    buildEnv: () => ({}),
    describe: (p) => `Clone ${p.url}${p.branch ? ` (branch: ${p.branch})` : ''}`,
    validate: (p) => {
      if (!p.url) return { valid: false, error: 'url is required' };
      return { valid: true };
    },
  },

  'git:pull': {
    provider: 'github',
    image: 'alpine/git:latest',
    allowedEndpoints: ['github.com:443', 'github.com:22'],
    mountWorkspace: true,
    timeoutMs: 120_000,
    buildCommand: (p) => {
      const remote = sanitize(String(p.remote ?? 'origin'));
      const branch = p.branch ? sanitize(String(p.branch)) : '';
      return `git -C /workspace pull ${remote} ${branch}`.trim();
    },
    buildEnv: () => ({}),
    describe: (p) => `Pull from ${p.remote ?? 'origin'}${p.branch ? ` (${p.branch})` : ''}`,
    validate: () => ({ valid: true }),
  },

  // ── GitHub API Operations ─────────────────────────────────────────────

  'github:pr:create': {
    provider: 'github',
    image: 'ghcr.io/cli/cli:latest',
    allowedEndpoints: ['api.github.com:443'],
    mountWorkspace: false,
    timeoutMs: 30_000,
    buildCommand: (p) => {
      const repo = sanitize(String(p.repo ?? `${p.owner}/${p.repo_name}`));
      const title = shellEscape(String(p.title));
      const body = shellEscape(String(p.body ?? ''));
      const base = sanitize(String(p.base));
      const head = sanitize(String(p.head));
      return `gh pr create --repo ${repo} --title ${title} --body ${body} --base ${base} --head ${head}`;
    },
    buildEnv: () => ({}),
    describe: (p) => `Create PR "${p.title}" (${p.head} → ${p.base}) on ${p.owner}/${p.repo_name ?? p.repo}`,
    validate: (p) => {
      if (!p.title) return { valid: false, error: 'title is required' };
      if (!p.base) return { valid: false, error: 'base branch is required' };
      if (!p.head) return { valid: false, error: 'head branch is required' };
      if (!(p.repo || (p.owner && p.repo_name))) return { valid: false, error: 'repo (or owner + repo_name) is required' };
      return { valid: true };
    },
  },

  'github:pr:comment': {
    provider: 'github',
    image: 'ghcr.io/cli/cli:latest',
    allowedEndpoints: ['api.github.com:443'],
    mountWorkspace: false,
    timeoutMs: 15_000,
    buildCommand: (p) => {
      const repo = sanitize(String(p.repo ?? `${p.owner}/${p.repo_name}`));
      const number = Number(p.number);
      const body = shellEscape(String(p.body));
      return `gh pr comment ${number} --repo ${repo} --body ${body}`;
    },
    buildEnv: () => ({}),
    describe: (p) => `Comment on PR #${p.number} in ${p.owner}/${p.repo_name ?? p.repo}`,
    validate: (p) => {
      if (!p.number) return { valid: false, error: 'PR number is required' };
      if (!p.body) return { valid: false, error: 'comment body is required' };
      return { valid: true };
    },
  },

  'github:pr:merge': {
    provider: 'github',
    image: 'ghcr.io/cli/cli:latest',
    allowedEndpoints: ['api.github.com:443'],
    mountWorkspace: false,
    timeoutMs: 30_000,
    buildCommand: (p) => {
      const repo = sanitize(String(p.repo ?? `${p.owner}/${p.repo_name}`));
      const number = Number(p.number);
      const method = sanitize(String(p.merge_method ?? 'squash'));
      return `gh pr merge ${number} --repo ${repo} --${method} --auto`;
    },
    buildEnv: () => ({}),
    describe: (p) => `Merge PR #${p.number} in ${p.owner}/${p.repo_name ?? p.repo} (${p.merge_method ?? 'squash'})`,
    validate: (p) => {
      if (!p.number) return { valid: false, error: 'PR number is required' };
      return { valid: true };
    },
  },

  // ── AWS Operations ────────────────────────────────────────────────────

  'aws:s3:cp': {
    provider: 'aws',
    image: 'amazon/aws-cli:latest',
    allowedEndpoints: ['*.amazonaws.com:443'],
    mountWorkspace: true,
    timeoutMs: 120_000,
    buildCommand: (p) => {
      const src = sanitize(String(p.source));
      const dst = sanitize(String(p.destination));
      const recursive = p.recursive ? ' --recursive' : '';
      return `aws s3 cp ${src} ${dst}${recursive}`;
    },
    buildEnv: (p) => ({
      AWS_DEFAULT_REGION: String(p.region ?? 'us-east-1'),
    }),
    describe: (p) => `S3 copy: ${p.source} → ${p.destination}`,
    validate: (p) => {
      if (!p.source) return { valid: false, error: 'source is required' };
      if (!p.destination) return { valid: false, error: 'destination is required' };
      return { valid: true };
    },
  },

  'aws:ecs:deploy': {
    provider: 'aws',
    image: 'amazon/aws-cli:latest',
    allowedEndpoints: ['*.amazonaws.com:443'],
    mountWorkspace: false,
    timeoutMs: 120_000,
    buildCommand: (p) => {
      const cluster = sanitize(String(p.cluster));
      const service = sanitize(String(p.service));
      return `aws ecs update-service --cluster ${cluster} --service ${service} --force-new-deployment`;
    },
    buildEnv: (p) => ({
      AWS_DEFAULT_REGION: String(p.region ?? 'us-east-1'),
    }),
    describe: (p) => `Deploy ECS service "${p.service}" in cluster "${p.cluster}"`,
    validate: (p) => {
      if (!p.cluster) return { valid: false, error: 'cluster is required' };
      if (!p.service) return { valid: false, error: 'service is required' };
      return { valid: true };
    },
  },

  // ── GCP Operations ────────────────────────────────────────────────────

  'gcp:cloudrun:deploy': {
    provider: 'gcp',
    image: 'google/cloud-sdk:slim',
    allowedEndpoints: ['*.googleapis.com:443'],
    mountWorkspace: false,
    timeoutMs: 180_000,
    buildCommand: (p) => {
      const service = sanitize(String(p.service));
      const image = sanitize(String(p.image));
      const region = sanitize(String(p.region ?? 'us-central1'));
      const project = p.project ? `--project ${sanitize(String(p.project))}` : '';
      return `gcloud run deploy ${service} --image ${image} --region ${region} ${project} --quiet`.trim();
    },
    buildEnv: () => ({}),
    describe: (p) => `Deploy Cloud Run service "${p.service}" with image "${p.image}"`,
    validate: (p) => {
      if (!p.service) return { valid: false, error: 'service is required' };
      if (!p.image) return { valid: false, error: 'image is required' };
      return { valid: true };
    },
  },

  'gcp:gcs:cp': {
    provider: 'gcp',
    image: 'google/cloud-sdk:slim',
    allowedEndpoints: ['*.googleapis.com:443', 'storage.googleapis.com:443'],
    mountWorkspace: true,
    timeoutMs: 120_000,
    buildCommand: (p) => {
      const src = sanitize(String(p.source));
      const dst = sanitize(String(p.destination));
      const recursive = p.recursive ? ' -r' : '';
      return `gsutil${recursive} cp ${src} ${dst}`;
    },
    buildEnv: () => ({}),
    describe: (p) => `GCS copy: ${p.source} → ${p.destination}`,
    validate: (p) => {
      if (!p.source) return { valid: false, error: 'source is required' };
      if (!p.destination) return { valid: false, error: 'destination is required' };
      return { valid: true };
    },
  },
};

// ── Generic Execution ────────────────────────────────────────────────────
// exec:run is a passthrough — any command in an ephemeral container with
// the provider's credentials + exec_only secrets injected. The agent
// decides what to run. The three-layer moat (scope, sim, secure exec)
// still applies.

ACTIONS['exec:run'] = {
  provider: 'github', // Default; overridden by params.provider at runtime
  image: 'node:20-slim',
  allowedEndpoints: ['*:443', '*:80'],
  mountWorkspace: true,
  timeoutMs: 300_000,
  buildCommand: (p) => {
    const cmd = String(p.command ?? '');
    if (!cmd) throw new Error('command is required for exec:run');
    return cmd;
  },
  buildEnv: (p) => {
    const env: Record<string, string> = {};
    if (p.env && typeof p.env === 'object') {
      for (const [k, v] of Object.entries(p.env as Record<string, string>)) {
        env[k] = String(v);
      }
    }
    return env;
  },
  describe: (p) => `Run: ${String(p.command ?? '').slice(0, 100)}`,
  validate: (p) => {
    if (!p.command || typeof p.command !== 'string') {
      return { valid: false, error: 'command (string) is required' };
    }
    return { valid: true };
  },
};

// ── Registry API ────────────────────────────────────────────────────────

/**
 * Look up an action definition by action ID.
 */
export function getActionDefinition(action: string): ActionDefinition | null {
  return ACTIONS[action] ?? null;
}

/**
 * Build a full execution spec from an action request + credential map.
 *
 * If the action is in the registry, uses the structured definition.
 * If not, falls through to generic execution — the agent must provide
 * { command, provider } in params. This means ANY action can execute
 * through the gateway, not just registered ones.
 */
export function buildExecutionSpec(
  spec: ActionSpec,
  credentials: Record<string, string>,
): ExecutionSpec | { error: string } {
  const def = getActionDefinition(spec.action);

  // ── Known action (registry shortcut) ──────────────────────────────
  if (def) {
    const validation = def.validate(spec.params);
    if (!validation.valid) {
      return { error: `Invalid params for ${spec.action}: ${validation.error}` };
    }

    const command = def.buildCommand(spec.params);
    const env = { ...def.buildEnv(spec.params), ...credentials };

    const image = spec.params.image ? String(spec.params.image) : def.image;
    const timeoutMs = spec.params.timeout
      ? Math.min(Number(spec.params.timeout), 600_000)
      : def.timeoutMs;
    const mountWorkspace = spec.params.mountWorkspace !== undefined
      ? Boolean(spec.params.mountWorkspace)
      : def.mountWorkspace;

    return {
      command,
      env,
      image,
      allowedEndpoints: def.allowedEndpoints,
      mountWorkspace,
      workdir: '/workspace',
      timeoutMs,
      provider: spec.params.provider ? String(spec.params.provider) : def.provider,
      description: def.describe(spec.params),
    };
  }

  // ── Unknown action (generic execution) ────────────────────────────
  // Agent provides the command directly. No registry entry needed.
  const command = spec.params.command ? String(spec.params.command) : null;
  if (!command) {
    return {
      error: `Action "${spec.action}" is not a known shortcut. Provide "command" in params for generic execution.`,
    };
  }

  const env: Record<string, string> = { ...credentials };
  if (spec.params.env && typeof spec.params.env === 'object') {
    for (const [k, v] of Object.entries(spec.params.env as Record<string, string>)) {
      env[k] = String(v);
    }
  }

  return {
    command,
    env,
    image: spec.params.image ? String(spec.params.image) : 'node:20-slim',
    allowedEndpoints: ['*:443', '*:80'],
    mountWorkspace: spec.params.mountWorkspace !== undefined ? Boolean(spec.params.mountWorkspace) : false,
    workdir: '/workspace',
    timeoutMs: spec.params.timeout ? Math.min(Number(spec.params.timeout), 600_000) : 300_000,
    provider: spec.params.provider ? String(spec.params.provider) : 'generic',
    description: `${spec.action}: ${command.slice(0, 100)}`,
  };
}

// ── Sanitization ────────────────────────────────────────────────────────

const UNSAFE_CHARS = /[;&|`$(){}[\]!#~<>\\'"]/g;

function sanitize(input: string): string {
  return input.replace(UNSAFE_CHARS, '').trim();
}

function shellEscape(input: string): string {
  return `'${input.replace(/'/g, "'\\''")}'`;
}
