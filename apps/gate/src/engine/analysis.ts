/**
 * Human-readable descriptions for tool calls and risk tiers.
 * Used by activity feed and approvals to render meaningful summaries.
 *
 * Full analysis engine (anomaly detection, audit flags, batch analysis)
 * is available on the dev branch.
 */

export function describeToolCall(
  toolName: string,
  args: Record<string, unknown>,
): string {
  switch (toolName) {
    case 'wooblay_exec': {
      const command = String(args['command'] ?? args['cmd'] ?? '').trim();
      if (!command) return 'Execute an empty shell command';

      const parts = command.split(/\s+/);
      const base = parts[0];

      switch (base) {
        case 'ls': {
          const lsTarget = parts.filter((p) => !p.startsWith('-')).slice(1).join(' ');
          return `List files in ${lsTarget || 'current directory'}`;
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
          return `Download from ${url}`;
        }
        case 'git': {
          const subcommand = parts[1] ?? '';
          if (subcommand === 'push') return 'Push changes to remote repository';
          if (subcommand === 'pull') return 'Pull changes from remote repository';
          if (subcommand === 'clone') return `Clone repository ${parts[2] ?? ''}`;
          if (subcommand === 'commit') return 'Commit staged changes';
          return `Git ${subcommand}: ${command}`;
        }
        case 'npm': {
          const sub = parts[1] ?? '';
          if (sub === 'install' || sub === 'i') return 'Install npm packages';
          if (sub === 'publish') return 'Publish npm package';
          return `npm ${sub}`;
        }
        case 'sudo':
          return `Execute with superuser privileges: ${parts.slice(1).join(' ')}`;
        case 'chmod':
          return `Change permissions on ${parts.filter((p) => !p.startsWith('-')).slice(1).join(' ') || '<path>'}`;
        case 'chown':
          return `Change ownership of ${parts.filter((p) => !p.startsWith('-')).slice(1).join(' ') || '<path>'}`;
        case 'cat':
          return `Read file ${parts[1] ?? '<path>'}`;
        case 'cd':
          return `Change directory to ${parts[1] ?? '<path>'}`;
        case 'cp':
          return `Copy ${parts.filter((p) => !p.startsWith('-')).slice(1).join(' to ') || 'files'}`;
        case 'mv':
          return `Move ${parts.filter((p) => !p.startsWith('-')).slice(1).join(' to ') || 'files'}`;
        default:
          return `Execute: ${command.length > 120 ? command.slice(0, 120) + '...' : command}`;
      }
    }

    case 'wooblay_http': {
      const method = String(args['method'] ?? 'GET').toUpperCase();
      const url = String(args['url'] ?? args['endpoint'] ?? '<url>');
      return `Make ${method} request to ${url}`;
    }

    case 'wooblay_browser': {
      const action = String(args['action'] ?? args['type'] ?? 'navigate');
      const target = String(args['url'] ?? args['selector'] ?? '<target>');
      return `Browser action: ${action} on ${target}`;
    }

    default:
      return `Call tool "${toolName}" with ${Object.keys(args).length} argument(s)`;
  }
}

/**
 * Explain why a tool call is classified at its risk tier.
 */
export function describeRisk(
  riskTier: string,
  toolName: string,
  args: Record<string, unknown>,
): string {
  switch (riskTier) {
    case 'DESTRUCTIVE': {
      const command = String(args['command'] ?? args['cmd'] ?? '');
      if (/\bsudo\b/.test(command)) return 'This command requires root access and could modify critical system state';
      if (/\brm\s/.test(command)) return 'This command permanently deletes data';
      if (/\bchmod\s+777\b/.test(command)) return 'This command sets world-writable permissions, a security risk';
      if (/\bmkfs\b/.test(command) || /\bdd\b/.test(command) || /\bfdisk\b/.test(command)) {
        return 'This command modifies disk/partition layout and can cause permanent data loss';
      }
      if (toolName === 'wooblay_http') return 'This HTTP DELETE request permanently removes remote data';
      return 'This command permanently deletes data or modifies system configuration';
    }

    case 'WRITE': {
      const command = String(args['command'] ?? args['cmd'] ?? '');
      if (/\bgit\s+(push|commit|merge)\b/.test(command)) return 'This command pushes code or modifies version control history';
      if (/\bnpm\s+(install|publish)\b/.test(command) || /\bpip\s+install\b/.test(command)) {
        return 'This command installs packages which may introduce dependencies';
      }
      if (toolName === 'wooblay_http') return 'This HTTP request modifies remote data';
      if (toolName === 'wooblay_browser') return 'Browser automation can mutate external state';
      return 'This command modifies files, installs packages, or pushes code';
    }

    case 'READ':
      return 'This command only reads data, no side effects expected';

    default:
      return `Risk tier "${riskTier}" — review the command details`;
  }
}
