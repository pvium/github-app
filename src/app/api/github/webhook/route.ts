import { NextRequest, NextResponse } from "next/server";
import { getEnv } from "@/lib/config/env";
import { verifyGithubSignature } from "@/lib/github/signature";
import { handleGithubWebhook } from "@/lib/github/webhook-handler";

export async function POST(request: NextRequest) {
  const env = getEnv();
  const payloadText = await request.text();
  const signature = request.headers.get("x-hub-signature-256");
  const event = request.headers.get("x-github-event");
  const deliveryId = request.headers.get("x-github-delivery");

  if (!event || !deliveryId) {
    return NextResponse.json(
      { error: "Missing GitHub webhook headers" },
      { status: 400 },
    );
  }

  const validSignature = verifyGithubSignature({
    secret: env.GITHUB_WEBHOOK_SECRET,
    payload: payloadText,
    signature,
  });

  if (!validSignature) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  const payload = JSON.parse(payloadText);
  const result = await handleGithubWebhook({ event, deliveryId, payload });

  return NextResponse.json({ ok: true, result });
}
