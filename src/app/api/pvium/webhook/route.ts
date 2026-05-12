import { NextRequest, NextResponse } from "next/server";
import { verifyPviumWebhookToken } from '@pvium/sdk';
import { prisma } from "@/lib/db/prisma";
import { createIssueComment } from "@/lib/github/client";
import {
  invoiceCreatedMessage,
  invoicePaidMessage,
} from "@/lib/github/messages";
import {
  createRewardInvoice,
  getPviumAccessTokenExpiresAt,
} from "@/lib/pvium/client";

type PviumWebhookPayload = {
  event?: string;
  type?: string;
  token?: string;
  data?: Record<string, unknown>;
};

export async function POST(request: NextRequest) {
  const requestId = crypto.randomUUID();

  console.log('[pvium-webhook] received', {
    requestId,
    contentType: request.headers.get('content-type'),
    userAgent: request.headers.get('user-agent'),
    forwardedFor: request.headers.get('x-forwarded-for'),
  });

  let body: PviumWebhookPayload;
  try {
    body = (await request.json()) as PviumWebhookPayload;
  } catch (error) {
    console.error('[pvium-webhook] invalid JSON body', {
      requestId,
      error: error instanceof Error ? error.message : String(error),
    });

    return NextResponse.json(
      { error: 'Invalid Pvium webhook JSON body' },
      { status: 400 },
    );
  }

  console.log('[pvium-webhook] parsed body', {
    requestId,
    event: body.event,
    type: body.type,
    hasToken: Boolean(body.token),
    tokenSummary: summarizeToken(body.token),
    dataKeys: keysOf(body.data),
  });

  const resolved = verifyAndResolveWebhookPayload(body);

  if (!resolved.ok) {
    console.error('[pvium-webhook] verification failed', {
      requestId,
      event: body.event,
      type: body.type,
      hasToken: Boolean(body.token),
      error: resolved.error,
    });

    return NextResponse.json({ error: resolved.error }, { status: 401 });
  }

  const { event, data } = resolved;

  console.log('[pvium-webhook] verification passed', {
    requestId,
    event,
    dataKeys: keysOf(data),
  });

  if (event === "oauth.invite.accepted") {
    console.log('[pvium-webhook] handling invite accepted', { requestId });
    return handleInviteAccepted(data);
  }

  if (
    event === "invoice.paid" ||
    event === "invoice.payment_completed" ||
    event === "invoice.payment.succeeded" ||
    event === "batch.funded" ||
    event === "batch.payment_completed" ||
    event === "batch.payment.succeeded"
  ) {
    console.log('[pvium-webhook] handling reward payment paid', {
      requestId,
      event,
    });
    return handleRewardPaymentPaid(data);
  }

  console.log('[pvium-webhook] ignored event', { requestId, event });
  return NextResponse.json({ ok: true, ignored: true });
}

function verifyAndResolveWebhookPayload(
  body: PviumWebhookPayload,
):
  | { ok: true; event: string | undefined; data: Record<string, unknown> }
  | { ok: false; error: string } {
  if (!body.token) {
    console.log('[pvium-webhook] unsigned payload', {
      event: body.event,
      type: body.type,
      dataKeys: keysOf(body.data),
    });

    return {
      ok: true,
      event: body.event ?? body.type,
      data: body.data ?? {},
    };
  }

  const secret = process.env.PVIUM_WEBHOOK_SECRET;
  if (!secret) {
    console.error('[pvium-webhook] missing PVIUM_WEBHOOK_SECRET');
    return { ok: false, error: "Pvium webhook secret is not configured" };
  }

  try {
    const tokenPayload = verifyPviumWebhookToken<Record<string, unknown>>(
      body.token,
      secret,
      {
        expectedEvent: body.event,
      },
    );

    console.log('[pvium-webhook] token verified', {
      bodyEvent: body.event,
      bodyType: body.type,
      tokenEvent: tokenPayload.event,
      tokenExp: tokenPayload.exp,
      tokenDataKeys: keysOf(tokenPayload.data),
    });

    return {
      ok: true,
      event: tokenPayload.event ?? body.event ?? body.type,
      data: tokenPayload.data ?? {},
    };
  } catch (error) {
    console.error('[pvium-webhook] token verification error', {
      bodyEvent: body.event,
      bodyType: body.type,
      error: error instanceof Error ? error.message : String(error),
    });

    return {
      ok: false,
      error:
        error instanceof Error ? error.message : 'Invalid Pvium webhook token',
    };
  }
}

