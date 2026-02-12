import { describe, it, expect } from 'vitest';
import {
  detectAgentPR,
  detectAgentCommit,
  detectByTrailer,
  detectByLabel,
  detectByBot,
  parseTrailers,
} from '../agent-detection.js';
import type { CommitInfo, PRInfo } from '../agent-detection.js';

describe('parseTrailers', () => {
  it('extracts agent pubkey from commit message trailer', () => {
    const message = `feat: add auth flow

Implemented the full auth flow with JWT tokens.

Wooblay-Agent-Pubkey: abc123pubkey456
Wooblay-Task-Id: task-7890`;

    const result = parseTrailers(message);
    expect(result.agentPubkey).toBe('abc123pubkey456');
    expect(result.taskId).toBe('task-7890');
  });

  it('returns undefined for messages without trailers', () => {
    const message = 'fix: simple bug fix\n\nJust a plain commit.';
    const result = parseTrailers(message);
    expect(result.agentPubkey).toBeUndefined();
    expect(result.taskId).toBeUndefined();
  });

  it('handles single-line commit messages', () => {
    const message = 'chore: update deps';
    const result = parseTrailers(message);
    expect(result.agentPubkey).toBeUndefined();
  });

  it('extracts only pubkey without task ID', () => {
    const message = `fix: error handling\n\nWooblay-Agent-Pubkey: onlypubkey`;
    const result = parseTrailers(message);
    expect(result.agentPubkey).toBe('onlypubkey');
    expect(result.taskId).toBeUndefined();
  });
});

describe('detectByTrailer', () => {
  it('detects agent from commit trailer', () => {
    const commit: CommitInfo = {
      sha: 'abc123',
      message: 'feat: stuff\n\nWooblay-Agent-Pubkey: mypubkey',
      authorLogin: 'someone',
    };
    const result = detectByTrailer(commit);
    expect(result.isAgent).toBe(true);
    expect(result.agentPubkey).toBe('mypubkey');
    expect(result.detectionMode).toBe('trailer');
  });

  it('returns false for commits without trailers', () => {
    const commit: CommitInfo = {
      sha: 'def456',
      message: 'fix: normal commit',
      authorLogin: 'human',
    };
    const result = detectByTrailer(commit);
    expect(result.isAgent).toBe(false);
  });
});

describe('detectByLabel', () => {
  it('detects agent from PR label', () => {
    const pr: PRInfo = {
      authorLogin: 'someone',
      labels: [{ name: 'wooblay-agent:pubkey123' }],
    };
    const result = detectByLabel(pr);
    expect(result.isAgent).toBe(true);
    expect(result.agentPubkey).toBe('pubkey123');
    expect(result.detectionMode).toBe('label');
  });

  it('ignores unrelated labels', () => {
    const pr: PRInfo = {
      authorLogin: 'someone',
      labels: [{ name: 'bug' }, { name: 'enhancement' }],
    };
    const result = detectByLabel(pr);
    expect(result.isAgent).toBe(false);
  });

  it('handles empty labels array', () => {
    const pr: PRInfo = {
      authorLogin: 'someone',
      labels: [],
    };
    const result = detectByLabel(pr);
    expect(result.isAgent).toBe(false);
  });

  it('ignores wooblay-agent: label without pubkey', () => {
    const pr: PRInfo = {
      authorLogin: 'someone',
      labels: [{ name: 'wooblay-agent:' }],
    };
    const result = detectByLabel(pr);
    expect(result.isAgent).toBe(false);
  });
});

