import { PviumSdk, type CreateInvoiceResponse } from "@pvium/sdk";
import { getEnv } from "@/lib/config/env";

let pvium: ReturnType<typeof PviumSdk.init> | null = null;
const EVM_ADDRESS_RE = /^0x[a-fA-F0-9]{40}$/;

function getPvium() {
  const env = getEnv();
  pvium ??= PviumSdk.init({
    environment: env.PVIUM_ENVIRONMENT,
    apiKey: env.PVIUM_API_KEY,
    clientId: env.PVIUM_CLIENT_ID,
  });
  return pvium;
}

export async function createGithubInviteLink(params: {
  githubLogin: string;
  rewardAttemptId: string;
  scopes?: string[];
}) {
  const env = getEnv();
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

  await getPvium().invites.commitBundle(signed);
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
};

function getEthereumWalletAddress(user?: PviumUserLike) {
  const wallet = user?.privyLinkedAccounts?.find((account) => {
    if (account.type !== "wallet" || !account.address) return false;
    return EVM_ADDRESS_RE.test(account.address);
  });

  return wallet?.address;
}
