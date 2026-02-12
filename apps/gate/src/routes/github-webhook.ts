// @ts-nocheck
/**
 * GitHub App webhook handler.
 *
 * POST /github/webhook — receives all GitHub webhook events.
 *
 * This route uses HMAC-SHA256 signature verification (GitHub's scheme)
 * instead of the Gate's Ed25519 auth. It must be excluded from the
 * standard auth middleware.
 *
 * Handles:
 *   - installation / installation_repositories → upsert installations & repos
 *   - pull_request (opened/reopened/synchronize/closed/labeled) → agent detection, PR tracking
 *   - pull_request_review (submitted) → event recording, intervention scoring
 *   - push → commit tracking, re-attribution
 *   - check_run / workflow_run → CI result tracking
 *   - issue_comment → event recording, task-link commands
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import {
  verifyWebhookSignature,
  detectAgentPR,
  detectAgentCommit,
  computeAttribution,
  upsertCheckRun,
  computeReceiptCoverage,
  extractTaskIdFromComment,
  createInstallationOctokit,
  parseTrailers,
} from '@wooblay/github';
import type {
  CommitInfo,
  PRInfo,
  CommitAttribution,
  PRReview,
  CIResult,
  RevertSignal,
  GitHubAppConfig,
} from '@wooblay/github';
import { prisma } from '../db/client.js';
import { config } from '../config.js';

// ── Helpers ──────────────────────────────────────────────────────────────────

function getGitHubConfig(): GitHubAppConfig {
  return {
    appId: config.GITHUB_APP_ID,
    privateKey: config.GITHUB_APP_PRIVATE_KEY,
    webhookSecret: config.GITHUB_WEBHOOK_SECRET,
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type WebhookPayload = Record<string, any>;

/**
 * Recompute and persist attribution for a PR.
 * Also updates the Wooblay Check Run on GitHub.
 */
