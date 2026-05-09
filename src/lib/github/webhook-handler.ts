import { prisma } from "@/lib/db/prisma";
import { getEnv } from "@/lib/config/env";
import { parseBountyLabel } from "@/lib/github/bounty-label";
import { createIssueComment } from "@/lib/github/client";
import {
  bountyRegisteredMessage,
  inviteRequiredMessage,
  invoiceCreatedMessage,
} from "@/lib/github/messages";
import { extractLinkedIssueNumbers } from "@/lib/github/linked-issues";
import {
  createGithubInviteLink,
  createRewardInvoice,
  getPviumAccessTokenExpiresAt,
  refreshPviumAccessToken,
} from "@/lib/pvium/client";

type GithubWebhookPayload = Record<string, any>;

export async function handleGithubWebhook(params: {
  event: string;
  deliveryId: string;
  payload: GithubWebhookPayload;
}) {
  const action = params.payload.action;
  const pullRequest = params.payload.pull_request;

  console.log("[github-webhook] received", {
    deliveryId: params.deliveryId,
    event: params.event,
    action,
    repository: params.payload.repository?.full_name,
    sender: params.payload.sender?.login,
    issueNumber: params.payload.issue?.number,
    pullRequestNumber: pullRequest?.number,
    pullRequestMerged: pullRequest?.merged,
    pullRequestBaseBranch: pullRequest?.base?.ref,
    pullRequestHeadBranch: pullRequest?.head?.ref,
  });

  await prisma.webhookDelivery.upsert({
    where: { id: params.deliveryId },
    update: {},
    create: {
      id: params.deliveryId,
      event: params.event,
      action,
      repository: params.payload.repository?.full_name,
      sender: params.payload.sender?.login,
    },
  });

  if (params.event === "issues" && action === "labeled") {
    return handleIssueLabeled(params.payload);
  }

  if (params.event === "pull_request" && action === "closed") {
    return handlePullRequestClosed(params.payload);
  }

  console.log("[github-webhook] ignored unsupported event/action", {
    deliveryId: params.deliveryId,
    event: params.event,
    action,
  });

  return { ignored: true };
}

async function upsertRepository(payload: GithubWebhookPayload) {
  const repository = payload.repository;
  const installationId = payload.installation?.id;

  if (!repository || !installationId) {
    throw new Error("Webhook payload missing repository or installation");
  }

  return prisma.repositoryInstallation.upsert({
    where: {
      owner_repo: {
        owner: repository.owner.login,
        repo: repository.name,
      },
    },
    update: {
      installationId,
      githubNodeId: repository.node_id,
    },
    create: {
      installationId,
      owner: repository.owner.login,
      repo: repository.name,
      githubNodeId: repository.node_id,
    },
  });
}

async function handleIssueLabeled(payload: GithubWebhookPayload) {
  const parsed = parseBountyLabel(payload.label?.name ?? "");
  if (!parsed) {
    console.log("[github-webhook] ignored issue label", {
      repository: payload.repository?.full_name,
      issueNumber: payload.issue?.number,
      label: payload.label?.name,
      reason: "Label is not a Pvium bounty label",
    });

    return { ignored: true };
  }

  const repository = await upsertRepository(payload);
  const bounty = await prisma.bounty.upsert({
    where: {
      repositoryId_issueNumber_labelName: {
        repositoryId: repository.id,
        issueNumber: payload.issue.number,
        labelName: parsed.raw,
      },
    },
    update: {
      amount: parsed.amount,
      currency: parsed.currency,
      status: "OPEN",
    },
    create: {
      repositoryId: repository.id,
      issueNumber: payload.issue.number,
      issueNodeId: payload.issue.node_id,
      labelName: parsed.raw,
      amount: parsed.amount,
      currency: parsed.currency,
    },
  });

  await createIssueComment({
    installationId: repository.installationId,
    owner: repository.owner,
    repo: repository.repo,
    issueNumber: payload.issue.number,
    body: bountyRegisteredMessage({
      amount: bounty.amount.toString(),
      currency: bounty.currency,
      issueNumber: bounty.issueNumber,
    }),
  });

  console.log("[github-webhook] bounty registered", {
    repository: payload.repository?.full_name,
    issueNumber: bounty.issueNumber,
    label: bounty.labelName,
    amount: bounty.amount.toString(),
    currency: bounty.currency,
  });

  return { bountyId: bounty.id };
}

