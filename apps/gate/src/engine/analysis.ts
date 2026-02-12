/**
 * Human-readable descriptions for tool calls and risk tiers.
 * Used by activity feed and approvals to render meaningful summaries.
 */

// ── Describe a shell command in plain English ────────────────────────────────

function describeCommand(command: string): string {
  const parts = command.split(/\s+/);
  const base = parts[0];

  switch (base) {
    case 'ls': {
      const target = parts.filter((p) => !p.startsWith('-')).slice(1).join(' ');
      return `List files in ${target || 'current directory'}`;
    }
    case 'mkdir':
      return `Create directory ${parts.filter((p) => !p.startsWith('-')).slice(1).join(' ') || '<path>'}`;
    case 'rm': {
      const hasR = /\s-\w*r/.test(command) || /\s--recursive/.test(command);
      const hasF = /\s-\w*f/.test(command) || /\s--force/.test(command);
      const target = parts.filter((p) => !p.startsWith('-')).slice(1).join(' ') || '<path>';
      if (hasR && hasF) return `Delete ${target} and all contents (forced, recursive)`;
      if (hasR) return `Delete ${target} and all contents (recursive)`;
      if (hasF) return `Delete ${target} (forced)`;
      return `Delete ${target}`;
    }
    case 'curl':
    case 'wget': {
      const url = parts.find((p) => p.startsWith('http')) ?? parts[1] ?? '<url>';
      const outputFlag = command.includes('-o ') || command.includes('--output');
      const toTmp = /\/tmp\//.test(command);
      const pipeExec = command.includes('| sh') || command.includes('| bash');
      if (pipeExec) return `⚠️ Download and execute script from ${url} — remote code execution risk`;
      if (toTmp) return `⚠️ Download to /tmp from ${url} — temporary file, could be executed later`;
      if (outputFlag) return `Download file from ${url} to disk`;
      return `Download from ${url}`;
    }
    case 'git': {
      const sub = parts[1] ?? '';
      if (sub === 'push') return 'Push changes to remote repository';
      if (sub === 'pull') return 'Pull changes from remote repository';
      if (sub === 'clone') return `Clone repository ${parts[2] ?? ''}`.trim();
      if (sub === 'commit') return 'Commit staged changes';
      if (sub === 'add') return 'Stage files for commit';
      if (sub === 'checkout' || sub === 'switch') return `Switch to branch ${parts[2] ?? ''}`.trim();
      if (sub === 'merge') return `Merge branch ${parts[2] ?? ''}`.trim();
      if (sub === 'init') return 'Initialize a new git repository';
      return `Git: ${command.length > 80 ? command.slice(0, 80) + '...' : command}`;
    }
    case 'npm':
    case 'pnpm':
    case 'yarn': {
      const sub = parts[1] ?? '';
      if (sub === 'install' || sub === 'i' || sub === 'add') return `Install packages (${base})`;
      if (sub === 'publish') return `Publish package (${base})`;
      if (sub === 'run') return `Run script: ${parts[2] ?? '<script>'}`;
      if (sub === 'test') return 'Run tests';
      if (sub === 'build') return 'Build project';
      return `${base} ${sub}`;
    }
    case 'pip':
    case 'pip3': {
      const sub = parts[1] ?? '';
      if (sub === 'install') return 'Install Python packages';
      return `pip ${sub}`;
    }
    case 'docker': {
      const sub = parts[1] ?? '';
      if (sub === 'build') return 'Build Docker image';
      if (sub === 'run') return 'Run Docker container';
      if (sub === 'push') return 'Push Docker image to registry';
      if (sub === 'pull') return 'Pull Docker image';
      return `Docker: ${sub}`;
    }
    case 'sudo':
      return `Execute with superuser privileges: ${parts.slice(1).join(' ')}`;
    case 'chmod':
      return `Change permissions on ${parts.filter((p) => !p.startsWith('-')).slice(1).join(' ') || '<path>'}`;
    case 'chown':
      return `Change ownership of ${parts.filter((p) => !p.startsWith('-')).slice(1).join(' ') || '<path>'}`;
    case 'cat': {
      const target = parts[1] ?? '<path>';
      if (/\/etc\/shadow/i.test(target)) return `⚠️ Read /etc/shadow — contains password hashes (highly sensitive)`;
      if (/\/etc\/passwd/i.test(target)) return `⚠️ Read /etc/passwd — contains system user accounts`;
      if (/\/etc\/sudoers/i.test(target)) return `⚠️ Read /etc/sudoers — contains privilege escalation config`;
      if (/\.env/i.test(target)) return `⚠️ Read ${target} — may contain API keys and secrets`;
      if (/\.ssh/i.test(target)) return `⚠️ Read ${target} — SSH credentials`;
      return `Read file ${target}`;
    }
    case 'cd':
      return `Change directory to ${parts[1] ?? '<path>'}`;
    case 'cp':
      return `Copy ${parts.filter((p) => !p.startsWith('-')).slice(1).join(' to ') || 'files'}`;
    case 'mv':
      return `Move ${parts.filter((p) => !p.startsWith('-')).slice(1).join(' to ') || 'files'}`;
    case 'gh': {
      const sub = parts[1] ?? '';
      if (sub === 'pr') return `GitHub PR: ${parts.slice(2).join(' ')}`;
      if (sub === 'repo') return `GitHub repo: ${parts.slice(2).join(' ')}`;
      if (sub === 'issue') return `GitHub issue: ${parts.slice(2).join(' ')}`;
      return `GitHub CLI: ${command.length > 80 ? command.slice(0, 80) + '...' : command}`;
    }
    case 'ssh':
      return `SSH connection to ${parts[1] ?? '<host>'}`;
    case 'scp':
      return `Secure copy files`;
    case 'echo':
      return `Print output`;
    case 'touch':
      return `Create empty file ${parts[1] ?? '<path>'}`;
    case 'grep':
    case 'rg':
      return `Search for pattern in files`;
    case 'find':
      return `Find files matching criteria`;
    case 'python':
    case 'python3':
    case 'node':
      return `Run ${base} script: ${parts[1] ?? '<file>'}`;
    default:
      return `Execute: ${command.length > 120 ? command.slice(0, 120) + '...' : command}`;
  }
}

