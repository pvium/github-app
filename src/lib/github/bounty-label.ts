export interface ParsedBountyLabel {
  amount: number;
  currency: string;
  raw: string;
}

const bountyLabelPattern = /^pvium:(\d+(?:\.\d+)?)([a-zA-Z0-9]+)?$/;

export function parseBountyLabel(labelName: string): ParsedBountyLabel | null {
  const match = labelName.trim().match(bountyLabelPattern);
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
