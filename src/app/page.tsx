import type { CSSProperties, ReactNode } from "react";

const flowSteps = [
  "A repository owner installs the GitHub App.",
  "A maintainer labels an issue with a Pvium bounty label, for example pvium:20USDC or pvium:10.",
  "When a pull request is merged into a configured reward target branch and closes that issue, the app checks the PR author.",
  "If the PR author is already linked to a Pvium account, the app creates a Pvium payment link and comments a Pay reward link on the PR.",
  "If the PR author is not linked, the app generates a signed Pvium OAuth invite for type: github and comments the invite link on the PR.",
  "Once the user accepts the invite and connects the matching GitHub account in Pvium, the Pvium webhook creates the payment link and comments the Pay reward link on the PR.",
  "When Pvium sends a paid or funded webhook, the app marks the reward and bounty as PAID.",
];

const localSetupCommands = [
  "cd /Users/Projects/Javascript/paytrack/sdks/node",
  "npm install",
  "npm run build",
  "",
  "cd /Users/Projects/Javascript/paytrack/github-app",
  "npm install",
  "cp .env.example .env",
  "npm run prisma:generate",
  "npm run prisma:migrate",
  "npm run dev",
];

const envExample = `DATABASE_URL="postgresql://postgres:postgres@localhost:5432/pvium_github_app"

GITHUB_APP_ID=""
GITHUB_APP_PRIVATE_KEY=""
GITHUB_WEBHOOK_SECRET=""
GITHUB_REWARD_TARGET_BRANCHES="main,master"
PVIUM_BOUNTY_LABEL_PREFIX="pvium:"

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
PVIUM_INVOICE_REDIRECT_URI="http://localhost:3000/api/pvium/oauth/callback"

APP_BASE_URL="http://localhost:3000"`;

const githubPermissions = [
  "Issues: read and write",
  "Pull requests: read and write",
  "Metadata: read-only",
];

const githubEvents = ["issues", "pull_request"];

const configItems = [
  "GITHUB_REWARD_TARGET_BRANCHES is a comma-separated list of base branches that can trigger reward processing when a PR is merged.",
  "PVIUM_BOUNTY_LABEL_PREFIX controls the GitHub issue label prefix used to detect bounties. It defaults to pvium: when unset or empty.",
  "PVIUM_ENVIRONMENT resolves Pvium hosts: test uses localhost, sandbox uses api-sandbox.pvium.com, and production uses api.pvium.com.",
  "PVIUM_API_BASE_URL and PVIUM_CONSENT_HOST override the resolved Pvium hosts when needed.",
  "PVIUM_SDK_LOG_REQUESTS=true logs SDK request method, host, path, status, duration, and network errors without logging full URLs or secrets.",
  "PVIUM_REWARD_PAYMENT_MODEL controls the payment artifact. Use instant-batch for finalized instant batch payment links or invoice for the legacy invoice flow.",
  "PVIUM_REWARD_PAYMENT_CHAIN is the chain used by both invoice payment channels and instant batch links.",
  "PVIUM_REWARD_PAYMENT_CURRENCY is the invoice payment currency.",
  "PVIUM_REWARD_PAYMENT_SIGNER_PRIVATE_KEY signs instant batches. If omitted, the invite signer is used.",
  "PVIUM_REWARD_PAYMENT_CHAIN_ID is the chain id used to finalize instant batches.",
  "PVIUM_REWARD_PAYMENT_TOKEN_ADDRESS and PVIUM_REWARD_PAYMENT_TOKEN_DECIMALS define the instant batch payout token.",
  "PVIUM_REWARD_PLATFORM_FEE_WALLET receives the platform fee. If omitted, no platform fee payee is added.",
  "PVIUM_REWARD_PLATFORM_FEE_BASIS_POINTS sets the fee. For example, 100 is 1% and 250 is 2.5%.",
  "PVIUM_REWARD_MAX_FEE_AMOUNT caps the computed platform fee. Use 0 for no cap.",
];

const pviumEvents = [
  "oauth.invite.accepted",
  "invoice.paid",
  "invoice.payment_completed",
  "invoice.payment.succeeded",
  "payment.attached",
  "batch.funded",
  "batch.payment_completed",
  "batch.payment.succeeded",
];

