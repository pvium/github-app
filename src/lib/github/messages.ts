export function bountyRegisteredMessage(params: {
  amount: string | number;
  currency: string;
  issueNumber: number;
}) {
  return [
    `Pvium bounty registered for #${params.issueNumber}.`,
    "",
    `Reward: **${params.amount} ${params.currency}**`,
    "",
    "A merged PR that closes this issue can be processed for payment.",
  ].join("\n");
}

export function inviteRequiredMessage(params: {
  githubLogin: string;
  inviteLink: string;
  amount: string | number;
  currency: string;
}) {
  return [
    `@${params.githubLogin}, this PR is eligible for a Pvium reward of **${params.amount} ${params.currency}**.`,
    "",
    "Connect your GitHub account to Pvium to claim it:",
    params.inviteLink,
    "",
    "After the invite is accepted, Pvium will create the payment link for the repository owner to pay.",
  ].join("\n");
}

export function invoiceCreatedMessage(params: {
  githubLogin: string;
  invoiceUrl: string;
  amount: string | number;
  currency: string;
}) {
  return [
    `Pvium reward payment link created for @${params.githubLogin}.`,
    "",
    `Amount: **${params.amount} ${params.currency}**`,
    "",
    `[Pay reward](${params.invoiceUrl})`,
  ].join("\n");
}

export function invoicePaidMessage(params: {
  githubLogin: string;
  amount: string | number;
  currency: string;
}) {
  return [
    `Pvium reward payment completed for @${params.githubLogin}.`,
    "",
    `Amount: **${params.amount} ${params.currency}**`,
  ].join("\n");
}