async function handlePullRequestClosed(payload: GithubWebhookPayload) {
  const env = getEnv();
  const pullRequest = payload.pull_request;
  if (!pullRequest?.merged) {
    console.log("[github-webhook] ignored pull_request.closed", {
      repository: payload.repository?.full_name,
      pullRequestNumber: pullRequest?.number,
      baseBranch: pullRequest?.base?.ref,
      headBranch: pullRequest?.head?.ref,
      merged: pullRequest?.merged,
      reason: "Pull request was closed without merge",
    });

    return { ignored: true };
  }

  const targetBranches = env.GITHUB_REWARD_TARGET_BRANCHES.split(",")
    .map((branch) => branch.trim())
    .filter(Boolean);

  console.log("[github-webhook] pull_request.closed branch check", {
    repository: payload.repository?.full_name,
    pullRequestNumber: pullRequest.number,
    baseBranch: pullRequest.base?.ref,
    headBranch: pullRequest.head?.ref,
    targetBranches,
  });

  if (!targetBranches.includes(pullRequest.base?.ref)) {
    console.log("[github-webhook] ignored pull_request.closed", {
      repository: payload.repository?.full_name,
      pullRequestNumber: pullRequest.number,
      baseBranch: pullRequest.base?.ref,
      targetBranches,
      reason: "Pull request target branch is not configured for rewards",
    });

    return {
      ignored: true,
      reason: "Pull request target branch is not configured for rewards",
      branch: pullRequest.base?.ref,
      targetBranches,
    };
  }

  const repository = await upsertRepository(payload);
  const linkedIssues = extractLinkedIssueNumbers(
    pullRequest.title,
    pullRequest.body,
  );

  console.log("[github-webhook] pull_request.closed linked issue check", {
    repository: payload.repository?.full_name,
    pullRequestNumber: pullRequest.number,
    linkedIssues,
  });

  if (!linkedIssues.length) {
    console.log("[github-webhook] ignored pull_request.closed", {
      repository: payload.repository?.full_name,
      pullRequestNumber: pullRequest.number,
      reason: "No closing issue references found",
    });

    return { ignored: true, reason: "No closing issue references found" };
  }

  const bounties = await prisma.bounty.findMany({
    where: {
      repositoryId: repository.id,
      issueNumber: { in: linkedIssues },
      status: "OPEN",
    },
  });

  console.log("[github-webhook] pull_request.closed bounty lookup", {
    repository: payload.repository?.full_name,
    pullRequestNumber: pullRequest.number,
    linkedIssues,
    openBountiesFound: bounties.length,
  });

  for (const bounty of bounties) {
    await processRewardForBounty({
      repository,
      bounty,
      pullRequest,
    });
  }

  console.log("[github-webhook] pull_request.closed processed", {
    repository: payload.repository?.full_name,
    pullRequestNumber: pullRequest.number,
    processedBounties: bounties.length,
  });

  return { processed: bounties.length };
}

