# Pvium GitHub App

Reward GitHub contributors with Pvium payment links. Maintainers label bounty
issues, contributors close them with pull requests, and Pvium handles the
invite, payment link, funded webhook, and paid status updates.

## Flow

1. A repository owner installs the GitHub App.
2. A maintainer labels an issue with a Pvium bounty label, for example `pvium:20USDC` or `pvium:10`.
3. When a pull request is merged into a configured reward target branch and closes that issue, the app checks the PR author.
4. If the PR author is already linked to a Pvium account, the app creates a Pvium payment link and comments a **Pay reward** link on the PR.
5. If the PR author is not linked, the app generates a signed Pvium OAuth invite for `type: "github"` and comments the invite link on the PR.
6. Once the user accepts the invite and connects the matching GitHub account in Pvium, the Pvium webhook creates the payment link and comments the **Pay reward** link on the PR.
7. When Pvium sends a paid/funded webhook, the app marks the reward and bounty as `PAID`.

## Local Setup

The reward automation uses the local Pvium SDK at:

```text
/Users/Projects/Javascript/paytrack/sdks/node
```

`package.json` points `@pvium/sdk` at `file:../sdks/node`. If you change the
SDK, rebuild it before running this app:

```bash
cd /Users/Projects/Javascript/paytrack/sdks/node
npm install
npm run build
```

Then install and run the GitHub app:

```bash
npm install
cp .env.example .env
npm run prisma:generate
npm run prisma:migrate
npm run dev
```

Required `.env` values:

```text
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/pvium_github_app"

GITHUB_APP_ID=""
GITHUB_APP_PRIVATE_KEY=""
GITHUB_WEBHOOK_SECRET=""
GITHUB_REWARD_TARGET_BRANCHES="main,master"

PVIUM_ENVIRONMENT="sandbox"
PVIUM_API_BASE_URL=""
PVIUM_CONSENT_HOST=""
PVIUM_SDK_LOG_REQUESTS="false"
PVIUM_API_KEY=""
PVIUM_CLIENT_ID=""
PVIUM_WEBHOOK_SECRET=""
PVIUM_INVITE_SIGNER_PRIVATE_KEY=""
PVIUM_OAUTH_REDIRECT_URI="http://localhost:3000/api/pvium/oauth/callback"
PVIUM_REWARD_PAYMENT_MODEL="instant-batch"
PVIUM_REWARD_PAYMENT_SIGNER_PRIVATE_KEY=""
PVIUM_REWARD_PAYMENT_CHAIN="base"
PVIUM_REWARD_PAYMENT_CHAIN_ID="8453"
PVIUM_REWARD_PAYMENT_CURRENCY="USDC"
PVIUM_REWARD_PAYMENT_TOKEN_ADDRESS=""
PVIUM_REWARD_PAYMENT_TOKEN_DECIMALS="6"
PVIUM_REWARD_PLATFORM_FEE_WALLET=""
PVIUM_REWARD_PLATFORM_FEE_BASIS_POINTS="0"
PVIUM_REWARD_MAX_FEE_AMOUNT="0"
PVIUM_INVOICE_REDIRECT_URI="http://localhost:3000/api/pvium/oauth/callback""

APP_BASE_URL="http://localhost:3000"
```

Generate `GITHUB_APP_PRIVATE_KEY` from the GitHub App settings page:

1. Open GitHub App settings.
2. Go to **Private keys**.
3. Click **Generate a private key** and download the `.pem` file.
4. Copy the full PEM contents into `.env`, replacing line breaks with `\n`.

Example format:

```text
GITHUB_APP_PRIVATE_KEY="-----BEGIN RSA PRIVATE KEY-----\n...\n-----END RSA PRIVATE KEY-----"
```

Configure the GitHub App webhook URL:

```text
https://<your-host>/api/github/webhook
```

Set these GitHub App repository permissions:

- Issues: read and write
- Pull requests: read and write
- Metadata: read-only

Subscribe the GitHub App to:

- `issues`
- `pull_request`

`GITHUB_REWARD_TARGET_BRANCHES` is a comma-separated list of base branches that
can trigger reward processing when a PR is merged. For example, use
`main,master,develop` to process merged PRs targeting `develop` too.

Configure the Pvium webhook URL:

