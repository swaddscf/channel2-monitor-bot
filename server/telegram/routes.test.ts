import express from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const stubs = vi.hoisted(() => ({
  processTelegramUpdate: vi.fn(async () => undefined),
  getTelegramIntegrationStatus: vi.fn(async () => ({ ok: true, tokenConfigured: false, webhookSecretConfigured: false, webhookUrl: null })),
  getWebhookInfo: vi.fn(async () => ({ url: "", pending_update_count: 0 })),
  setWebhook: vi.fn(async () => true),
}));

vi.mock("./botService", () => ({ processTelegramUpdate: stubs.processTelegramUpdate }));
vi.mock("./status", () => ({ getTelegramIntegrationStatus: stubs.getTelegramIntegrationStatus }));
vi.mock("./telegramApi", () => ({ getWebhookInfo: stubs.getWebhookInfo, setWebhook: stubs.setWebhook }));

import { registerTelegramRoutes } from "./routes";
import { getWebhookSecret } from "./secrets";

let server: Server;
let base = "";

beforeAll(async () => {
  process.env.JWT_SECRET = "test-jwt-secret";
  process.env.BOT_TOKEN = "123456:test-bot-token";
  const app = express();
  app.use(express.json());
  registerTelegramRoutes(app);
  server = app.listen(0);
  await new Promise<void>(resolve => server.once("listening", () => resolve()));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>(resolve => server.close(() => resolve()));
  delete process.env.JWT_SECRET;
  delete process.env.BOT_TOKEN;
});

beforeEach(() => {
  stubs.processTelegramUpdate.mockClear();
  stubs.getTelegramIntegrationStatus.mockClear();
});

describe("مسارات Telegram", () => {
  it("يعيد حالة التكامل عبر /api/telegram/status", async () => {
    const response = await fetch(`${base}/api/telegram/status`);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ok: true, tokenConfigured: false });
    expect(stubs.getTelegramIntegrationStatus).toHaveBeenCalled();
  });

  it("يرفض Webhook بدون السر الصحيح", async () => {
    const response = await fetch(`${base}/api/telegram/webhook`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-telegram-bot-api-secret-token": "wrong-secret" },
      body: JSON.stringify({ update_id: 1 }),
    });
    expect(response.status).toBe(403);
    expect(stubs.processTelegramUpdate).not.toHaveBeenCalled();
  });

  it("يقبل Webhook بالسر الصحيح ويمرر التحديث", async () => {
    const secret = getWebhookSecret();
    expect(secret).toBeTruthy();
    const update = { update_id: 7, message: { text: "hello" } };
    const response = await fetch(`${base}/api/telegram/webhook`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-telegram-bot-api-secret-token": secret! },
      body: JSON.stringify(update),
    });
    expect(response.status).toBe(200);
    expect(stubs.processTelegramUpdate).toHaveBeenCalledWith(update);
  });
});
