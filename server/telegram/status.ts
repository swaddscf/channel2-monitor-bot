import { isSafeWebhookSecret } from "./validation";

import { getWebhookSecret } from "./secrets";
import { getWebhookInfo } from "./telegramApi";

export async function getTelegramIntegrationStatus() {
  const webhookUrl = process.env.WEBHOOK_URL;
  const webhookSecret = getWebhookSecret();
  const base = {
    tokenConfigured: Boolean(process.env.BOT_TOKEN),
    ownerConfigured: Boolean(process.env.OWNER_ID && /^\d+$/.test(process.env.OWNER_ID)),
    webhookSecretConfigured: Boolean(webhookSecret),
    webhookSecretMode: process.env.WEBHOOK_SECRET ? "configured" : webhookSecret ? "derived" : "missing",
    webhookUrlConfigured: Boolean(webhookUrl && webhookUrl.startsWith("https://")),
    webhookUrlValid: Boolean(webhookUrl && /^https:\/\/.+\/api\/telegram\/webhook$/.test(webhookUrl)),
    webhookPath: "/api/telegram/webhook",
    webhookUrlMode: webhookUrl ? "configured" : "activation-derived",
  };
  if (!base.tokenConfigured) return { ...base, webhookActive: false, pendingUpdates: 0 };
  try {
    const info = await getWebhookInfo();
    return { ...base, webhookActive: Boolean(info.url), pendingUpdates: info.pending_update_count || 0 };
  } catch {
    return { ...base, webhookActive: false, pendingUpdates: 0 };
  }
}
