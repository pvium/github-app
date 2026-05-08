# Pvium GitHub App

API-first Next.js service for rewarding GitHub contributors with Pvium payment links.
The app listens to GitHub webhooks, creates Pvium invite links only after an
eligible PR is merged, and comments a clickable payment link that a repository
maintainer can open and pay.

## Flow

1. A repository owner installs the GitHub App.
2. A maintainer labels an issue with a Pvium bounty label, for example `pvium:20USDC` or `pvium:10`.
3. When a pull request is merged into `main` or `master` and closes that issue, the app checks the PR author.
4. If the PR author is already linked to a Pvium account, the app creates a Pvium payment link and comments a **Pay reward** link on the PR.
5. If the PR author is not linked, the app generates a signed Pvium OAuth invite for `type: "github"` and comments the invite link on the PR.
6. Once the user accepts the invite and connects the matching GitHub account in Pvium, the Pvium webhook creates the payment link and comments the **Pay reward** link on the PR.
7. When Pvium sends a paid/funded webhook, the app marks the reward and bounty as `PAID`.

## Local Setup

This app uses the local Pvium SDK at:

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

PVIUM_ENVIRONMENT="sandbox"
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
PVIUM_REWARD_PLATFORM_FEE_AMOUNT="0"
PVIUM_INVOICE_REDIRECT_URI="https://github.com"

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
- Pull requests: read-only
- Metadata: read-only

Subscribe the GitHub App to:

- `issues`
- `pull_request`

Configure the Pvium webhook URL:

```text
https://<your-host>/api/pvium/webhook
```

Set `PVIUM_WEBHOOK_SECRET` to the same webhook secret configured on the Pvium
client app. Pvium posts `{ event, token }`; the app verifies the signed JWT and
uses the token payload to detect invite acceptance and payment completion.

`PVIUM_REWARD_PAYMENT_MODEL` controls the payment artifact. Set it to
`instant-batch` to create a finalized instant batch payment link. Set it to
`invoice` to use the legacy invoice flow. Configure:

- `PVIUM_REWARD_PAYMENT_CHAIN`: chain used by both invoice payment channels and instant batch links.
- `PVIUM_REWARD_PAYMENT_CURRENCY`: invoice payment currency.
- `PVIUM_REWARD_PAYMENT_SIGNER_PRIVATE_KEY`: private key used to sign instant batches. If omitted, the invite signer is used.
- `PVIUM_REWARD_PAYMENT_CHAIN_ID`: chain id used to finalize instant batches.
- `PVIUM_REWARD_PAYMENT_TOKEN_ADDRESS` and `PVIUM_REWARD_PAYMENT_TOKEN_DECIMALS`: instant batch payout token used for both reward and platform fee rows.
- `PVIUM_REWARD_PLATFORM_FEE_WALLET`: wallet that receives the platform fee.
- `PVIUM_REWARD_PLATFORM_FEE_AMOUNT`: fixed platform fee amount. When greater than zero, the batch includes a second payee with memo `platform-fee`.

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
2. Add a bounty label to an issue: `pvium:20USDC`, `pvium:20 USDC`, or `pvium:20`.
3. Merge a PR into `main` or `master` with a closing reference like `Closes #123`.
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