// ── Main description function ────────────────────────────────────────────────

export function describeToolCall(
  toolName: string,
  args: Record<string, unknown>,
): string {
  // Normalize tool name — the plugin sends 'exec', 'write', 'edit', 'web_fetch'
  const tool = toolName.replace(/^(gated_|wooblay_)/, '');

  switch (tool) {
    case 'exec': {
      const command = String(args['command'] ?? args['cmd'] ?? '').trim();
      if (!command) return 'Execute an empty shell command';
      return describeCommand(command);
    }

    case 'write': {
      const path = String(args['path'] ?? args['file'] ?? '<file>');
      const content = String(args['content'] ?? '');
      const lines = content.split('\n').length;
      const chars = content.length;
      return `Write file: ${path} (${lines} lines, ${chars} chars)`;
    }

    case 'edit': {
      const path = String(args['path'] ?? args['file'] ?? '<file>');
      const oldStr = String(args['old_string'] ?? args['oldText'] ?? '');
      const preview = oldStr.length > 60 ? oldStr.slice(0, 60) + '...' : oldStr;
      return `Edit file: ${path} — replace "${preview}"`;
    }

    case 'web_fetch':
    case 'http': {
      const method = String(args['method'] ?? 'GET').toUpperCase();
      const url = String(args['url'] ?? args['endpoint'] ?? '<url>');
      const shortUrl = url.length > 80 ? url.slice(0, 80) + '...' : url;
      return `${method} request: ${shortUrl}`;
    }

    case 'browser': {
      const action = String(args['action'] ?? args['type'] ?? 'navigate');
      const target = String(args['url'] ?? args['selector'] ?? '<target>');
      return `Browser: ${action} on ${target}`;
    }

    case 'read': {
      const path = String(args['path'] ?? args['file'] ?? '<file>');
      return `Read file: ${path}`;
    }

    case 'web_search': {
      const query = String(args['query'] ?? args['q'] ?? '<query>');
      return `Web search: "${query}"`;
    }

    case 'memory_search':
    case 'memory_get':
      return `Access agent memory`;

    case 'session_status':
    case 'sessions_list':
    case 'sessions_history':
      return `Check session status`;

    case 'image':
      return `Generate or process image`;

    default:
      return `Tool "${toolName}" with ${Object.keys(args).length} argument(s)`;
  }
}

// ── Risk explanation ─────────────────────────────────────────────────────────