async function recomputeAttribution(prId: string, installationId: number): Promise<void> {
  const pr = await prisma.gitHubPR.findUnique({
    where: { id: prId },
    include: {
      commits: true,
      events: true,
      checkResults: true,
      taskLinks: true,
      repo: true,
    },
  });

  if (!pr || !pr.isAgentPR) return;

  // Build attribution input
  const commitAttrs: CommitAttribution[] = pr.commits.map((c) => ({
    sha: c.sha,
    authorLogin: c.authorLogin,
    isAgent: c.isAgent,
    linesAdded: c.linesAdded,
    linesRemoved: c.linesRemoved,
  }));

  const reviews: PRReview[] = pr.events
    .filter((e) => e.eventType === 'review')
    .map((e) => {
      const payload = JSON.parse(e.payload) as { state?: string; submittedAt?: string };
      return {
        state: payload.state ?? 'commented',
        authorLogin: e.actorLogin,
        submittedAt: e.createdAt.toISOString(),
      };
    });

  const ciResults: CIResult[] = pr.checkResults.map((c) => ({
    checkName: c.checkName,
    conclusion: c.conclusion,
  }));

  // Check for reverts — look for PRs titled "Revert ..." pointing to this PR
  const revertSignal: RevertSignal = { isReverted: false };
  if (pr.mergedAt) {
    const revertPR = await prisma.gitHubPR.findFirst({
      where: {
        repoId: pr.repoId,
        title: { startsWith: `Revert "${pr.title}"` },
        createdAt: {
          lte: new Date(new Date(pr.mergedAt).getTime() + 7 * 24 * 60 * 60 * 1000),
        },
      },
    });
    if (revertPR) {
      const daysSince = Math.floor(
        (revertPR.createdAt.getTime() - new Date(pr.mergedAt).getTime()) / (24 * 60 * 60 * 1000),
      );
      revertSignal.isReverted = true;
      revertSignal.daysSinceRevert = daysSince;
    }
  }

  const attrResult = computeAttribution({ commits: commitAttrs, reviews, ciResults, revert: revertSignal });

  // Compute receipt coverage if task links exist
  let receiptCoverage: number | null = null;
  const allReceiptHashes: string[] = [];

  if (pr.taskLinks.length > 0) {
    const taskIds = pr.taskLinks.map((l) => l.taskId);
    const receipts = await prisma.receipt.findMany({
      where: {
        agentPubkey: pr.agentPubkey ?? undefined,
        toolCall: {
          taskId: { in: taskIds },
        },
      },
      select: { hash: true, agentPubkey: true, toolCallId: true, timestamp: true },
    });

    const agentCommits = pr.commits
      .filter((c) => c.isAgent)
      .map((c) => ({ sha: c.sha, createdAt: c.createdAt.toISOString() }));

    const bridgeResult = computeReceiptCoverage(
      agentCommits,
      receipts.map((r) => ({
        hash: r.hash,
        agentPubkey: r.agentPubkey,
        toolCallId: r.toolCallId,
        timestamp: r.timestamp,
      })),
    );

    receiptCoverage = bridgeResult.receiptCoverage;
    allReceiptHashes.push(...bridgeResult.receiptHashes);

    // Update task links with receipt hashes
    for (const link of pr.taskLinks) {
      const linkReceipts = receipts
        .filter((r) => r.agentPubkey === pr.agentPubkey)
        .map((r) => r.hash);
      await prisma.gitHubTaskLink.update({
        where: { id: link.id },
        data: { receiptHashes: JSON.stringify(linkReceipts) },
      });
    }
  }

  // Upsert attribution record
  await prisma.gitHubPRAttribution.upsert({
    where: { prId },
    create: {
      prId,
      agentPubkey: pr.agentPubkey,
      agentCommitShas: JSON.stringify(attrResult.agentCommitShas),
      humanCommitShas: JSON.stringify(attrResult.humanCommitShas),
      agentLOC: attrResult.agentLOC,
      humanLOC: attrResult.humanLOC,
      interventionScore: attrResult.interventionScore,
      interventionBreakdown: JSON.stringify(attrResult.interventionBreakdown),
      receiptCoverage,
      computedAt: new Date(),
    },
    update: {
      agentPubkey: pr.agentPubkey,
      agentCommitShas: JSON.stringify(attrResult.agentCommitShas),
      humanCommitShas: JSON.stringify(attrResult.humanCommitShas),
      agentLOC: attrResult.agentLOC,
      humanLOC: attrResult.humanLOC,
      interventionScore: attrResult.interventionScore,
      interventionBreakdown: JSON.stringify(attrResult.interventionBreakdown),
      receiptCoverage,
      computedAt: new Date(),
    },
  });

  // Update Wooblay Check Run on GitHub
  if (pr.headSha && config.GITHUB_APP_ID) {
    try {
      const octokit = await createInstallationOctokit(getGitHubConfig(), installationId);
      const reviewCount = reviews.length;
      const changesRequestedCount = reviews.filter((r) => r.state === 'changes_requested').length;
      const ciFailureCount = ciResults.filter((r) => r.conclusion === 'failure').length;

      await upsertCheckRun(
        octokit,
        {
          owner: pr.repo.owner,
          repo: pr.repo.name,
          headSha: pr.headSha,
          prNumber: pr.number,
          dashboardUrl: config.WOOBLAY_DASHBOARD_URL,
        },
        {
          ...attrResult,
          receiptCoverage: receiptCoverage ?? undefined,
          reviewCount,
          changesRequestedCount,
          ciFailureCount,
        },
      );
    } catch (err) {
      // Non-fatal — check run update failure shouldn't block webhook processing
      console.error('Failed to update Wooblay Check Run:', err);
    }
  }
}

// ── Event handlers ───────────────────────────────────────────────────────────

async function handleInstallation(payload: WebhookPayload): Promise<void> {
  const action = payload.action as string;
  const installation = payload.installation as WebhookPayload;

  if (action === 'created' || action === 'new_permissions_accepted') {
    await prisma.gitHubInstallation.upsert({
      where: { installationId: installation.id },
      create: {
        installationId: installation.id,
        accountLogin: installation.account.login,
        accountType: installation.account.type,
        status: 'active',
      },
      update: {
        accountLogin: installation.account.login,
        accountType: installation.account.type,
        status: 'active',
      },
    });

    // Also add repositories if provided
    const repos = (payload.repositories ?? []) as WebhookPayload[];
    for (const repo of repos) {
      const inst = await prisma.gitHubInstallation.findUnique({
        where: { installationId: installation.id },
      });
      if (!inst) continue;

      await prisma.gitHubRepo.upsert({
        where: { githubId: repo.id },
        create: {
          installationId: inst.id,
          githubId: repo.id,
          owner: (repo.full_name as string).split('/')[0]!,
          name: (repo.full_name as string).split('/')[1]!,
          fullName: repo.full_name,
        },
        update: {
          fullName: repo.full_name,
        },
      });
    }
  } else if (action === 'deleted') {
    await prisma.gitHubInstallation.updateMany({
      where: { installationId: installation.id },
      data: { status: 'suspended' },
    });
  }
}

