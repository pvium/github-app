export function normalizeGithubLogin(value: unknown) {
  if (typeof value !== "string") return undefined;

  const normalized = value.trim().toLowerCase().replace(/^@/, "");
  return normalized || undefined;
}
