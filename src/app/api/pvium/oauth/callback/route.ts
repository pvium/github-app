import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { createIssueComment } from "@/lib/github/client";
import { invoiceCreatedMessage } from "@/lib/github/messages";
import { getEnv } from "@/lib/config/env";
import { serializeError } from "@/lib/errors";
import {
  createRewardInvoice,
  exchangePviumAuthorizationCode,
  getPviumAccessTokenExpiresAt,
  getPviumUserInfo,
} from "@/lib/pvium/client";

type SocialHandle = {
  provider?: string;
  handle?: string;
};

type LinkedAccount = {
  type?: string;
  username?: string;
  login?: string;
  handle?: string;
  profile?: {
    username?: string;
    login?: string;
  };
};

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code");
  const state = request.nextUrl.searchParams.get("state");

  if (!code) {
    return NextResponse.json({ error: "Missing OAuth code" }, { status: 400 });
  }

  const stateParams = new URLSearchParams(state ?? "");
  const rewardAttemptId = stateParams.get("rewardAttemptId");
  const expectedGithubLogin = normalizeGithubLogin(stateParams.get("github"));

  if (!rewardAttemptId || !expectedGithubLogin) {
    return NextResponse.json(
      { error: "Missing reward state in OAuth callback" },
      { status: 400 },
    );
  }

  const reward = await prisma.rewardAttempt.findUnique({
    where: { id: rewardAttemptId },
    include: {
      bounty: {
        include: {
          repository: true,
        },
      },
    },
  });

  if (!reward) {
    return NextResponse.json(
      { error: "No pending reward found for OAuth callback" },
      { status: 404 },
    );
  }

  if (reward.status === "INVOICE_CREATED" && reward.pviumInvoiceUrl) {
    return NextResponse.redirect(reward.pviumInvoiceUrl);
  }

  if (reward.status !== "WAITING_FOR_ACCEPTANCE") {
    return NextResponse.json(
      { error: "Reward is not waiting for OAuth acceptance" },
      { status: 409 },
    );
  }

  if (normalizeGithubLogin(reward.solverGithubLogin) !== expectedGithubLogin) {
    return NextResponse.json(
      { error: "OAuth callback GitHub user does not match reward state" },
      { status: 400 },
    );
  }

  const env = getEnv();
  const tokenResponse = await exchangePviumAuthorizationCode({
    code,
    redirectUri: env.PVIUM_OAUTH_REDIRECT_URI,
  });
  const accessToken = tokenResponse.data.accessToken;
  const userResponse = await getPviumUserInfo(accessToken);
  const pviumUser = userResponse.data;
  const acceptedGithubLogin = getGithubLoginFromPviumUser(pviumUser);

  if (acceptedGithubLogin !== expectedGithubLogin) {
    await prisma.rewardAttempt.update({
      where: { id: reward.id },
      data: {
        error: `Pvium OAuth GitHub identity ${acceptedGithubLogin ?? "unknown"} did not match @${reward.solverGithubLogin}`,
      },
    });

    return NextResponse.json(
      { error: "Pvium OAuth GitHub identity does not match invite" },
      { status: 403 },
    );
  }

  const link = await prisma.githubUserLink.upsert({
    where: { githubLogin: reward.solverGithubLogin },
    update: {
      pviumUserId: String(pviumUser._id ?? pviumUser.id ?? ""),
      pviumAccessToken: tokenResponse.data.accessToken,
      pviumRefreshToken: tokenResponse.data.refreshToken,
      pviumTokenType: tokenResponse.data.tokenType,
      pviumAccessTokenExpiresAt: getPviumAccessTokenExpiresAt(
        tokenResponse.data,
      ),
    },
    create: {
      githubLogin: reward.solverGithubLogin,
      githubUserId: reward.solverGithubUserId,
      pviumUserId: String(pviumUser._id ?? pviumUser.id ?? ""),
      pviumAccessToken: tokenResponse.data.accessToken,
      pviumRefreshToken: tokenResponse.data.refreshToken,
      pviumTokenType: tokenResponse.data.tokenType,
      pviumAccessTokenExpiresAt: getPviumAccessTokenExpiresAt(
        tokenResponse.data,
      ),
    },
  });

  let invoice: Awaited<ReturnType<typeof createRewardInvoice>>;
  try {
    invoice = await createRewardInvoice({
      amount: Number(reward.bounty.amount),
      currency: reward.bounty.currency,
      title: `Pvium GitHub reward for ${reward.bounty.repository.owner}/${reward.bounty.repository.repo}#${reward.pullRequestNumber}`,
      description: `Reward for @${reward.solverGithubLogin} after merged PR #${reward.pullRequestNumber}.`,
      githubLogin: reward.solverGithubLogin,
      accessToken,
      pviumUser,
    });
  } catch (error) {
    const serializedError = serializeError(error);
    await prisma.rewardAttempt.update({
      where: { id: reward.id },
      data: {
        githubUserLinkId: link.id,
        error:
          error instanceof Error
            ? error.message
            : "Failed to create Pvium reward payment",
      },
    });

    console.error("[pvium-oauth] failed to create reward payment", {
      rewardAttemptId: reward.id,
      githubLogin: reward.solverGithubLogin,
      error: serializedError,
      errorJson: JSON.stringify(serializedError),
    });

    return NextResponse.json(
      {
        error: "Failed to create Pvium reward payment",
        detail:
          error instanceof Error
            ? error.message
            : "Unexpected Pvium payment creation error",
      },
      { status: 409 },
    );
  }

  await prisma.rewardAttempt.update({
    where: { id: reward.id },
    data: {
      githubUserLinkId: link.id,
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
      githubLogin: reward.solverGithubLogin,
      invoiceUrl: invoice.url,
      amount: reward.bounty.amount.toString(),
      currency: reward.bounty.currency,
    }),
  });

  return NextResponse.redirect(invoice.url || env.APP_BASE_URL);
}

function normalizeGithubLogin(value?: string | null) {
  const normalized = value?.trim().toLowerCase().replace(/^@/, "");
  return normalized || undefined;
}

function getGithubLoginFromPviumUser(user: {
  socialHandles?: SocialHandle[];
  privyLinkedAccounts?: LinkedAccount[];
}) {
  const socialHandle = user.socialHandles?.find(
    (handle) => handle.provider === "github" && handle.handle,
  );
  if (socialHandle?.handle) return normalizeGithubLogin(socialHandle.handle);

  const linkedAccount = user.privyLinkedAccounts?.find(
    (account) => account.type === "github_oauth",
  );

  return normalizeGithubLogin(
    linkedAccount?.username ??
      linkedAccount?.login ??
      linkedAccount?.handle ??
      linkedAccount?.profile?.username ??
      linkedAccount?.profile?.login,
  );
}
