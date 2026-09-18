import { readFile } from "node:fs/promises";
import dns from "node:dns";
import net from "node:net";
import path from "node:path";
import type { MediaChoice, TelegramUpdate } from "./types";

const API_ROOT = "https://api.telegram.org";

// Telegram is reachable over IPv4 here; prefer IPv4 and skip Happy Eyeballs so
// requests do not hang on an unreachable IPv6 route.
dns.setDefaultResultOrder("ipv4first");
net.setDefaultAutoSelectFamily(false);

export class TelegramApiError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TelegramApiError";
  }
}

function token() {
  const value = process.env.BOT_TOKEN;
  if (!value) throw new TelegramApiError("لم يتم إعداد BOT_TOKEN بعد.");
  return value;
}

async function telegramRequest<T>(method: string, body: BodyInit, headers?: HeadersInit, timeoutMs = 20_000): Promise<T> {
  const response = await fetch(`${API_ROOT}/bot${token()}/${method}`, {
    method: "POST",
    headers,
    body,
    signal: AbortSignal.timeout(timeoutMs),
  });
  const payload = (await response.json().catch(() => null)) as { ok?: boolean; result?: T; description?: string } | null;
  if (!response.ok || !payload?.ok) {
    throw new TelegramApiError(payload?.description || `فشل Telegram API في ${method}.`);
  }
  return payload.result as T;
}

export async function sendMessage(
  chatId: string,
  text: string,
  options: { replyMarkup?: Record<string, unknown>; disablePreview?: boolean } = {},
) {
  return telegramRequest<number>(
    "sendMessage",
    JSON.stringify({
      chat_id: chatId,
      text,
      parse_mode: "HTML",
      disable_web_page_preview: options.disablePreview ?? true,
      reply_markup: options.replyMarkup,
    }),
    { "content-type": "application/json" },
  );
}

export type ChatAction = "typing" | "upload_photo" | "upload_video" | "record_voice" | "upload_voice" | "upload_audio" | "upload_document" | "choose_sticker" | "find_location" | "record_video_note" | "upload_video_note";

export async function sendChatAction(chatId: string, action: ChatAction) {
  return telegramRequest<boolean>(
    "sendChatAction",
    JSON.stringify({ chat_id: chatId, action }),
    { "content-type": "application/json" },
  );
}

export async function answerCallbackQuery(callbackQueryId: string, text?: string) {
  return telegramRequest<boolean>(
    "answerCallbackQuery",
    JSON.stringify({ callback_query_id: callbackQueryId, text, show_alert: false }),
    { "content-type": "application/json" },
  );
}

export async function sendDownloadedMedia(
  chatId: string,
  choice: MediaChoice,
  localPath: string,
  caption: string,
) {
  const file = await readFile(localPath);
  const form = new FormData();
  form.set("chat_id", chatId);
  form.set("caption", caption);
  form.set("parse_mode", "HTML");
  const field = choice === "image" ? "photo" : choice === "audio" ? "audio" : "video";
  const method = choice === "image" ? "sendPhoto" : choice === "audio" ? "sendAudio" : "sendVideo";
  form.set(field, new Blob([file as unknown as BlobPart]), path.basename(localPath));
  return telegramRequest<number>(method, form);
}

export async function sendProjectArchive(chatId: string, localPath: string, caption: string) {
  const file = await readFile(localPath);
  const form = new FormData();
  form.set("chat_id", chatId);
  form.set("caption", caption);
  form.set("parse_mode", "HTML");
  form.set("document", new Blob([file as unknown as BlobPart]), path.basename(localPath));
  return telegramRequest<number>("sendDocument", form);
}

export async function getWebhookInfo() {
  return telegramRequest<{ url?: string; pending_update_count?: number; last_error_message?: string }>(
    "getWebhookInfo",
    JSON.stringify({}),
    { "content-type": "application/json" },
  );
}

export async function setWebhook(webhookUrl: string, secretToken: string) {
  return telegramRequest<boolean>(
    "setWebhook",
    JSON.stringify({
      url: webhookUrl,
      secret_token: secretToken,
      allowed_updates: ["message", "callback_query"],
      max_connections: 10,
    }),
  );
}

export async function deleteWebhook() {
  return telegramRequest<boolean>(
    "deleteWebhook",
    JSON.stringify({ drop_pending_updates: false }),
    { "content-type": "application/json" },
  );
}

export async function getUpdates(offset?: number, timeoutSeconds = 30) {
  return telegramRequest<TelegramUpdate[]>(
    "getUpdates",
    JSON.stringify({
      offset,
      timeout: timeoutSeconds,
      allowed_updates: ["message", "callback_query"],
    }),
    { "content-type": "application/json" },
    (timeoutSeconds + 10) * 1_000,
  );
}