async function processRewardForBounty(params: {
  repository: Awaited<ReturnType<typeof upsertRepository>>;
  bounty: any;
  pullRequest: any;
}) {
  const solverLogin = params.pullRequest.user.login;
  const solverGithubUserId = params.pullRequest.user.id;

  const githubUserLink = await prisma.githubUserLink.findFirst({
    where: {
      OR: [{ githubLogin: solverLogin }, { githubUserId: solverGithubUserId }],
    },
  });

  const savedAccessToken = githubUserLink
    ? await getUsablePviumAccessToken(githubUserLink)
    : null;

  console.log("[github-webhook] processing reward", {
    repository: `${params.repository.owner}/${params.repository.repo}`,
    issueNumber: params.bounty.issueNumber,
    pullRequestNumber: params.pullRequest.number,
    solverLogin,
    hasGithubUserLink: Boolean(githubUserLink),
    hasUsablePviumAccessToken: Boolean(savedAccessToken),
  });

  const reward = await prisma.rewardAttempt.upsert({
    where: {
      bountyId_pullRequestNumber_solverGithubLogin: {
        bountyId: params.bounty.id,
        pullRequestNumber: params.pullRequest.number,
        solverGithubLogin: solverLogin,
      },
    },
    update: {},
    create: {
      bountyId: params.bounty.id,
      githubUserLinkId: githubUserLink?.id,
      pullRequestNumber: params.pullRequest.number,
      pullRequestNodeId: params.pullRequest.node_id,
      solverGithubLogin: solverLogin,
      solverGithubUserId,
      status: savedAccessToken ? "INVOICE_CREATED" : "PENDING_INVITE",
    },
  });

  if (!savedAccessToken) {
    const inviteLink = await createGithubInviteLink({
      githubLogin: solverLogin,
      rewardAttemptId: reward.id,
    });
    await prisma.rewardAttempt.update({
      where: { id: reward.id },
      data: {
        pviumInviteLink: inviteLink,
        status: "WAITING_FOR_ACCEPTANCE",
      },
    });

    await createIssueComment({
      installationId: params.repository.installationId,
      owner: params.repository.owner,
      repo: params.repository.repo,
      issueNumber: params.pullRequest.number,
      body: inviteRequiredMessage({
        githubLogin: solverLogin,
        inviteLink,
        amount: params.bounty.amount.toString(),
        currency: params.bounty.currency,
      }),
    });

    console.log("[github-webhook] invite comment posted", {
      repository: `${params.repository.owner}/${params.repository.repo}`,
      issueNumber: params.bounty.issueNumber,
      pullRequestNumber: params.pullRequest.number,
      solverLogin,
      rewardAttemptId: reward.id,
    });

    return;
  }

  const invoice = await createRewardInvoice({
    amount: Number(params.bounty.amount),
    currency: params.bounty.currency,
    title: `Pvium GitHub reward for ${params.repository.owner}/${params.repository.repo}#${params.pullRequest.number}`,
    description: `Reward for @${solverLogin} after merged PR #${params.pullRequest.number}.`,
    githubLogin: solverLogin,
    accessToken: savedAccessToken,
  });

  await prisma.rewardAttempt.update({
    where: { id: reward.id },
    data: {
      githubUserLinkId: githubUserLink?.id,
      pviumInvoiceId: invoice.id,
      pviumInvoiceUrl: invoice.url,
      status: "INVOICE_CREATED",
    },
  });

  await prisma.bounty.update({
    where: { id: params.bounty.id },
    data: { status: "INVOICE_CREATED" },
  });

  await createIssueComment({
    installationId: params.repository.installationId,
    owner: params.repository.owner,
    repo: params.repository.repo,
    issueNumber: params.pullRequest.number,
    body: invoiceCreatedMessage({
      githubLogin: solverLogin,
      invoiceUrl: invoice.url,
      amount: params.bounty.amount.toString(),
      currency: params.bounty.currency,
    }),
  });

  console.log("[github-webhook] payment link comment posted", {
    repository: `${params.repository.owner}/${params.repository.repo}`,
    issueNumber: params.bounty.issueNumber,
    pullRequestNumber: params.pullRequest.number,
    solverLogin,
    rewardAttemptId: reward.id,
    paymentId: invoice.id,
  });
}

async function getUsablePviumAccessToken(githubUserLink: {
  id: string;
  pviumAccessToken?: string | null;
  pviumRefreshToken?: string | null;
  pviumAccessTokenExpiresAt?: Date | null;
}) {
  if (!githubUserLink.pviumAccessToken) return null;

  const refreshBufferMs = 60_000;
  const expiresAt = githubUserLink.pviumAccessTokenExpiresAt?.getTime();
  if (!expiresAt || expiresAt - refreshBufferMs > Date.now()) {
    return githubUserLink.pviumAccessToken;
  }

  if (!githubUserLink.pviumRefreshToken) return null;

  let refreshed: Awaited<ReturnType<typeof refreshPviumAccessToken>>;
  try {
    refreshed = await refreshPviumAccessToken(githubUserLink.pviumRefreshToken);
  } catch {
    return null;
  }
  const accessToken = refreshed.data.accessToken;

  await prisma.githubUserLink.update({
    where: { id: githubUserLink.id },
    data: {
      pviumAccessToken: accessToken,
      pviumRefreshToken:
        refreshed.data.refreshToken ?? githubUserLink.pviumRefreshToken,
      pviumTokenType: refreshed.data.tokenType,
      pviumAccessTokenExpiresAt: getPviumAccessTokenExpiresAt(
        refreshed.data.expiresIn,
      ),
    },
  });

  return accessToken;
}
