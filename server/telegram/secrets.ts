import { createHmac } from "node:crypto";
import { isSafeWebhookSecret } from "./validation";

export function getWebhookSecret() {
  const configured = process.env.WEBHOOK_SECRET;
  if (isSafeWebhookSecret(configured)) return configured;

  const token = process.env.BOT_TOKEN;
  const signingKey = process.env.JWT_SECRET;
  if (!token || !signingKey) return undefined;
  return createHmac("sha256", signingKey).update(`telegram-webhook:${token}`).digest("base64url");
}