async function handleInstallationRepositories(payload: WebhookPayload): Promise<void> {
  const installation = payload.installation as WebhookPayload;
  const inst = await prisma.gitHubInstallation.findUnique({
    where: { installationId: installation.id },
  });
  if (!inst) return;

  const added = (payload.repositories_added ?? []) as WebhookPayload[];
  for (const repo of added) {
    await prisma.gitHubRepo.upsert({
      where: { githubId: repo.id },
      create: {
        installationId: inst.id,
        githubId: repo.id,
        owner: (repo.full_name as string).split('/')[0]!,
        name: (repo.full_name as string).split('/')[1]!,
        fullName: repo.full_name,
      },
      update: {
        fullName: repo.full_name,
      },
    });
  }

  const removed = (payload.repositories_removed ?? []) as WebhookPayload[];
  for (const repo of removed) {
    // Soft-delete: we keep the record for historical PRs
    await prisma.gitHubRepo.deleteMany({
      where: { githubId: repo.id },
    });
  }
}

async function handlePullRequest(payload: WebhookPayload): Promise<void> {
  const action = payload.action as string;
  const prData = payload.pull_request as WebhookPayload;
  const repoData = payload.repository as WebhookPayload;
  const installation = payload.installation as WebhookPayload;
  const installationId = installation?.id as number;

  // Find or create repo
  const repo = await prisma.gitHubRepo.findUnique({
    where: { fullName: repoData.full_name },
  });
  if (!repo) return; // Repo not tracked

  // Detect agent
  const prInfo: PRInfo = {
    authorLogin: prData.user.login,
    authorType: prData.user.type,
    labels: (prData.labels ?? []) as Array<{ name: string }>,
  };

  // Fetch commits for trailer detection
  let commits: CommitInfo[] = [];
  if (config.GITHUB_APP_ID && installationId) {
    try {
      const octokit = await createInstallationOctokit(getGitHubConfig(), installationId);
      const { data: commitData } = await octokit.rest.pulls.listCommits({
        owner: repo.owner,
        repo: repo.name,
        pull_number: prData.number,
        per_page: 100,
      });
      commits = commitData.map((c) => ({
        sha: c.sha,
        message: c.commit.message,
        authorLogin: c.author?.login ?? c.commit.author?.name ?? 'unknown',
        authorEmail: c.commit.author?.email ?? undefined,
        authorType: c.author?.type,
      }));
    } catch {
      // Fall back to detection without commits
    }
  }

  const detection = detectAgentPR(prInfo, commits);

  // Determine PR state
  let state = 'open';
  if (prData.merged) state = 'merged';
  else if (prData.state === 'closed') state = 'closed';

  // Upsert PR record
  const pr = await prisma.gitHubPR.upsert({
    where: { repoId_number: { repoId: repo.id, number: prData.number } },
    create: {
      repoId: repo.id,
      number: prData.number,
      title: prData.title,
      state,
      isAgentPR: detection.isAgent,
      agentPubkey: detection.agentPubkey ?? null,
      detectionMode: detection.detectionMode ?? null,
      authorLogin: prData.user.login,
      headSha: prData.head.sha,
      baseBranch: prData.base.ref,
      headBranch: prData.head.ref,
      createdAt: new Date(prData.created_at),
      mergedAt: prData.merged_at ? new Date(prData.merged_at) : null,
      closedAt: prData.closed_at ? new Date(prData.closed_at) : null,
    },
    update: {
      title: prData.title,
      state,
      isAgentPR: detection.isAgent,
      agentPubkey: detection.agentPubkey ?? undefined,
      detectionMode: detection.detectionMode ?? undefined,
      headSha: prData.head.sha,
      mergedAt: prData.merged_at ? new Date(prData.merged_at) : null,
      closedAt: prData.closed_at ? new Date(prData.closed_at) : null,
    },
  });

  // Store commits
  if (commits.length > 0 && (action === 'opened' || action === 'synchronize' || action === 'reopened')) {
    for (const commit of commits) {
      const commitDetection = detectAgentCommit(commit);
      const trailers = parseTrailers(commit.message);

      // Fetch commit stats (lines added/removed)
      let linesAdded = 0;
      let linesRemoved = 0;
      if (config.GITHUB_APP_ID && installationId) {
        try {
          const octokit = await createInstallationOctokit(getGitHubConfig(), installationId);
          const { data: commitDetail } = await octokit.rest.repos.getCommit({
            owner: repo.owner,
            repo: repo.name,
            ref: commit.sha,
          });
          linesAdded = commitDetail.stats?.additions ?? 0;
          linesRemoved = commitDetail.stats?.deletions ?? 0;
        } catch {
          // Non-fatal
        }
      }

      await prisma.gitHubCommit.upsert({
        where: { sha: commit.sha },
        create: {
          prId: pr.id,
          sha: commit.sha,
          authorLogin: commit.authorLogin,
          authorEmail: commit.authorEmail ?? null,
          message: commit.message,
          isAgent: commitDetection.isAgent,
          detectionMode: commitDetection.detectionMode ?? null,
          linesAdded,
          linesRemoved,
          createdAt: new Date(),
        },
        update: {
          isAgent: commitDetection.isAgent,
          detectionMode: commitDetection.detectionMode ?? null,
          linesAdded,
          linesRemoved,
        },
      });

      // Auto-create task link from commit trailer
      if (trailers.taskId) {
        await prisma.gitHubTaskLink.upsert({
          where: { taskId_prId: { taskId: trailers.taskId, prId: pr.id } },
          create: { taskId: trailers.taskId, prId: pr.id },
          update: {},
        });
      }
    }
  }

  // Record PR event
  await prisma.gitHubPREvent.create({
    data: {
      prId: pr.id,
      eventType: `pull_request.${action}`,
      actorLogin: (payload.sender as WebhookPayload)?.login ?? 'unknown',
      payload: JSON.stringify({ action, state, merged: prData.merged }),
      createdAt: new Date(),
    },
  });

  // Recompute attribution for agent PRs
  if (detection.isAgent && installationId) {
    await recomputeAttribution(pr.id, installationId);
  }
}

