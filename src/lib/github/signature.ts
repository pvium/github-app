import crypto from "node:crypto";

export function verifyGithubSignature(params: {
  secret: string;
  payload: string;
  signature: string | null;
}) {
  if (!params.signature) return false;

  const expected =
    "sha256=" +
    crypto
      .createHmac("sha256", params.secret)
      .update(params.payload, "utf8")
      .digest("hex");

  const expectedBuffer = Buffer.from(expected);
  const actualBuffer = Buffer.from(params.signature);

  if (expectedBuffer.length !== actualBuffer.length) return false;
  return crypto.timingSafeEqual(expectedBuffer, actualBuffer);
}
