import { PviumSdk, type CreateInvoiceResponse } from "@pvium/sdk";
import { getEnv } from "@/lib/config/env";
import { serializeError } from "@/lib/errors";
import { calculatePlatformFeeAmount } from './fees';

let pvium: ReturnType<typeof PviumSdk.init> | null = null;
const EVM_ADDRESS_RE = /^0x[a-fA-F0-9]{40}$/;
const PVIUM_API_BASE_URLS = {
  test: ' https://5e5f-99-69-4-225.ngrok-free.app/v1',
  sandbox: 'https://api-sandbox.pvium.com/v1',
  production: 'https://api.pvium.com/v1',
} as const;
const PVIUM_CONSENT_HOSTS = {
  test: 'https://sandbox.pvium.com',
  sandbox: 'https://sandbox.pvium.com',
  production: 'https://pvium.com',
} as const;

function getPvium() {
  const env = getEnv();
  if (!pvium) {
    const apiBaseUrl =
      env.PVIUM_API_BASE_URL ?? PVIUM_API_BASE_URLS[env.PVIUM_ENVIRONMENT];
    const consentHost =
      env.PVIUM_CONSENT_HOST ?? PVIUM_CONSENT_HOSTS[env.PVIUM_ENVIRONMENT];

    console.log("[pvium] initializing SDK", {
      environment: env.PVIUM_ENVIRONMENT,
      apiBaseUrl,
      consentHost,
      clientId: env.PVIUM_CLIENT_ID,
      hasApiKey: Boolean(env.PVIUM_API_KEY),
      sdkRequestLogging: env.PVIUM_SDK_LOG_REQUESTS,
    });

    pvium = PviumSdk.init({
      environment: env.PVIUM_ENVIRONMENT,
      baseUrl: env.PVIUM_API_BASE_URL,
      consentHost: env.PVIUM_CONSENT_HOST,
      apiKey: env.PVIUM_API_KEY,
      clientId: env.PVIUM_CLIENT_ID,
      logging: {
        requests: env.PVIUM_SDK_LOG_REQUESTS,
      },
    });
  }
  return pvium;
}

export async function createGithubInviteLink(params: {
  githubLogin: string;
  rewardAttemptId: string;
  scopes?: string[];
}) {
  const env = getEnv();

  console.log("[pvium] creating signed GitHub invite bundle", {
    githubLogin: params.githubLogin,
    rewardAttemptId: params.rewardAttemptId,
    environment: env.PVIUM_ENVIRONMENT,
    apiBaseUrl:
      env.PVIUM_API_BASE_URL ?? PVIUM_API_BASE_URLS[env.PVIUM_ENVIRONMENT],
    consentHost:
      env.PVIUM_CONSENT_HOST ?? PVIUM_CONSENT_HOSTS[env.PVIUM_ENVIRONMENT],
    redirectUri: env.PVIUM_OAUTH_REDIRECT_URI,
  });

  const signed = await getPvium().invites.createSignedBundle(
    {
      identities: [
        {
          type: "github",
          value: params.githubLogin,
        },
      ],
      chain: "ethereum",
      scopes: params.scopes ?? [
        "read:user",
        "read:github",
        "read:ethereum_wallet",
        "write:invoice",
        "write:batch_payment",
      ],
      redirectUri: env.PVIUM_OAUTH_REDIRECT_URI,
      stateParams: {
        source: "github-app",
        github: params.githubLogin,
        rewardAttemptId: params.rewardAttemptId,
      },
    },
    {
      chain: "ethereum",
      privateKey: env.PVIUM_INVITE_SIGNER_PRIVATE_KEY,
    },
  );

  console.log("[pvium] committing signed GitHub invite bundle", {
    githubLogin: params.githubLogin,
    rewardAttemptId: params.rewardAttemptId,
    inviteLinks: signed.inviteLinks.length,
  });

  try {
    await getPvium().invites.commitBundle(signed);
  } catch (error) {
    const serializedError = serializeError(error);
    console.error("[pvium] failed to commit signed GitHub invite bundle", {
      githubLogin: params.githubLogin,
      rewardAttemptId: params.rewardAttemptId,
      error: serializedError,
      errorJson: JSON.stringify(serializedError),
    });

    throw error;
  }

  console.log("[pvium] committed signed GitHub invite bundle", {
    githubLogin: params.githubLogin,
    rewardAttemptId: params.rewardAttemptId,
  });

  return signed.inviteLinks[0];
}

export async function createRewardInvoice(params: {
  amount: number;
  currency: string;
  title: string;
  description: string;
  githubLogin?: string;
  accessToken?: string;
  pviumUser?: any;
}) {
  const env = getEnv();

  if (env.PVIUM_REWARD_PAYMENT_MODEL === "instant-batch") {
    return createRewardInstantBatchPayment(params);
  }

  const body = {
    name: params.title,
    description: params.description,
    amount: params.amount,
    dueDate: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString(),
    paymentChannels: [
      {
        chain: env.PVIUM_REWARD_PAYMENT_CHAIN,
        currency: params.currency || env.PVIUM_REWARD_PAYMENT_CURRENCY,
      },
    ],
    redirectUri: env.PVIUM_INVOICE_REDIRECT_URI,
  };

  const response: CreateInvoiceResponse =
    await getPvium().endpoints.createInvoice(
      body,
      params.accessToken ? { accessToken: params.accessToken } : undefined,
    );

  return {
    id: String(response?.data?.id ?? response?.data?.code ?? ""),
    url: String(response.data.url ?? ""),
    raw: response,
  };
}