async function handlePullRequestReview(payload: WebhookPayload): Promise<void> {
  const review = payload.review as WebhookPayload;
  const prData = payload.pull_request as WebhookPayload;
  const repoData = payload.repository as WebhookPayload;
  const installation = payload.installation as WebhookPayload;

  const repo = await prisma.gitHubRepo.findUnique({
    where: { fullName: repoData.full_name },
  });
  if (!repo) return;

  const pr = await prisma.gitHubPR.findUnique({
    where: { repoId_number: { repoId: repo.id, number: prData.number } },
  });
  if (!pr) return;

  await prisma.gitHubPREvent.create({
    data: {
      prId: pr.id,
      eventType: 'review',
      actorLogin: review.user.login,
      payload: JSON.stringify({
        state: review.state,
        body: review.body,
      }),
      createdAt: new Date(review.submitted_at),
    },
  });

  if (pr.isAgentPR && installation?.id) {
    await recomputeAttribution(pr.id, installation.id);
  }
}

async function handlePush(payload: WebhookPayload): Promise<void> {
  const ref = payload.ref as string;
  const repoData = payload.repository as WebhookPayload;
  const installation = payload.installation as WebhookPayload;

  // Extract branch name from ref (refs/heads/branch-name)
  const branch = ref.replace('refs/heads/', '');

  const repo = await prisma.gitHubRepo.findUnique({
    where: { fullName: repoData.full_name },
  });
  if (!repo) return;

  // Find open agent PRs targeting this branch
  const agentPRs = await prisma.gitHubPR.findMany({
    where: {
      repoId: repo.id,
      headBranch: branch,
      state: 'open',
      isAgentPR: true,
    },
  });

  if (agentPRs.length === 0) return;

  // Process new commits from the push
  const pushCommits = (payload.commits ?? []) as WebhookPayload[];

  for (const pr of agentPRs) {
    for (const commitData of pushCommits) {
      const commitInfo: CommitInfo = {
        sha: commitData.id,
        message: commitData.message,
        authorLogin: commitData.author?.username ?? commitData.author?.name ?? 'unknown',
        authorEmail: commitData.author?.email,
      };

      const detection = detectAgentCommit(commitInfo);

      await prisma.gitHubCommit.upsert({
        where: { sha: commitData.id },
        create: {
          prId: pr.id,
          sha: commitData.id,
          authorLogin: commitInfo.authorLogin,
          authorEmail: commitInfo.authorEmail ?? null,
          message: commitData.message,
          isAgent: detection.isAgent,
          detectionMode: detection.detectionMode ?? null,
          linesAdded: (commitData.added as string[])?.length ?? 0,
          linesRemoved: (commitData.removed as string[])?.length ?? 0,
          createdAt: new Date(commitData.timestamp),
        },
        update: {},
      });
    }

    // Record push event
    await prisma.gitHubPREvent.create({
      data: {
        prId: pr.id,
        eventType: 'push',
        actorLogin: (payload.pusher as WebhookPayload)?.name ?? 'unknown',
        payload: JSON.stringify({
          ref,
          commitCount: pushCommits.length,
          headCommit: (payload.head_commit as WebhookPayload)?.id,
        }),
        createdAt: new Date(),
      },
    });

    // Update PR head SHA
    const headSha = (payload.head_commit as WebhookPayload)?.id as string | undefined;
    if (headSha) {
      await prisma.gitHubPR.update({
        where: { id: pr.id },
        data: { headSha },
      });
    }

    if (installation?.id) {
      await recomputeAttribution(pr.id, installation.id);
    }
  }
}