describe('detectByBot', () => {
  it('detects bot by authorType', () => {
    const pr: PRInfo = {
      authorLogin: 'my-bot',
      authorType: 'Bot',
      labels: [],
    };
    const result = detectByBot(pr);
    expect(result.isAgent).toBe(true);
    expect(result.detectionMode).toBe('bot');
    expect(result.agentPubkey).toBeUndefined(); // bot detection doesn't yield pubkey
  });

  it('detects bot by [bot] suffix in login', () => {
    const pr: PRInfo = {
      authorLogin: 'dependabot[bot]',
      labels: [],
    };
    const result = detectByBot(pr);
    expect(result.isAgent).toBe(true);
  });

  it('returns false for regular users', () => {
    const pr: PRInfo = {
      authorLogin: 'john-dev',
      authorType: 'User',
      labels: [],
    };
    const result = detectByBot(pr);
    expect(result.isAgent).toBe(false);
  });
});

describe('detectAgentPR', () => {
  it('prioritizes trailer over label and bot', () => {
    const pr: PRInfo = {
      authorLogin: 'my-bot[bot]',
      authorType: 'Bot',
      labels: [{ name: 'wooblay-agent:labelpubkey' }],
    };
    const commits: CommitInfo[] = [
      {
        sha: 'abc',
        message: 'feat: stuff\n\nWooblay-Agent-Pubkey: trailerpubkey',
        authorLogin: 'my-bot[bot]',
        authorType: 'Bot',
      },
    ];

    const result = detectAgentPR(pr, commits);
    expect(result.isAgent).toBe(true);
    expect(result.agentPubkey).toBe('trailerpubkey');
    expect(result.detectionMode).toBe('trailer');
  });

  it('falls back to label when no trailers', () => {
    const pr: PRInfo = {
      authorLogin: 'some-user',
      authorType: 'User',
      labels: [{ name: 'wooblay-agent:labelpubkey' }],
    };
    const commits: CommitInfo[] = [
      { sha: 'abc', message: 'feat: stuff', authorLogin: 'some-user' },
    ];

    const result = detectAgentPR(pr, commits);
    expect(result.isAgent).toBe(true);
    expect(result.agentPubkey).toBe('labelpubkey');
    expect(result.detectionMode).toBe('label');
  });

  it('falls back to bot when no trailers or labels', () => {
    const pr: PRInfo = {
      authorLogin: 'wooblay-bot[bot]',
      authorType: 'Bot',
      labels: [],
    };
    const commits: CommitInfo[] = [
      { sha: 'abc', message: 'feat: stuff', authorLogin: 'wooblay-bot[bot]' },
    ];

    const result = detectAgentPR(pr, commits);
    expect(result.isAgent).toBe(true);
    expect(result.detectionMode).toBe('bot');
  });

  it('returns false for human PR with no signals', () => {
    const pr: PRInfo = {
      authorLogin: 'john-dev',
      authorType: 'User',
      labels: [{ name: 'feature' }],
    };
    const commits: CommitInfo[] = [
      { sha: 'abc', message: 'feat: stuff', authorLogin: 'john-dev' },
    ];

    const result = detectAgentPR(pr, commits);
    expect(result.isAgent).toBe(false);
  });
});

describe('detectAgentCommit', () => {
  it('detects agent commit by trailer', () => {
    const commit: CommitInfo = {
      sha: 'abc',
      message: 'fix: stuff\n\nWooblay-Agent-Pubkey: pk123',
      authorLogin: 'human',
      authorType: 'User',
    };
    const result = detectAgentCommit(commit);
    expect(result.isAgent).toBe(true);
    expect(result.detectionMode).toBe('trailer');
  });

  it('detects agent commit by bot login', () => {
    const commit: CommitInfo = {
      sha: 'abc',
      message: 'fix: stuff',
      authorLogin: 'bot[bot]',
      authorType: 'Bot',
    };
    const result = detectAgentCommit(commit);
    expect(result.isAgent).toBe(true);
    expect(result.detectionMode).toBe('bot');
  });

  it('returns false for human commit', () => {
    const commit: CommitInfo = {
      sha: 'abc',
      message: 'fix: human work',
      authorLogin: 'john',
      authorType: 'User',
    };
    const result = detectAgentCommit(commit);
    expect(result.isAgent).toBe(false);
  });
});
