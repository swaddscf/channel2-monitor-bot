import { describe, expect, it } from "vitest";
import { getWebhookSecret } from "./secrets";
import { isSafeWebhookSecret } from "./validation";

const runCredentialCheck = process.env.RUN_TELEGRAM_CREDENTIAL_TESTS === "1";

describe("اعتماد Telegram", () => {
  it.runIf(runCredentialCheck)("يتحقق من توكن البوت ومعرّف المالك عبر getMe", async () => {
    const token = process.env.BOT_TOKEN;
    const ownerId = process.env.OWNER_ID;
    expect(token).toMatch(/^\d{6,}:[A-Za-z0-9_-]{20,}$/);
    expect(ownerId).toMatch(/^\d+$/);

    const response = await fetch(`https://api.telegram.org/bot${token}/getMe`);
    expect(response.ok).toBe(true);
    const payload = await response.json() as { ok?: boolean; result?: { id?: number; is_bot?: boolean } };
    expect(payload.ok).toBe(true);
    expect(payload.result?.is_bot).toBe(true);
    expect(typeof payload.result?.id).toBe("number");
  }, 20_000);

  it.runIf(runCredentialCheck)("يشتق سراً صالحاً وثابتاً لـ Webhook من أسرار الخادم", () => {
    const first = getWebhookSecret();
    const second = getWebhookSecret();
    expect(first).toBeDefined();
    expect(first).toBe(second);
    expect(isSafeWebhookSecret(first)).toBe(true);
  });
});