const usageSteps = [
  "Install the GitHub App on a repository.",
  "Add a bounty label to an issue, such as pvium:20USDC or pvium:20. If PVIUM_BOUNTY_LABEL_PREFIX is changed, use that prefix instead.",
  "Merge a PR into a configured reward target branch with a closing reference like Closes #123.",
  "The app comments on the merged PR.",
  "If the contributor needs to link Pvium, they use the invite link in the comment.",
  "Pvium redirects back to /api/pvium/oauth/callback with an OAuth code.",
  "The app exchanges the code through the local Pvium SDK, verifies the accepted GitHub handle, saves the OAuth token set, creates the payment link, and comments a Pay reward link.",
  "The maintainer clicks Pay reward and completes payment in Pvium.",
];

export default function Home() {
  return (
    <main style={styles.page}>
      <section style={styles.hero}>
        <p style={styles.eyebrow}>Pvium GitHub App</p>
        <h1 style={styles.title}>
          Reward GitHub contributors with Pvium payment links.
        </h1>
        <p style={styles.lede}>
          Turn merged pull requests into payable rewards. Maintainers label
          bounty issues, contributors close them with PRs, and Pvium handles the
          invite, payment link, funded webhook, and paid status updates.
        </p>
        <div style={styles.endpointGrid}>
          <Endpoint label="GitHub webhook" value="/api/github/webhook" />
          <Endpoint label="Pvium webhook" value="/api/pvium/webhook" />
          <Endpoint label="OAuth callback" value="/api/pvium/oauth/callback" />
        </div>
      </section>

      <Section title="Flow">
        <NumberedList items={flowSteps} />
      </Section>

      <Section title="Local Setup">
        <p style={styles.paragraph}>
          The reward automation uses the local Pvium SDK at{" "}
          <code style={styles.inlineCode}>
            /Users/Projects/Javascript/paytrack/sdks/node
          </code>
          . The package points <code style={styles.inlineCode}>@pvium/sdk</code>{" "}
          at <code style={styles.inlineCode}>file:../sdks/node</code>, so
          rebuild the SDK after changing it.
        </p>
        <CodeBlock value={localSetupCommands.join("\n")} />
      </Section>

      <Section title="Environment">
        <p style={styles.paragraph}>
          Required values are documented in .env.example:
        </p>
        <CodeBlock value={envExample} />
      </Section>

      <Section title="GitHub App">
        <p style={styles.paragraph}>
          Generate <code style={styles.inlineCode}>GITHUB_APP_PRIVATE_KEY</code>{" "}
          from the GitHub App settings page under Private keys, then copy the
          full PEM contents into the environment with line breaks replaced by{" "}
          <code style={styles.inlineCode}>\n</code>.
        </p>
        <p style={styles.paragraph}>
          Configure the webhook URL as{" "}
          <code style={styles.inlineCode}>
            https://&lt;your-host&gt;/api/github/webhook
          </code>
          .
        </p>
        <div style={styles.columns}>
          <ListBlock title="Repository Permissions" items={githubPermissions} />
          <ListBlock title="Subscribed Events" items={githubEvents} />
        </div>
      </Section>

      <Section title="Pvium Configuration">
        <p style={styles.paragraph}>
          Configure the Pvium webhook URL as{" "}
          <code style={styles.inlineCode}>
            https://&lt;your-host&gt;/api/pvium/webhook
          </code>
          . Set <code style={styles.inlineCode}>PVIUM_WEBHOOK_SECRET</code> to
          the same secret configured on the Pvium client app.
        </p>
        <BulletList items={configItems} />
        <p style={styles.paragraph}>
          When{" "}
          <code style={styles.inlineCode}>
            PVIUM_REWARD_PLATFORM_FEE_WALLET
          </code>{" "}
          is set and the fee basis points are greater than zero, instant batches
          include the platform fee as the first payee with memo{" "}
          <code style={styles.inlineCode}>platform fee</code>. The contributor
          reward amount is not reduced by the fee.
        </p>
      </Section>

      <Section title="Handled Events">
        <div style={styles.columns}>
          <ListBlock
            title="GitHub"
            items={["issues.labeled", "pull_request.closed"]}
          />
          <ListBlock title="Pvium" items={pviumEvents} />
        </div>
      </Section>

      <Section title="Usage">
        <NumberedList items={usageSteps} />
        <p style={styles.paragraph}>
          The app stores Pvium OAuth access and refresh tokens on the GitHub
          user link so future merged PRs for the same contributor can create
          rewards without asking the contributor to authorize again. Treat these
          OAuth tokens as secrets; production deployments should encrypt them at
          rest and restrict database access.
        </p>
      </Section>
    </main>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section style={styles.section}>
      <h2 style={styles.sectionTitle}>{title}</h2>
      {children}
    </section>
  );
}

