import { z } from "zod";

const optionalNonEmptyString = z.preprocess(
  (value) => (value === "" ? undefined : value),
  z.string().min(1).optional(),
);

const envSchema = z.object({
  DATABASE_URL: z.string().min(1),
  GITHUB_APP_ID: z.string().min(1),
  GITHUB_APP_PRIVATE_KEY: z.string().min(1),
  GITHUB_WEBHOOK_SECRET: z.string().min(1),
  PVIUM_ENVIRONMENT: z.enum(["sandbox", "production"]).default("sandbox"),
  PVIUM_API_KEY: z.string().min(1),
  PVIUM_CLIENT_ID: z.string().min(1),
  PVIUM_CLIENT_SECRET: z.string().min(1),
  PVIUM_WEBHOOK_SECRET: optionalNonEmptyString,
  PVIUM_INVITE_SIGNER_PRIVATE_KEY: z.string().min(1),
  PVIUM_OAUTH_REDIRECT_URI: z.string().url(),
  PVIUM_REWARD_PAYMENT_MODEL: z
    .enum(["invoice", "instant-batch"])
    .default("instant-batch"),
  PVIUM_REWARD_PAYMENT_SIGNER_PRIVATE_KEY: optionalNonEmptyString,
  PVIUM_REWARD_PAYMENT_CHAIN: z.string().default("base"),
  PVIUM_REWARD_PAYMENT_CHAIN_ID: z.coerce
    .number()
    .int()
    .positive()
    .default(8453),
  PVIUM_REWARD_PAYMENT_CURRENCY: z.string().default("USDC"),
  PVIUM_REWARD_PAYMENT_TOKEN_ADDRESS: optionalNonEmptyString,
  PVIUM_REWARD_PAYMENT_TOKEN_DECIMALS: z.coerce
    .number()
    .int()
    .nonnegative()
    .default(6),
  PVIUM_REWARD_PLATFORM_FEE_WALLET: optionalNonEmptyString,
  PVIUM_REWARD_PLATFORM_FEE_AMOUNT: z.coerce.number().nonnegative().default(0),
  PVIUM_INVOICE_REDIRECT_URI: z.string().url(),
  APP_BASE_URL: z.string().url(),
});

export type AppEnv = z.infer<typeof envSchema>;

let cachedEnv: AppEnv | null = null;

export function getEnv() {
  cachedEnv ??= envSchema.parse(process.env);
  return cachedEnv;
}