export function describeRisk(
  riskTier: string,
  toolName: string,
  args: Record<string, unknown>,
): string {
  const tool = toolName.replace(/^(gated_|wooblay_)/, '');

  switch (riskTier) {
    case 'DESTRUCTIVE': {
      const command = String(args['command'] ?? args['cmd'] ?? '');
      if (/\bsudo\b/.test(command)) return 'Requires root access — could modify critical system state';
      if (/\brm\s/.test(command)) return 'Permanently deletes data — cannot be undone';
      if (/\bchmod\s+777\b/.test(command)) return 'Sets world-writable permissions — security risk';
      if (/\bmkfs\b/.test(command) || /\bdd\b/.test(command) || /\bfdisk\b/.test(command)) {
        return 'Modifies disk/partition layout — can cause permanent data loss';
      }
      if (tool === 'web_fetch' || tool === 'http') return 'HTTP DELETE permanently removes remote data';
      return 'Permanently deletes data or modifies system configuration';
    }

    case 'WRITE': {
      const command = String(args['command'] ?? args['cmd'] ?? '');
      if (/\bgit\s+(push|commit|merge)\b/.test(command)) return 'Pushes code or modifies version control history';
      if (/\bnpm\s+(install|publish)\b/.test(command) || /\bpip\s+install\b/.test(command)) {
        return 'Installs packages — may introduce untrusted dependencies';
      }
      if (tool === 'write') return 'Creates or overwrites a file on disk';
      if (tool === 'edit') return 'Modifies an existing file';
      if (tool === 'web_fetch' || tool === 'http') return 'HTTP request that modifies remote data';
      if (tool === 'browser') return 'Browser automation can mutate external state';
      return 'Modifies files, installs packages, or pushes code';
    }

    case 'READ':
      return 'Read-only operation — no side effects expected';

    default:
      return `Risk tier "${riskTier}" — review the details`;
  }
}

// ── Why this needs approval ──────────────────────────────────────────────────

export function explainWhyFlagged(
  riskTier: string,
  toolName: string,
  policyDecision: string,
  args: Record<string, unknown>,
): string {
  const tool = toolName.replace(/^(gated_|wooblay_)/, '');
  const description = describeToolCall(toolName, args);
  const command = String(args['command'] ?? args['cmd'] ?? '');
  const path = String(args['path'] ?? args['file'] ?? '');

  // Specific context-aware explanations
  const sensitiveFileReason = getSensitiveContext(command, path);
  const downloadReason = getDownloadContext(command);

  if (policyDecision === 'DENY') {
    if (riskTier === 'DESTRUCTIVE') {
      return `Blocked: This would permanently delete or damage system files. "${description}" cannot be undone.`;
    }
    return `Blocked by your security policy. "${description}" matched a deny rule.`;
  }

  if (policyDecision === 'APPROVE') {
    if (sensitiveFileReason) return sensitiveFileReason;
    if (downloadReason) return downloadReason;

    if (riskTier === 'DESTRUCTIVE') {
      return `This action could cause permanent damage. "${description}" needs your explicit approval before proceeding.`;
    }
    if (riskTier === 'WRITE') {
      if (tool === 'exec') {
        if (/\bgit\s+push\b/.test(command)) return 'This pushes code to a shared repository — other people will see these changes.';
        if (/\bnpm\s+publish\b/.test(command)) return 'This publishes a package publicly. Once published, versions cannot be unpublished.';
        if (/\bchmod\b/.test(command)) return 'This changes file permissions — could affect who can access or execute files.';
        return `This shell command modifies your system. Review what it does before approving.`;
      }
      if (tool === 'write') return `This creates or overwrites a file. Check the content is what you expect.`;
      if (tool === 'edit') return `This modifies an existing file. Review the change before approving.`;
      return `This action modifies state and needs your sign-off.`;
    }
    return `Your policy requires human review for this action.`;
  }

  return '';
}

function getSensitiveContext(command: string, path: string): string {
  const all = command + ' ' + path;
  if (/\/etc\/shadow/.test(all)) return '⚠️ Accessing /etc/shadow — this file contains password hashes for all users. This is a high-privilege operation.';
  if (/\/etc\/passwd/.test(all)) return '⚠️ Accessing /etc/passwd — this file lists all system user accounts. Could be used for reconnaissance.';
  if (/\/etc\/sudoers/.test(all)) return '⚠️ Accessing sudoers — this controls who has admin privileges on the system.';
  if (/\.ssh\/(id_rsa|authorized_keys)/.test(all)) return '⚠️ Accessing SSH credentials — could enable remote access to servers.';
  if (/\.env/.test(all)) return '⚠️ Accessing environment file — likely contains API keys, database passwords, and other secrets.';
  return '';
}

function getDownloadContext(command: string): string {
  if (/(curl|wget)/.test(command) && /https?:\/\//.test(command)) {
    if (/\|\s*(sh|bash)/.test(command)) return '🚨 This downloads and immediately executes a remote script. This is extremely dangerous — the script could do anything.';
    if (/\/tmp\//.test(command)) return '⚠️ Downloading a file to /tmp — temporary files are commonly used to stage malware or exploits.';
    if (/github\.com/.test(command)) return 'Downloading from GitHub. Verify the repository and file are trusted before approving.';
    return 'Downloading a file from the internet. Verify the URL is trusted.';
  }
  return '';
}
