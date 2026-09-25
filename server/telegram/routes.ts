import type { Express, Request, Response } from "express";
import { processTelegramUpdate } from "./botService";
import { isPollingEnabled } from "./polling";
import { getWebhookSecret } from "./secrets";
import { getTelegramIntegrationStatus } from "./status";
import { matchesWebhookSecret } from "./validation";
import { getWebhookInfo, setWebhook } from "./telegramApi";
import type { TelegramUpdate } from "./types";

const ACTIVATION_COOLDOWN_MS = 60_000;
let activationInFlight: Promise<{ url: string | null; pendingUpdates: number; reused: boolean }> | undefined;
let lastActivationAt = 0;

async function ensureTelegramWebhook(webhookUrl: string, secret: string) {
  const existing = await getWebhookInfo();
  if (existing.url === webhookUrl) {
    return { url: existing.url || null, pendingUpdates: existing.pending_update_count || 0, reused: true };
  }
  await setWebhook(webhookUrl, secret);
  const updated = await getWebhookInfo();
  return { url: updated.url || null, pendingUpdates: updated.pending_update_count || 0, reused: false };
}

export function registerTelegramRoutes(app: Express) {
  app.get("/healthz", (_req: Request, res: Response) => {
    res.json({ ok: true, uptimeSeconds: Math.round(process.uptime()), polling: isPollingEnabled() });
  });

  app.get("/api/telegram/status", async (_req: Request, res: Response) => {
    res.json({ ok: true, ...(await getTelegramIntegrationStatus()) });
  });

  app.post("/api/telegram/activate", async (req: Request, res: Response) => {
    if (isPollingEnabled()) {
      return res.status(409).json({ ok: false, error: "polling mode is enabled; remove TELEGRAM_POLLING to use the webhook and avoid duplicated updates" });
    }
    const status = await getTelegramIntegrationStatus();
    const secret = getWebhookSecret();
    const forwardedProtocol = req.header("x-forwarded-proto")?.split(",")[0]?.trim();
    const protocol = forwardedProtocol === "https" ? "https" : req.protocol;
    const host = req.get("host");
    if (protocol !== "https") {
      return res.status(403).json({ ok: false, error: "activation requires the published HTTPS domain" });
    }
    const configuredUrl = process.env.WEBHOOK_URL;
    const webhookUrl = configuredUrl || (host ? `${protocol}://${host}/api/telegram/webhook` : undefined);
    if (!status.tokenConfigured || !status.webhookSecretConfigured || !webhookUrl || !/^https:\/\/.+\/api\/telegram\/webhook$/.test(webhookUrl)) {
      return res.status(422).json({ ok: false, error: "integration setup is incomplete; activate from the published HTTPS domain" });
    }
    try {
      const now = Date.now();
      if (activationInFlight) {
        const result = await activationInFlight;
        return res.json({ ok: true, ...result, shared: true });
      }
      if (now - lastActivationAt < ACTIVATION_COOLDOWN_MS) {
        return res.status(429).json({ ok: false, error: "activation cooldown", retryAfterSeconds: Math.ceil((ACTIVATION_COOLDOWN_MS - (now - lastActivationAt)) / 1000) });
      }
      activationInFlight = ensureTelegramWebhook(webhookUrl, secret!);
      const result = await activationInFlight;
      return res.json({ ok: true, ...result, shared: false });
    } catch (error) {
      console.error("[Telegram webhook] Activation failed", error);
      return res.status(502).json({ ok: false, error: "Telegram رفض تفعيل Webhook. تحقق من التوكن والرابط العام." });
    } finally {
      lastActivationAt = Date.now();
      activationInFlight = undefined;
    }
  });

  app.post("/api/telegram/webhook", async (req: Request, res: Response) => {
    const secret = getWebhookSecret();
    const suppliedSecret = req.header("x-telegram-bot-api-secret-token");
    if (!matchesWebhookSecret(secret, suppliedSecret)) {
      return res.status(403).json({ ok: false, error: "invalid webhook secret" });
    }
    try {
      await processTelegramUpdate(req.body as TelegramUpdate);
      return res.status(200).json({ ok: true });
    } catch (error) {
      console.error("[Telegram webhook] Update processing failed", error);
      return res.status(500).json({ ok: false });
    }
  });
}
