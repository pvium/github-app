# Pvium GitHub App Requirements

## Product Goal

Build a GitHub App that lets repository owners attach Pvium rewards to GitHub work and pay contributors through Pvium invoices.

## Core Workflow

- Repository owners install the GitHub App on one or more repositories.
- Maintainers add bounty labels to issues using `pvium:<amount><currency>`.
- Supported examples:
  - `pvium:20USDC`
  - `pvium:10`
- If the currency is omitted, default to `USDC`.
- When a PR is merged into `main` or `master`, the app checks whether the PR closes a bounty issue.
- The PR author is treated as the solver by default.
- If the solver's GitHub account is linked to a Pvium account, create a Pvium invoice for the bounty amount.
- If the solver is not linked, generate a Pvium OAuth invite using invite identity `type: "github"`.
- The user must connect the same GitHub account in Pvium before the reward invoice is created.
- Once the invoice is created, comment the invoice URL on the PR.
- Once the invoice is paid, mark the reward as paid and comment on the PR.

## Required GitHub Permissions

- Repository metadata: read
- Issues: read and write
- Pull requests: read and write
- Contents: read

## Required Webhook Events

- `issues`
- `pull_request`

## Required Pvium Capabilities

- OAuth invite bundle generation using the Pvium SDK.
- Invite identity type `github`.
- Invoice creation through the Pvium SDK.
- Pvium webhook or callback for accepted GitHub invites.
- Pvium webhook or polling job for paid invoices.

## Data Model Requirements

- Store installed repositories by installation ID, owner, and repo.
- Store bounty labels by repository, issue number, amount, and currency.
- Store GitHub-to-Pvium account links.
- Store reward attempts by bounty, PR number, solver GitHub login, invoice URL, and status.
- Store processed webhook delivery IDs for idempotency.

## Safety Requirements

- Verify GitHub webhook signatures with `X-Hub-Signature-256`.
- Make all webhook handlers idempotent.
- Never auto-pay contributors. The repository owner must pay the generated invoice.
- Do not create duplicate invoices for the same bounty, PR, and solver.
- Require the GitHub account connected in Pvium to match the invited GitHub login.
- Treat bounty labels as append-only audit data; cancelling a bounty should be a separate status transition.

## Suggested Workflow Improvements

- Prefer issue labels for bounty declaration because labels are visible, searchable, and auditable.
- Also support a slash command later, for example `/pvium bounty 20 USDC`, for teams that want a comment-based audit trail.
- Reward the PR author by default, but allow maintainers to override the solver with a PR comment before invoice creation.
- Require PRs to close issues with standard GitHub keywords (`fixes #123`, `closes #123`) so reward attribution is deterministic.
- Add an optional approval step before invoice creation for high-value bounties.
- Add a scheduled reconciliation job that checks unpaid and paid invoice status until Pvium payment webhooks are available.
