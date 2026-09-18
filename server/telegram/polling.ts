import { processTelegramUpdate } from "./botService";
import { deleteWebhook, getUpdates, TelegramApiError } from "./telegramApi";

const POLL_TIMEOUT_SECONDS = 30;
const RETRY_DELAY_MS = 3_000;

let running = false;
let stopped = false;

export function isPollingEnabled() {
  const value = (process.env.TELEGRAM_POLLING || "").trim().toLowerCase();
  return value === "1" || value === "true" || value === "yes";
}

export async function startTelegramPolling() {
  if (running) return;
  if (!process.env.BOT_TOKEN) {
    console.warn("[Telegram polling] تم تجاهل وضع الاستعلام لأن BOT_TOKEN غير مُعد.");
    return;
  }
  running = true;
  stopped = false;
  try {
    await deleteWebhook();
  } catch (error) {
    console.warn("[Telegram polling] تعذر حذف Webhook قبل الاستعلام؛ سأتابع على أي حال.", error);
  }
  console.log("[Telegram polling] بدأ الاستعلام المحلي عبر getUpdates. اضغط Ctrl+C للإيقاف.");
  void pollLoop();
}

export function stopTelegramPolling() {
  stopped = true;
}

async function pollLoop() {
  let offset: number | undefined;
  while (!stopped) {
    try {
      const updates = await getUpdates(offset, POLL_TIMEOUT_SECONDS);
      for (const update of updates) {
        offset = update.update_id + 1;
        try {
          await processTelegramUpdate(update);
        } catch (error) {
          console.error("[Telegram polling] فشل معالجة تحديث.", error);
        }
      }
    } catch (error) {
      if (stopped) break;
      const message = error instanceof TelegramApiError ? error.message : String(error);
      console.error(`[Telegram polling] خطأ في getUpdates: ${message}`);
      await delay(RETRY_DELAY_MS);
    }
  }
  running = false;
}

function delay(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