function Endpoint({ label, value }: { label: string; value: string }) {
  return (
    <div style={styles.endpoint}>
      <span style={styles.endpointLabel}>{label}</span>
      <code style={styles.endpointCode}>{value}</code>
    </div>
  );
}

function ListBlock({ title, items }: { title: string; items: string[] }) {
  return (
    <div style={styles.listBlock}>
      <h3 style={styles.listTitle}>{title}</h3>
      <BulletList items={items} />
    </div>
  );
}

function BulletList({ items }: { items: string[] }) {
  return (
    <ul style={styles.list}>
      {items.map((item) => (
        <li key={item} style={styles.listItem}>
          {item}
        </li>
      ))}
    </ul>
  );
}

function NumberedList({ items }: { items: string[] }) {
  return (
    <ol style={styles.list}>
      {items.map((item) => (
        <li key={item} style={styles.listItem}>
          {item}
        </li>
      ))}
    </ol>
  );
}

function CodeBlock({ value }: { value: string }) {
  return <pre style={styles.codeBlock}>{value}</pre>;
}

const styles: Record<string, CSSProperties> = {
  page: {
    minHeight: "100vh",
    margin: 0,
    padding: "48px 20px",
    background: "#f7f8fb",
    color: "#172033",
    fontFamily:
      'Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
  },
  hero: {
    maxWidth: 980,
    margin: "0 auto 24px",
    padding: "32px 0 8px",
  },
  eyebrow: {
    margin: "0 0 12px",
    color: "#52627a",
    fontSize: 14,
    fontWeight: 700,
    textTransform: "uppercase",
  },
  title: {
    maxWidth: 820,
    margin: "0 0 18px",
    fontSize: 48,
    lineHeight: 1.08,
    letterSpacing: 0,
  },
  lede: {
    maxWidth: 760,
    margin: "0 0 24px",
    color: "#46556e",
    fontSize: 18,
    lineHeight: 1.65,
  },
  endpointGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(230px, 1fr))",
    gap: 12,
    maxWidth: 920,
  },
  endpoint: {
    border: "1px solid #d9deea",
    borderRadius: 8,
    background: "#ffffff",
    padding: 16,
  },
  endpointLabel: {
    display: "block",
    marginBottom: 8,
    color: "#66748a",
    fontSize: 13,
    fontWeight: 700,
  },
  endpointCode: {
    color: "#172033",
    fontSize: 14,
    wordBreak: "break-word",
  },
  section: {
    maxWidth: 980,
    margin: "18px auto",
    padding: 24,
    border: "1px solid #d9deea",
    borderRadius: 8,
    background: "#ffffff",
  },
  sectionTitle: {
    margin: "0 0 16px",
    fontSize: 24,
    letterSpacing: 0,
  },
  paragraph: {
    margin: "0 0 14px",
    color: "#46556e",
    fontSize: 15,
    lineHeight: 1.7,
  },
  columns: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(250px, 1fr))",
    gap: 18,
  },
  listBlock: {
    minWidth: 0,
  },
  listTitle: {
    margin: "0 0 10px",
    color: "#263247",
    fontSize: 16,
  },
  list: {
    margin: 0,
    paddingLeft: 22,
    color: "#46556e",
    fontSize: 15,
    lineHeight: 1.7,
  },
  listItem: {
    marginBottom: 8,
  },
  codeBlock: {
    margin: "14px 0 0",
    padding: 16,
    overflowX: "auto",
    borderRadius: 8,
    background: "#141925",
    color: "#eef3ff",
    fontSize: 13,
    lineHeight: 1.6,
  },
  inlineCode: {
    padding: "2px 5px",
    borderRadius: 5,
    background: "#eef1f6",
    color: "#263247",
    fontSize: "0.92em",
  },
};