async function handleInviteAccepted(data: Record<string, unknown>) {
  const user = recordFrom(data.user);
  const authorization = recordFrom(data.authorization);
  const githubLogin = stringFrom(
    data.githubLogin ?? data.github_login ?? user?.githubLogin,
  );
  const accessToken = stringFrom(data.accessToken ?? data.access_token);
  const refreshToken = stringFrom(data.refreshToken ?? data.refresh_token);
  const tokenType = stringFrom(
    data.tokenType ?? data.token_type ?? authorization?.tokenType,
  );
  const expiresIn = numberFrom(
    data.expiresIn ?? data.expires_in ?? authorization?.expiresIn,
  );
  const expiresAt = dateLikeFrom(
    data.expiresAt ?? data.expires_at ?? authorization?.expiresAt,
  );
  const pviumUserId = stringFrom(
    data.pviumUserId ?? data.pvium_user_id ?? user?.id,
  );
  const pviumUser = user || undefined;

  if (!githubLogin) {
    console.error('[pvium-webhook] invite accepted missing GitHub login', {
      dataKeys: keysOf(data),
      userKeys: keysOf(user),
    });

    return NextResponse.json(
      { error: "Missing GitHub login in Pvium webhook payload" },
      { status: 400 },
    );
  }
  if (!pviumUserId) {
    console.error('[pvium-webhook] invite accepted missing Pvium user id', {
      githubLogin,
      dataKeys: keysOf(data),
      userKeys: keysOf(user),
    });

    return NextResponse.json(
      { error: "Missing Pvium user id in Pvium webhook payload" },
      { status: 400 },
    );
  }

  console.log('[pvium-webhook] upserting GitHub user link', {
    githubLogin,
    pviumUserId,
    hasAccessToken: Boolean(accessToken),
    hasRefreshToken: Boolean(refreshToken),
    expiresIn,
    expiresAt,
  });
  

  const link = await prisma.githubUserLink.upsert({
    where: { githubLogin },
    update: {
      githubUserId: bigintFrom(
        data.githubUserId ?? data.github_user_id ?? user?.githubUserId,
      ),
      pviumUserId,
      pviumHandle: stringFrom(
        data.pviumHandle ?? data.pvium_handle ?? user?.handle,
      ),
      ...(accessToken
        ? {
            pviumAccessToken: accessToken,
            pviumRefreshToken: refreshToken,
            pviumTokenType: tokenType,
            pviumAccessTokenExpiresAt: getPviumAccessTokenExpiresAt({
              expiresIn,
              expiresAt,
            }),
          }
        : {}),
    },
    create: {
      githubLogin,
      githubUserId: bigintFrom(
        data.githubUserId ?? data.github_user_id ?? user?.githubUserId,
      ),
      pviumUserId,
      pviumHandle: stringFrom(
        data.pviumHandle ?? data.pvium_handle ?? user?.handle,
      ),
      pviumAccessToken: accessToken,
      pviumRefreshToken: refreshToken,
      pviumTokenType: tokenType,
      pviumAccessTokenExpiresAt: getPviumAccessTokenExpiresAt({
        expiresIn,
        expiresAt,
      }),
    },
  });

  const processedRewards = accessToken
      ? await createPendingInvoicesForGithubUser({
          githubLogin,
          accessToken,
          githubUserLinkId: link.id,
          pviumUser,
        })
    : 0;

  console.log('[pvium-webhook] invite accepted processed', {
    githubLogin,
    githubUserLinkId: link.id,
    processedRewards,
  });

  return NextResponse.json({
    ok: true,
    linked: githubLogin,
    processedRewards,
  });
}

async function createPendingInvoicesForGithubUser(params: {
  githubLogin: string;
  accessToken: string;
  githubUserLinkId: string;
  pviumUser?: Record<string, unknown>;
}) {
  const pendingRewards = await prisma.rewardAttempt.findMany({
    where: {
      solverGithubLogin: params.githubLogin,
      status: "WAITING_FOR_ACCEPTANCE",
    },
    include: {
      bounty: {
        include: {
          repository: true,
        },
      },
    },
  });

  console.log('[pvium-webhook] pending rewards found', {
    githubLogin: params.githubLogin,
    count: pendingRewards.length,
  });

  for (const reward of pendingRewards) {
    console.log('[pvium-webhook] creating payment link for pending reward', {
      rewardAttemptId: reward.id,
      bountyId: reward.bountyId,
      githubLogin: params.githubLogin,
      amount: reward.bounty.amount.toString(),
      currency: reward.bounty.currency,
      repository: `${reward.bounty.repository.owner}/${reward.bounty.repository.repo}`,
      pullRequestNumber: reward.pullRequestNumber,
    });

    const invoice = await createRewardInvoice({
      amount: Number(reward.bounty.amount),
      currency: reward.bounty.currency,
      title: `Pvium GitHub reward for ${reward.bounty.repository.owner}/${reward.bounty.repository.repo}#${reward.pullRequestNumber}`,
      description: `Reward for @${params.githubLogin} after merged PR #${reward.pullRequestNumber}.`,
      githubLogin: params.githubLogin,
      accessToken: params.accessToken,
      pviumUser: params.pviumUser,
    });
    console.log('[pvium-webhook] payment link created', params.pviumUser);

    await prisma.rewardAttempt.update({
      where: { id: reward.id },
      data: {
        githubUserLinkId: params.githubUserLinkId,
        pviumInvoiceId: invoice.id,
        pviumInvoiceUrl: invoice.url,
        status: "INVOICE_CREATED",
        error: null,
      },
    });

    await prisma.bounty.update({
      where: { id: reward.bountyId },
      data: { status: "INVOICE_CREATED" },
    });

    await createIssueComment({
      installationId: reward.bounty.repository.installationId,
      owner: reward.bounty.repository.owner,
      repo: reward.bounty.repository.repo,
      issueNumber: reward.pullRequestNumber,
      body: invoiceCreatedMessage({
        githubLogin: params.githubLogin,
        invoiceUrl: invoice.url,
        amount: reward.bounty.amount.toString(),
        currency: reward.bounty.currency,
      }),
    });

    console.log('[pvium-webhook] pending reward updated', {
      rewardAttemptId: reward.id,
      invoiceId: invoice.id,
      hasInvoiceUrl: Boolean(invoice.url),
    });
  }

  return pendingRewards.length;
}

