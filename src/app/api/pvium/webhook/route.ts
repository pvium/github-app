import { NextRequest, NextResponse } from "next/server";
import { createHmac, timingSafeEqual } from "node:crypto";
import { prisma } from "@/lib/db/prisma";
import { createIssueComment } from "@/lib/github/client";
import {
  invoiceCreatedMessage,
  invoicePaidMessage,
} from "@/lib/github/messages";
import { normalizeGithubLogin } from "@/lib/github/login";
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

type PviumSignedWebhookToken = {
  event?: string;
  data?: Record<string, unknown>;
};

export async function POST(request: NextRequest) {
  const body = (await request.json()) as PviumWebhookPayload;
  const resolved = verifyAndResolveWebhookPayload(body);

  if (!resolved.ok) {
    return NextResponse.json({ error: resolved.error }, { status: 401 });
  }

  const { event, data } = resolved;

  if (event === "oauth.invite.accepted") {
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
    return handleRewardPaymentPaid(data);
  }

  return NextResponse.json({ ok: true, ignored: true });
}

function verifyAndResolveWebhookPayload(
  body: PviumWebhookPayload,
):
  | { ok: true; event: string | undefined; data: Record<string, unknown> }
  | { ok: false; error: string } {
  if (!body.token) {
    return {
      ok: true,
      event: body.event ?? body.type,
      data: body.data ?? {},
    };
  }

  const secret = process.env.PVIUM_WEBHOOK_SECRET;
  if (!secret) {
    return { ok: false, error: "Pvium webhook secret is not configured" };
  }

  const decoded = verifyWebhookToken(body.token, secret);
  if (!decoded) {
    return { ok: false, error: "Invalid Pvium webhook token" };
  }

  const event = decoded.event ?? body.event ?? body.type;
  if (body.event && decoded.event && body.event !== decoded.event) {
    return { ok: false, error: "Pvium webhook event mismatch" };
  }

  return {
    ok: true,
    event,
    data: decoded.data ?? {},
  };
}

function verifyWebhookToken(
  token: string,
  secret: string,
): PviumSignedWebhookToken | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;

  const [encodedHeader, encodedPayload, encodedSignature] = parts;
  const header = parseBase64UrlJson(encodedHeader);
  if (!header || header.alg !== "HS256") return null;

  const expectedSignature = createHmac("sha256", secret)
    .update(`${encodedHeader}.${encodedPayload}`)
    .digest("base64url");

  if (!safeEqual(encodedSignature, expectedSignature)) return null;

  const payload = parseBase64UrlJson(encodedPayload);
  if (!payload) return null;

  if (
    typeof payload.exp === "number" &&
    Math.floor(Date.now() / 1000) >= payload.exp
  ) {
    return null;
  }

  return payload as PviumSignedWebhookToken;
}

function parseBase64UrlJson(value: string): Record<string, unknown> | null {
  try {
    return JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
  } catch {
    return null;
  }
}

function safeEqual(a: string, b: string) {
  const aBuffer = Buffer.from(a);
  const bBuffer = Buffer.from(b);
  return aBuffer.length === bBuffer.length && timingSafeEqual(aBuffer, bBuffer);
}

async function handleInviteAccepted(data: Record<string, unknown>) {
  const user = recordFrom(data.user);
  const authorization = recordFrom(data.authorization);
  const githubLogin = normalizeGithubLogin(
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
  const pviumUserId = stringFrom(
    data.pviumUserId ?? data.pvium_user_id ?? user?.id,
  );
  const pviumUser = user || undefined;

  if (!githubLogin) {
    return NextResponse.json(
      { error: "Missing GitHub login in Pvium webhook payload" },
      { status: 400 },
    );
  }
  if (!pviumUserId) {
    return NextResponse.json(
      { error: "Missing Pvium user id in Pvium webhook payload" },
      { status: 400 },
    );
  }

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
            pviumAccessTokenExpiresAt: getPviumAccessTokenExpiresAt(expiresIn),
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
      pviumAccessTokenExpiresAt: getPviumAccessTokenExpiresAt(expiresIn),
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
      solverGithubLogin: {
        equals: params.githubLogin,
        mode: "insensitive",
      },
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

  for (const reward of pendingRewards) {
    const invoice = await createRewardInvoice({
      amount: Number(reward.bounty.amount),
      currency: reward.bounty.currency,
      title: `Pvium GitHub reward for ${reward.bounty.repository.owner}/${reward.bounty.repository.repo}#${reward.pullRequestNumber}`,
      description: `Reward for @${params.githubLogin} after merged PR #${reward.pullRequestNumber}.`,
      githubLogin: params.githubLogin,
      accessToken: params.accessToken,
      pviumUser: params.pviumUser,
    });

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
    return NextResponse.json(
      { error: "Missing payment id or code in Pvium webhook payload" },
      { status: 400 },
    );
  }

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
    return NextResponse.json({ ok: true, ignored: true });
  }

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

function stringFrom(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
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