async function handleCheckRun(payload: WebhookPayload): Promise<void> {
  const checkRun = payload.check_run as WebhookPayload;
  const repoData = payload.repository as WebhookPayload;
  const installation = payload.installation as WebhookPayload;

  // Skip our own check runs to avoid infinite loops
  if (checkRun.name === 'Wooblay Attribution') return;

  const repo = await prisma.gitHubRepo.findUnique({
    where: { fullName: repoData.full_name },
  });
  if (!repo) return;

  // Find PRs associated with this check run's head SHA
  const prs = await prisma.gitHubPR.findMany({
    where: {
      repoId: repo.id,
      headSha: checkRun.head_sha,
      isAgentPR: true,
    },
  });

  for (const pr of prs) {
    await prisma.gitHubCheckResult.create({
      data: {
        prId: pr.id,
        checkName: checkRun.name,
        status: checkRun.status,
        conclusion: checkRun.conclusion ?? null,
        startedAt: checkRun.started_at ? new Date(checkRun.started_at) : null,
        completedAt: checkRun.completed_at ? new Date(checkRun.completed_at) : null,
      },
    });

    await prisma.gitHubPREvent.create({
      data: {
        prId: pr.id,
        eventType: 'check_run',
        actorLogin: checkRun.app?.slug ?? 'github-actions',
        payload: JSON.stringify({
          name: checkRun.name,
          status: checkRun.status,
          conclusion: checkRun.conclusion,
        }),
        createdAt: new Date(),
      },
    });

    if (installation?.id) {
      await recomputeAttribution(pr.id, installation.id);
    }
  }
}

async function handleWorkflowRun(payload: WebhookPayload): Promise<void> {
  const workflowRun = payload.workflow_run as WebhookPayload;
  const repoData = payload.repository as WebhookPayload;
  const installation = payload.installation as WebhookPayload;

  const repo = await prisma.gitHubRepo.findUnique({
    where: { fullName: repoData.full_name },
  });
  if (!repo) return;

  const prs = await prisma.gitHubPR.findMany({
    where: {
      repoId: repo.id,
      headSha: workflowRun.head_sha,
      isAgentPR: true,
    },
  });

  for (const pr of prs) {
    await prisma.gitHubCheckResult.create({
      data: {
        prId: pr.id,
        checkName: workflowRun.name,
        status: workflowRun.status,
        conclusion: workflowRun.conclusion ?? null,
        startedAt: workflowRun.run_started_at ? new Date(workflowRun.run_started_at) : null,
        completedAt: workflowRun.updated_at ? new Date(workflowRun.updated_at) : null,
      },
    });

    await prisma.gitHubPREvent.create({
      data: {
        prId: pr.id,
        eventType: 'workflow_run',
        actorLogin: workflowRun.actor?.login ?? 'github-actions',
        payload: JSON.stringify({
          name: workflowRun.name,
          status: workflowRun.status,
          conclusion: workflowRun.conclusion,
          workflow: workflowRun.path,
        }),
        createdAt: new Date(),
      },
    });

    if (installation?.id) {
      await recomputeAttribution(pr.id, installation.id);
    }
  }
}