async function createRewardInstantBatchPayment(params: {
  amount: number;
  currency: string;
  title: string;
  description: string;
  githubLogin?: string;
  accessToken?: string;
  pviumUser?: any;
}) {
  const env = getEnv();
  const signerPrivateKey =
    env.PVIUM_REWARD_PAYMENT_SIGNER_PRIVATE_KEY ||
    env.PVIUM_INVITE_SIGNER_PRIVATE_KEY;
  const token = env.PVIUM_REWARD_PAYMENT_TOKEN_ADDRESS || params.currency;

  if (!signerPrivateKey) {
    throw new Error(
      'PVIUM_REWARD_PAYMENT_SIGNER_PRIVATE_KEY is required for instant batch reward payments',
    );
  }

  if (!EVM_ADDRESS_RE.test(token)) {
    throw new Error(
      'PVIUM_REWARD_PAYMENT_TOKEN_ADDRESS must be configured with an ERC-20 token address for instant batch reward payments',
    );
  }

  if (!params.githubLogin) {
    throw new Error(
      'githubLogin is required to create instant batch reward payments',
    );
  }

  const platformFeeAmount = env.PVIUM_REWARD_PLATFORM_FEE_WALLET
    ? calculatePlatformFeeAmount({
        rewardAmount: params.amount,
        feeBasisPoints: env.PVIUM_REWARD_PLATFORM_FEE_BASIS_POINTS,
        maxFeeAmount: env.PVIUM_REWARD_MAX_FEE_AMOUNT,
        decimals: env.PVIUM_REWARD_PAYMENT_TOKEN_DECIMALS,
      })
    : 0;
  const payments: Array<{
    receiver: string;
    amount: number;
    token: string;
    decimals: number;
    memo?: string;
    publicId?: string;
  }> = [];

  if (platformFeeAmount > 0 && env.PVIUM_REWARD_PLATFORM_FEE_WALLET) {
    payments.push({
      receiver: env.PVIUM_REWARD_PLATFORM_FEE_WALLET,
      amount: platformFeeAmount,
      token,
      decimals: env.PVIUM_REWARD_PAYMENT_TOKEN_DECIMALS,
      memo: 'platform fee',
      publicId: 'platform-fee',
    });
  }

  const requestOptions = undefined;

  console.log('[pvium] creating instant batch payment', {
    githubLogin: params.githubLogin,
    amount: params.amount,
    currency: params.currency,
    chain: env.PVIUM_REWARD_PAYMENT_CHAIN,
    hasPlatformFee: platformFeeAmount > 0,
  });

  const created = await getPvium().payout.create(
    {
      type: 'Instant',
      chain: env.PVIUM_REWARD_PAYMENT_CHAIN,
      name: params.title,
      description: params.description,
      payments,
      complianceMode: 'Open',
      metadata: {
        source: 'github-app',
        githubLogin: params.githubLogin,
        rewardAmount: params.amount,
        rewardCurrency: params.currency,
        platformFeeBasisPoints: env.PVIUM_REWARD_PLATFORM_FEE_BASIS_POINTS,
        platformFeeAmount,
        platformFeeMaxAmount: env.PVIUM_REWARD_MAX_FEE_AMOUNT,
        payoutCurrency: token,
        payoutToken: token,
      },
    },
    // requestOptions,
  );

  const addedRecipients = await getPvium().payout.addRecipients(
    created.data.id,
    [
      {
        identityType: 'github',
        identityValue: params.githubLogin,
        defaultPayoutAmount: params.amount,
        memo: params.description,
      },
    ],
    requestOptions,
  );
  const addRecipientsResult = addedRecipients.data;
  const rewardRecipient = addRecipientsResult.added[0];

  if (!rewardRecipient?.receiver) {
    console.warn('[pvium] failed to resolve reward recipient by GitHub login', {
      batchId: created.data.id,
      githubLogin: params.githubLogin,
      errors: addRecipientsResult.errors,
    });

    throw new Error(
      addRecipientsResult.errors[0]?.reason ||
        `No Pvium wallet found for @${params.githubLogin}`,
    );
  }

  payments.push({
    receiver: rewardRecipient.receiver,
    amount: params.amount,
    token,
    decimals: env.PVIUM_REWARD_PAYMENT_TOKEN_DECIMALS,
    memo: params.description,
    publicId: `github:${params.githubLogin}`,
  });

  const finalized = await getPvium().payout.finalize(
    created.data,
    {
      chain: 'ethereum',
      privateKey: signerPrivateKey,
    },
    {
      chainId: env.PVIUM_REWARD_PAYMENT_CHAIN_ID,
      clientId: env.PVIUM_CLIENT_ID,
      payments,
    },
    requestOptions,
  );

  return {
    id: String(finalized.data.payout.id || created.data.id || ''),
    url: String(finalized.data.fundingUrl || ''),
    raw: finalized,
  };
}

export async function exchangePviumAuthorizationCode(params: {
  code: string;
  redirectUri: string;
}) {
  return getPvium().oauth.exchangeCodeForToken(params);
}

export async function getPviumUserInfo(accessToken: string) {
  return getPvium().oauth.getUserInfo({ accessToken });
}

export async function refreshPviumAccessToken(refreshToken: string) {
  return getPvium().oauth.refreshAccessToken({ refreshToken });
}

export function getPviumAccessTokenExpiresAt(input?: {
  expiresIn?: number | null;
  expiresAt?: string | number | Date | null;
}) {
  if (input?.expiresAt) {
    const expiresAt =
      input.expiresAt instanceof Date
        ? input.expiresAt
        : new Date(input.expiresAt);

    if (Number.isFinite(expiresAt.getTime())) {
      return expiresAt;
    }
  }

  if (!input?.expiresIn || !Number.isFinite(input.expiresIn)) return null;
  return new Date(Date.now() + input.expiresIn * 1000);
}