```text
https://<your-host>/api/pvium/webhook
```

Set `PVIUM_WEBHOOK_SECRET` to the same webhook secret configured on the Pvium
client app. Pvium posts `{ event, token }`; the app verifies the signed JWT and
uses the token payload to detect invite acceptance and payment completion.

`PVIUM_ENVIRONMENT` resolves Pvium hosts as follows: `test` uses
`http://localhost:4005/v1`, `sandbox` uses `https://api-sandbox.pvium.com/v1`,
and `production` uses `https://api.pvium.com/v1`. Set `PVIUM_API_BASE_URL` or
`PVIUM_CONSENT_HOST` only when you need to override those defaults.
Set `PVIUM_SDK_LOG_REQUESTS=true` to log SDK request method, host, path,
status, duration, and network errors without logging full URLs or secrets.

`PVIUM_REWARD_PAYMENT_MODEL` controls the payment artifact. Set it to
`instant-batch` to create a finalized instant batch payment link. Set it to
`invoice` to use the legacy invoice flow. Configure:

- `PVIUM_REWARD_PAYMENT_CHAIN`: chain used by both invoice payment channels and instant batch links.
- `PVIUM_BOUNTY_LABEL_PREFIX`: GitHub issue label prefix used to detect bounties. Defaults to `pvium:` when unset or empty.
- `PVIUM_REWARD_PAYMENT_CURRENCY`: invoice payment currency.
- `PVIUM_REWARD_PAYMENT_SIGNER_PRIVATE_KEY`: private key used to sign instant batches. If omitted, the invite signer is used.
- `PVIUM_REWARD_PAYMENT_CHAIN_ID`: chain id used to finalize instant batches.
- `PVIUM_REWARD_PAYMENT_TOKEN_ADDRESS` and `PVIUM_REWARD_PAYMENT_TOKEN_DECIMALS`: instant batch payout token used for both reward and platform fee rows.
- `PVIUM_REWARD_PLATFORM_FEE_WALLET`: wallet that receives the platform fee. If omitted, no platform fee payee is added.
- `PVIUM_REWARD_PLATFORM_FEE_BASIS_POINTS`: platform fee basis points. For example, `100` is 1% and `250` is 2.5%.
- `PVIUM_REWARD_MAX_FEE_AMOUNT`: optional absolute token amount cap for the computed platform fee. Use `0` for no cap.

When `PVIUM_REWARD_PLATFORM_FEE_WALLET` is set and
`PVIUM_REWARD_PLATFORM_FEE_BASIS_POINTS` is greater than zero, instant batches include
the platform fee as the first payee with memo `platform fee`. The contributor
reward amount is not reduced by the fee.

Register the Pvium OAuth redirect URI on the client app:

```text
https://<your-host>/api/pvium/oauth/callback
```

Pvium events handled by this app:

- `issues.labeled`
- `pull_request.closed`
- `oauth.invite.accepted` from Pvium
- `invoice.paid` from Pvium
- `invoice.payment_completed` from Pvium
- `invoice.payment.succeeded` from Pvium
- `batch.funded` from Pvium
- `batch.payment_completed` from Pvium
- `batch.payment.succeeded` from Pvium

## Usage

1. Install the GitHub App on a repository.
2. Add a bounty label to an issue: `pvium:20USDC` or `pvium:20`. If `PVIUM_BOUNTY_LABEL_PREFIX` is changed, use that prefix instead.
3. Merge a PR into a configured reward target branch with a closing reference like `Closes #123`.
4. The app comments on the merged PR.
5. If the contributor needs to link Pvium, they use the invite link in the comment.
6. Pvium redirects back to `/api/pvium/oauth/callback` with an OAuth code.
7. The app exchanges the code through the local Pvium SDK, verifies the accepted GitHub handle, saves the OAuth token set for future rewards, creates the payment link with the returned access token, and comments a **Pay reward** link.
8. The maintainer clicks **Pay reward** and completes payment in Pvium.

The app stores Pvium OAuth access and refresh tokens on the GitHub user link so
future merged PRs for the same contributor can create invoices without asking
the contributor to authorize again. Access tokens are refreshed through the SDK
when they are expired.
Treat these OAuth tokens as secrets. Production deployments should encrypt them
at rest and restrict database access accordingly.
