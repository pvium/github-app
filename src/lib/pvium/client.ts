import { PviumSdk, type CreateInvoiceResponse } from "@pvium/sdk";
import { getEnv } from "@/lib/config/env";
import { serializeError } from "@/lib/errors";

let pvium: ReturnType<typeof PviumSdk.init> | null = null;
const EVM_ADDRESS_RE = /^0x[a-fA-F0-9]{40}$/;
const PVIUM_API_BASE_URLS = {
  test: "http://localhost:4005/v1",
  sandbox: "https://api-sandbox.pvium.com/v1",
  production: "https://api.pvium.com/v1",
} as const;
const PVIUM_CONSENT_HOSTS = {
  test: "http://localhost:3000",
  sandbox: "https://app-sandbox.pvium.com",
  production: "https://app.pvium.com",
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
      "PVIUM_REWARD_PAYMENT_SIGNER_PRIVATE_KEY is required for instant batch reward payments",
    );
  }

  if (!EVM_ADDRESS_RE.test(token)) {
    throw new Error(
      "PVIUM_REWARD_PAYMENT_TOKEN_ADDRESS must be configured with an ERC-20 token address for instant batch reward payments",
    );
  }

  const pviumUser =
    params.pviumUser ||
    (params.accessToken
      ? (await getPvium().oauth.getUserInfo({ accessToken: params.accessToken }))
          .data
      : undefined);
  const rewardWallet = getEthereumWalletAddress(pviumUser);

  if (!rewardWallet) {
    console.warn("[pvium] no Ethereum wallet found for reward recipient", {
      githubLogin: params.githubLogin,
      walletSummary: summarizePviumWallets(pviumUser),
    });

    throw new Error(
      `No Ethereum wallet found for @${params.githubLogin || "github user"}`,
    );
  }

  const feeAmount = Number(env.PVIUM_REWARD_PLATFORM_FEE_AMOUNT || 0);
  const payments = [
    {
      receiver: rewardWallet,
      amount: params.amount,
      token,
      decimals: env.PVIUM_REWARD_PAYMENT_TOKEN_DECIMALS,
      memo: params.description,
      publicId: params.githubLogin ? `github:${params.githubLogin}` : undefined,
    },
  ];

  if (feeAmount > 0) {
    if (!env.PVIUM_REWARD_PLATFORM_FEE_WALLET) {
      throw new Error(
        "PVIUM_REWARD_PLATFORM_FEE_WALLET is required when PVIUM_REWARD_PLATFORM_FEE_AMOUNT is greater than zero",
      );
    }

    payments.push({
      receiver: env.PVIUM_REWARD_PLATFORM_FEE_WALLET,
      amount: feeAmount,
      token,
      decimals: env.PVIUM_REWARD_PAYMENT_TOKEN_DECIMALS,
      memo: "platform-fee",
      publicId: "platform-fee",
    });
  }

  const requestOptions = params.accessToken
    ? { accessToken: params.accessToken }
    : undefined;
  const created = await getPvium().payout.create(
    {
      type: "Instant",
      chain: env.PVIUM_REWARD_PAYMENT_CHAIN,
      name: params.title,
      description: params.description,
      payments,
      complianceMode: "Open",
      metadata: {
        source: "github-app",
        githubLogin: params.githubLogin,
        rewardAmount: params.amount,
        rewardCurrency: params.currency,
        platformFeeAmount: feeAmount,
        payoutToken: token,
      },
    },
    requestOptions,
  );

  const finalized = await getPvium().payout.finalize(
    created.data,
    {
      chain: "ethereum",
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
    id: String(finalized.data.payout.id || created.data.id || ""),
    url: String(finalized.data.fundingUrl || ""),
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

export function getPviumAccessTokenExpiresAt(expiresIn?: number) {
  if (!expiresIn || !Number.isFinite(expiresIn)) return null;
  return new Date(Date.now() + expiresIn * 1000);
}

type PviumUserLike = {
  privyLinkedAccounts?: Array<{
    type?: string;
    address?: string;
    chainType?: string;
    chain?: string;
    walletClientType?: string;
  }>;
  authorizedWallets?: Array<Record<string, unknown>>;
};

function getEthereumWalletAddress(user?: PviumUserLike) {
  for (const account of user?.privyLinkedAccounts ?? []) {
    if (account.type !== "wallet" || !account.address) continue;
    if (EVM_ADDRESS_RE.test(account.address)) return account.address;
  }

  for (const wallet of user?.authorizedWallets ?? []) {
    const address = stringFromRecord(wallet, [
      "address",
      "walletAddress",
      "ethereumWallet",
      "receiver",
    ]);
    if (address && EVM_ADDRESS_RE.test(address)) return address;
  }
}

function summarizePviumWallets(user?: PviumUserLike) {
  return {
    privyLinkedAccounts: (user?.privyLinkedAccounts ?? []).map((account) => ({
      type: account.type,
      chainType: account.chainType,
      chain: account.chain,
      walletClientType: account.walletClientType,
      hasAddress: Boolean(account.address),
      addressKind: getAddressKind(account.address),
    })),
    authorizedWallets: (user?.authorizedWallets ?? []).map((wallet) => {
      const address = stringFromRecord(wallet, [
        "address",
        "walletAddress",
        "ethereumWallet",
        "receiver",
      ]);

      return {
        keys: Object.keys(wallet).sort(),
        hasAddress: Boolean(address),
        addressKind: getAddressKind(address),
        chain: stringFromRecord(wallet, ["chain", "chainType", "network"]),
      };
    }),
  };
}

function stringFromRecord(record: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
}

function getAddressKind(address?: string) {
  if (!address) return undefined;
  if (EVM_ADDRESS_RE.test(address)) return "evm";
  return "non-evm";
}