async function handleRewardPaymentPaid(data: Record<string, unknown>) {
  const invoice = recordFrom(data.invoice);
  const batch = recordFrom(data.batch ?? data.payout);
  const invoiceId = stringFrom(
    data.id ??
      data.invoiceId ??
      data.invoice_id ??
      data.batchId ??
      data.batch_id ??
      data.payoutId ??
      data.payout_id ??
      invoice?.id ??
      invoice?._id ??
      batch?.id ??
      batch?._id,
  );
  const invoiceCode = stringFrom(
    data.code ??
      data.invoiceCode ??
      data.invoice_code ??
      data.batchCode ??
      data.batch_code ??
      invoice?.code ??
      batch?.code,
  );

  if (!invoiceId && !invoiceCode) {
    console.error('[pvium-webhook] payment webhook missing id/code', {
      dataKeys: keysOf(data),
      invoiceKeys: keysOf(invoice),
      batchKeys: keysOf(batch),
    });

    return NextResponse.json(
      { error: "Missing payment id or code in Pvium webhook payload" },
      { status: 400 },
    );
  }

  console.log('[pvium-webhook] looking up reward payment', {
    invoiceId,
    invoiceCode,
  });

  const reward = await prisma.rewardAttempt.findFirst({
    where: {
      OR: [
        ...(invoiceId ? [{ pviumInvoiceId: invoiceId }] : []),
        ...(invoiceCode ? [{ pviumInvoiceId: invoiceCode }] : []),
      ],
      status: "INVOICE_CREATED",
    },
    include: {
      bounty: {
        include: {
          repository: true,
        },
      },
    },
  });

  if (!reward) {
    console.log('[pvium-webhook] no matching reward payment found', {
      invoiceId,
      invoiceCode,
    });

    return NextResponse.json({ ok: true, ignored: true });
  }

  console.log('[pvium-webhook] marking reward paid', {
    rewardAttemptId: reward.id,
    bountyId: reward.bountyId,
    invoiceId,
    invoiceCode,
  });

  await prisma.rewardAttempt.update({
    where: { id: reward.id },
    data: { status: "PAID" },
  });

  await prisma.bounty.update({
    where: { id: reward.bountyId },
    data: { status: "PAID" },
  });

  await createIssueComment({
    installationId: reward.bounty.repository.installationId,
    owner: reward.bounty.repository.owner,
    repo: reward.bounty.repository.repo,
    issueNumber: reward.pullRequestNumber,
    body: invoicePaidMessage({
      githubLogin: reward.solverGithubLogin,
      amount: reward.bounty.amount.toString(),
      currency: reward.bounty.currency,
    }),
  });

  return NextResponse.json({ ok: true, paidReward: reward.id });
}

function summarizeToken(token: string | undefined) {
  if (!token) return undefined;
  const parts = token.split('.');
  return {
    parts: parts.length,
    length: token.length,
    prefix: token.slice(0, 12),
    suffix: token.slice(-8),
  };
}

function keysOf(value: unknown) {
  return value && typeof value === 'object' ? Object.keys(value) : [];
}

function stringFrom(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function dateLikeFrom(value: unknown) {
  if (value instanceof Date) return value;
  if (typeof value === 'string' && value.trim()) return value.trim();
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  return undefined;
}

function bigintFrom(value: unknown) {
  if (typeof value === "bigint") return value;
  if (typeof value === "number" && Number.isInteger(value))
    return BigInt(value);
  if (typeof value === "string" && /^\d+$/.test(value)) return BigInt(value);
  return undefined;
}

function recordFrom(value: unknown) {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : undefined;
}

function numberFrom(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (
    typeof value === "string" &&
    value.trim() &&
    Number.isFinite(Number(value))
  ) {
    return Number(value);
  }
  return undefined;
}
