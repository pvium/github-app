const closingKeywordPattern =
  /\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)\s+(?:(?:[\w.-]+\/[\w.-]+)?#|https?:\/\/github\.com\/[\w.-]+\/[\w.-]+\/issues\/)(\d+)\b/gi;

export function extractLinkedIssueNumbers(...texts: Array<string | null | undefined>) {
  const issueNumbers = new Set<number>();

  for (const text of texts) {
    if (!text) continue;
    for (const match of text.matchAll(closingKeywordPattern)) {
      issueNumbers.add(Number(match[1]));
    }
  }

  return Array.from(issueNumbers).sort((a, b) => a - b);
}