async function handleIssueComment(payload: WebhookPayload): Promise<void> {
  const comment = payload.comment as WebhookPayload;
  const issue = payload.issue as WebhookPayload;
  const repoData = payload.repository as WebhookPayload;

  // Only process PR comments (issues have pull_request field when they're PRs)
  if (!issue.pull_request) return;

  const repo = await prisma.gitHubRepo.findUnique({
    where: { fullName: repoData.full_name },
  });
  if (!repo) return;

  const pr = await prisma.gitHubPR.findUnique({
    where: { repoId_number: { repoId: repo.id, number: issue.number } },
  });
  if (!pr) return;

  // Record event
  await prisma.gitHubPREvent.create({
    data: {
      prId: pr.id,
      eventType: 'comment',
      actorLogin: comment.user.login,
      payload: JSON.stringify({
        body: comment.body,
        action: payload.action,
      }),
      createdAt: new Date(comment.created_at),
    },
  });

  // Check for task-link command: /wooblay link <taskId>
  const taskId = extractTaskIdFromComment(comment.body as string);
  if (taskId) {
    await prisma.gitHubTaskLink.upsert({
      where: { taskId_prId: { taskId, prId: pr.id } },
      create: { taskId, prId: pr.id },
      update: {},
    });

    // Recompute attribution to include receipt coverage
    const installation = payload.installation as WebhookPayload;
    if (pr.isAgentPR && installation?.id) {
      await recomputeAttribution(pr.id, installation.id);
    }
  }
}

// ── Route registration ───────────────────────────────────────────────────────

export async function githubWebhookRoutes(app: FastifyInstance): Promise<void> {
  // We need raw body access for signature verification
  app.addContentTypeParser(
    'application/json',
    { parseAs: 'string' },
    (_req, body, done) => {
      try {
        done(null, JSON.parse(body as string));
      } catch (err) {
        done(err as Error);
      }
    },
  );

  app.post(
    '/github/webhook',
    {
      config: { rawBody: true },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const signature = request.headers['x-hub-signature-256'] as string | undefined;
      const event = request.headers['x-github-event'] as string | undefined;
      const deliveryId = request.headers['x-github-delivery'] as string | undefined;

      // Verify webhook signature
      if (!config.GITHUB_WEBHOOK_SECRET) {
        request.log.warn('GITHUB_WEBHOOK_SECRET not configured, skipping signature verification');
      } else {
        const rawBody = JSON.stringify(request.body);
        const isValid = verifyWebhookSignature(rawBody, signature, config.GITHUB_WEBHOOK_SECRET);
        if (!isValid) {
          return reply.code(401).send({ error: 'Invalid webhook signature' });
        }
      }

      if (!event) {
        return reply.code(400).send({ error: 'Missing x-github-event header' });
      }

      const payload = request.body as WebhookPayload;
      request.log.info({ event, action: payload.action, delivery: deliveryId }, 'GitHub webhook received');

      try {
        switch (event) {
          case 'installation':
            await handleInstallation(payload);
            break;
          case 'installation_repositories':
            await handleInstallationRepositories(payload);
            break;
          case 'pull_request':
            await handlePullRequest(payload);
            break;
          case 'pull_request_review':
            await handlePullRequestReview(payload);
            break;
          case 'push':
            await handlePush(payload);
            break;
          case 'check_run':
            await handleCheckRun(payload);
            break;
          case 'workflow_run':
            await handleWorkflowRun(payload);
            break;
          case 'issue_comment':
            await handleIssueComment(payload);
            break;
          default:
            request.log.debug({ event }, 'Unhandled GitHub event type');
        }

        return reply.code(200).send({ ok: true });
      } catch (err) {
        request.log.error(err, 'Error processing GitHub webhook');
        return reply.code(500).send({ error: 'Internal server error' });
      }
    },
  );
}
