export interface ParsedBountyLabel {
  amount: number;
  currency: string;
  raw: string;
}

const DEFAULT_BOUNTY_LABEL_PREFIX = "pvium:";

export function parseBountyLabel(labelName: string): ParsedBountyLabel | null {
  const match = labelName.trim().match(getBountyLabelPattern());
  if (!match) return null;

  return {
    amount: Number(match[1]),
    currency: (match[2] || "USDC").toUpperCase(),
    raw: labelName,
  };
}

export function extractBountyLabels(labels: Array<{ name?: string }>) {
  return labels
    .map((label) => (label.name ? parseBountyLabel(label.name) : null))
    .filter((label): label is ParsedBountyLabel => Boolean(label));
}

function getBountyLabelPattern() {
  console.log('[bounty-label] using bounty label prefix:', {
    prefix: process.env.PVIUM_BOUNTY_LABEL_PREFIX,
  });
  const prefix =
    process.env.PVIUM_BOUNTY_LABEL_PREFIX?.trim() ||
    DEFAULT_BOUNTY_LABEL_PREFIX;

  return new RegExp(
    `^${escapeRegExp(prefix)}(\\d+(?:\\.\\d+)?)([a-zA-Z0-9]+)?$`,
  );
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
