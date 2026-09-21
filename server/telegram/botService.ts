import { cancelLatestActiveJob, cancelMediaJob, claimTelegramUpdate, createMediaJob, deleteMediaJob, ensurePrimaryOwner, getMediaJob, isPrimaryOwner, recordBotError, touchAndAdmitUser, updateMediaJob } from "./botDb";
import { abortYtDlp, downloadMedia, DownloaderError, inspectMediaLink, purgeDownloadedMedia } from "./downloader";
import { DownloadQueueError, getDownloadQueueStats, scheduleDownload } from "./downloadQueue";
import { isValidTelegramUpdateId } from "./policy";
import { PublicLinkError, inspectSupportedUrl } from "./validation";
import { answerCallbackQuery, sendChatAction, sendDownloadedMedia, sendMessage, sendProjectArchive } from "./telegramApi";
import { createProjectArchive, purgeProjectArchive } from "./projectArchive";
import type { MediaChoice, TelegramCallbackQuery, TelegramMessage, TelegramUpdate } from "./types";
import { escapeHtml, HELP_TEXT, inspectionText, mediaChoiceKeyboard, OWNER_KEYBOARD, REPORT_TEXT, retryTikTokKeyboard, USER_KEYBOARD, welcomeText } from "./messages";

const recentRequests = new Map<string, number[]>();
const pendingAdminInputs = new Map<string, { action: "ban" | "unban" | "limit" | "cleanup" | "broadcast" | "addOwner" | "removeOwner"; expiresAt: number }>();
const pendingReports = new Map<string, number>();
let primaryOwnerEnsured = false;
const legacyOwnerLabels: Record<string, string> = {
  "✅ الحاضرون": "✅ النشطون",
  "🔒 حظر مستخدم": "🚫 حظر مستخدم",
  "🔓 فك الحظر": "✅ فك الحظر",
  "📣 رسالة جماعية": "📣 إرسال للجميع",
  "⚙️ حد المستخدمين": "⚙️ سعة البوت",
  "🗓 إعداد التنظيف": "⏱️ مدة التنظيف",
  "🧹 تنظيف البيانات": "🧹 تنظيف الآن",
  "📋 سجلات الأخطاء": "📋 أخطاء حديثة",
  "📦 نسخة المشروع": "📦 تحميل نسخة المشروع",
};
const ownerControlLabels = new Set([
  "📊 الإحصاءات", "👥 آخر المستخدمين", "✅ النشطون", "🌙 غير النشطين", "🚫 المحظورون",
  "🧹 تنظيف الآن", "📋 أخطاء حديثة", "👑 الملاك", "🛑 إلغاء العملية", "↩️ إلغاء الإدخال",
  "🚫 حظر مستخدم", "✅ فك الحظر", "⚙️ سعة البوت", "⏱️ مدة التنظيف", "📣 إرسال للجميع",
  "➕ إضافة مالك", "➖ حذف مالك", "📦 تحميل نسخة المشروع", "/admin",
]);

function allowRequest(telegramId: string) {
  const now = Date.now();
  const entries = (recentRequests.get(telegramId) || []).filter(value => now - value < 60_000);
  if (entries.length >= 5) return false;
  entries.push(now); recentRequests.set(telegramId, entries);
  return true;
}

const recentCallbacks = new Map<string, number[]>();

function allowCallback(telegramId: string, limit = 15) {
  const now = Date.now();
  const entries = (recentCallbacks.get(telegramId) || []).filter(value => now - value < 60_000);
  if (entries.length >= limit) return false;
  entries.push(now); recentCallbacks.set(telegramId, entries);
  return true;
}

function userName(message: TelegramMessage) {
  return message.from?.first_name || "صديقنا";
}

function keyboardFor(primary: boolean) {
  return primary ? OWNER_KEYBOARD : USER_KEYBOARD;
}

function mediaLabel(choice?: string | null) {
  return choice === "video" ? "فيديو" : choice === "audio" ? "صوت" : choice === "image" ? "صورة" : choice === "story" ? "قصة" : "وسيط غير محدد";
}

function errorText(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function isTikTokExtractorError(message: string) {
  return /\[TikTok\].*Unexpected response from webpage request|Unexpected response from webpage request/i.test(message);
}

export function userFacingMediaError(error: unknown) {
  const message = errorText(error);
  if (isTikTokExtractorError(message)) {
    return "تعذر الوصول إلى صفحة TikTok مؤقتاً بسبب حماية المصدر. أعد إرسال الرابط بعد قليل؛ سيحاول البوت متصفحاً متوافقاً تلقائياً.";
  }
  if (error instanceof PublicLinkError || error instanceof DownloaderError) return message;
  return "تعذر فحص الرابط الآن. جرّب رابطاً عاماً آخر لاحقاً.";
}

export function ownerFacingMediaError(error: unknown) {
  const message = errorText(error);
  if (isTikTokExtractorError(message)) {
    return "رفض TikTok طلب الصفحة مؤقتاً. لم يُعرض خطأ المحرك الخام للمستخدم؛ راجع توفر المصدر ثم أعد المحاولة.";
  }
  return message.slice(0, 1000);
}

function isRetryableTikTokFailure(error: unknown, platform?: string) {
  if (platform !== "tiktok") return false;
  const message = errorText(error);
  return /TikTok.*(حماية المصدر|رفض|تعذر الوصول)|\[TikTok\].*Unexpected response from webpage request|Unexpected response from webpage request/i.test(message);
}

function beginAdminInput(telegramId: string, action: "ban" | "unban" | "limit" | "cleanup" | "broadcast" | "addOwner" | "removeOwner") {
  pendingAdminInputs.set(telegramId, { action, expiresAt: Date.now() + 10 * 60_000 });
}

function normalizeOwnerLabel(text: string) {
  return legacyOwnerLabels[text] || text;
}

function isOwnerControlLabel(text: string) {
  return ownerControlLabels.has(normalizeOwnerLabel(text));
}

async function ensureBotPrimaryOwner() {
  if (primaryOwnerEnsured) return;
  await ensurePrimaryOwner();
  primaryOwnerEnsured = true;
}

async function notifyOwners(text: string, options: { replyMarkup?: Record<string, unknown> } = {}) {
  const { listOwners } = await import("./botDb");
  const configuredPrimary = (process.env.OWNER_ID || "").trim();
  const owners = await listOwners().catch(() => []);
  const recipients = Array.from(new Set([...owners.map(owner => owner.telegramId), configuredPrimary].filter(Boolean)));
  await Promise.allSettled(recipients.map(ownerId => sendMessage(ownerId, text, options)));
}

export function buildReportNotification(message: TelegramMessage, report: string) {
  const sender = message.from!;
  const telegramId = String(sender.id);
  const displayName = userName(message);
  const username = sender.username?.replace(/^@/, "").trim();
  const profileUrl = username ? `https://t.me/${encodeURIComponent(username)}` : `tg://user?id=${encodeURIComponent(telegramId)}`;
  const identity = username
    ? `الاسم: <a href="${profileUrl}">${escapeHtml(displayName)}</a>\nالمعرف: @${escapeHtml(username)}`
    : `الاسم: <a href="${profileUrl}">${escapeHtml(displayName)}</a>\nالمعرّف: <code>${telegramId}</code>`;
  return {
    text: `📩 <b>بلاغ جديد</b>\n${identity}\nالمعرّف الرقمي: <code>${telegramId}</code>\n\n<b>التفاصيل</b>\n${escapeHtml(report.slice(0, 2500))}`,
    replyMarkup: {
      inline_keyboard: [[{ text: "👤 فتح ملف المستخدم", url: profileUrl }]],
    },
  };
}

async function notifyError(input: { telegramId?: string; sourceUrl?: string; stage: string; error: unknown; mediaChoice?: MediaChoice }) {
  const message = ownerFacingMediaError(input.error);
  await recordBotError({ telegramId: input.telegramId, sourceUrl: input.sourceUrl, stage: input.stage, message });
  await notifyOwners(`⚠️ <b>خطأ في البوت</b>\nالمرحلة: <b>${escapeHtml(input.stage)}</b>\nالنوع: <b>${mediaLabel(input.mediaChoice)}</b>\nالمستخدم: <code>${escapeHtml(input.telegramId || "غير معروف")}</code>\nالرابط: <code>${escapeHtml(input.sourceUrl || "غير متاح")}</code>\nالخطأ: <code>${escapeHtml(message)}</code>`);
}

async function admitMessage(message: TelegramMessage) {
  if (!message.from || message.chat.type !== "private") return { admitted: false, primary: false };
  await ensureBotPrimaryOwner();
  const admission = await touchAndAdmitUser(message.from);
  const telegramId = String(message.from.id);
  if (admission.admission === "blocked") {
    await sendMessage(String(message.chat.id), "عذراً، لا يمكنك استخدام هذا البوت حالياً.");
    return { admitted: false, primary: false };
  }
  if (admission.admission === "capacity") {
    await sendMessage(String(message.chat.id), "عذراً، وصل البوت إلى الحد الأقصى. حاول لاحقاً بعد التنظيف التلقائي.");
    return { admitted: false, primary: false };
  }
  const primary = await isPrimaryOwner(telegramId);
  if (admission.isNew) {
    await notifyOwners(`👤 <b>مستخدم جديد</b>\nالاسم: <b>${escapeHtml(userName(message))}</b>\nالمعرّف: <code>${telegramId}</code>${message.from.username ? `\nالمعرف: @${escapeHtml(message.from.username)}` : ""}`);
  }
  return { admitted: true, primary };
}

async function inspectIncomingLink(message: TelegramMessage, rawUrl: string, primary: boolean) {
  const telegramId = String(message.from!.id);
  const chatId = String(message.chat.id);
  if (!allowRequest(telegramId)) {
    await sendMessage(chatId, "⏳ لديك طلبات كثيرة خلال الدقيقة. انتظر قليلاً ثم أرسل رابطاً جديداً.", { replyMarkup: keyboardFor(primary) });
    return;
  }
  const { platform } = inspectSupportedUrl(rawUrl);
  const jobId = await createMediaJob(telegramId, rawUrl, platform);
  await sendChatAction(chatId, "typing").catch(() => undefined);
  await sendMessage(chatId, "⌛ <b>جارٍ فحص الرابط…</b> ستظهر خيارات التنزيل المتاحة تلقائياً. يمكنك الضغط على «إلغاء العملية» في أي وقت.", { replyMarkup: keyboardFor(primary) });
  try {
    const result = await inspectMediaLink(rawUrl, jobId);
    const job = await getMediaJob(jobId);
    if (!job || job.cancelRequested) return;
    await updateMediaJob(jobId, { status: "ready", choicesJson: JSON.stringify(result.choices) });
    await sendMessage(chatId, inspectionText(result), { replyMarkup: mediaChoiceKeyboard(jobId, result.choices) });
  } catch (error) {
    if (error instanceof DownloaderError && error.message === "تم إلغاء العملية بنجاح.") return;
    const retryableTikTok = isRetryableTikTokFailure(error, platform);
    if (retryableTikTok) await updateMediaJob(jobId, { status: "failed" });
    else await deleteMediaJob(jobId);
    const messageText = userFacingMediaError(error);
    const retryMarkup = retryableTikTok ? retryTikTokKeyboard(jobId) : keyboardFor(primary);
    const retryHint = retryableTikTok ? "\n\nيمكنك الضغط على «إعادة محاولة TikTok» لإعادة الفحص تلقائياً." : "";
    await sendMessage(chatId, `تعذر إكمال الفحص.\n<b>${escapeHtml(messageText)}</b>${retryHint}`, { replyMarkup: retryMarkup });
    await notifyError({ telegramId, sourceUrl: rawUrl, stage: "فحص الرابط", error });
  }
}

function formatStats(stats: Awaited<ReturnType<typeof import("./botDb")["botStats"]>>) {
  return `📊 <b>إحصاءات سريعة</b>\n\nالمستخدمون: <b>${stats.total}</b> / ${stats.settings.maxUsers}\nالنشطون اليوم: <b>${stats.activeToday}</b>\nالجدد اليوم: <b>${stats.joinedToday}</b>\nالمحظورون: <b>${stats.blocked}</b>\nغير النشطين: <b>${stats.inactive}</b>\nالتنظيف بعد: <b>${stats.settings.cleanupInactiveDays} يوماً</b>`;
}

async function sendAdminPanel(chatId: string) {
  await sendMessage(chatId, "👑 <b>لوحة المالك الأساسية</b>\nاختر وظيفة من الأزرار. عند الحاجة لرقم أو نص سأطلبه منك في رسالة منفصلة؛ لا تحتاج إلى حفظ الأوامر.", { replyMarkup: OWNER_KEYBOARD });
}

async function sendUserList(chatId: string, title: string, users: Awaited<ReturnType<typeof import("./botDb")["listTelegramUsers"]>>) {
  if (!users.length) return sendMessage(chatId, `لا توجد نتائج في قائمة «${title}».`, { replyMarkup: OWNER_KEYBOARD });
  const lines = users.map((user, index) => `${index + 1}. <b>${escapeHtml(user.displayName)}</b>${user.username ? ` (@${escapeHtml(user.username)})` : ""}\n<code>${user.telegramId}</code> — ${user.status === "blocked" ? "محظور" : "نشط"}`);
  return sendMessage(chatId, `👥 <b>${title}</b>\n\n${lines.join("\n")}`, { replyMarkup: OWNER_KEYBOARD });
}

async function handleOwnerButton(message: TelegramMessage, text: string) {
  const chatId = String(message.chat.id);
  const telegramId = String(message.from!.id);
  text = normalizeOwnerLabel(text);
  if (text === "📊 الإحصاءات") { const { botStats } = await import("./botDb"); await sendMessage(chatId, formatStats(await botStats()), { replyMarkup: OWNER_KEYBOARD }); return true; }
  if (text === "👥 آخر المستخدمين") { const { listTelegramUsers } = await import("./botDb"); await sendUserList(chatId, "آخر 50 مستخدماً", await listTelegramUsers("recent")); return true; }
  if (text === "✅ النشطون") { const { listTelegramUsers } = await import("./botDb"); await sendUserList(chatId, "المستخدمون النشطون", await listTelegramUsers("active")); return true; }
  if (text === "🌙 غير النشطين") { const { listTelegramUsers } = await import("./botDb"); await sendUserList(chatId, "المستخدمون غير النشطين", await listTelegramUsers("inactive")); return true; }
  if (text === "🚫 المحظورون") { const { listTelegramUsers } = await import("./botDb"); await sendUserList(chatId, "المستخدمون المحظورون", await listTelegramUsers("blocked")); return true; }
  if (text === "🧹 تنظيف الآن") {
    const { cleanupBotData } = await import("./botDb");
    const result = await cleanupBotData();
    await sendMessage(chatId, `تم التنظيف. أزيلت سجلات <b>${result.removedInactiveUsers}</b> مستخدم غير نشط والعمليات المؤقتة المنتهية.`, { replyMarkup: OWNER_KEYBOARD });
    return true;
  }
  if (text === "📋 أخطاء حديثة") {
    const { recentErrors } = await import("./botDb");
    const errors = await recentErrors(8);
    await sendMessage(chatId, errors.length ? `📋 <b>آخر الأخطاء</b>\n\n${errors.map(error => `• <b>${escapeHtml(error.stage)}</b> — <code>${escapeHtml(error.telegramId || "—")}</code>\n${escapeHtml(error.message.slice(0, 160))}`).join("\n\n")}` : "لا توجد أخطاء مسجلة حالياً.", { replyMarkup: OWNER_KEYBOARD });
    return true;
  }
  if (text === "👑 الملاك") {
    const { listOwners } = await import("./botDb");
    const owners = await listOwners();
    await sendMessage(chatId, `👑 <b>الملاك والتنبيهات</b>\n${owners.map(owner => `• <code>${owner.telegramId}</code> — ${owner.role === "primary" ? "المالك الأساسي" : "يتلقى التنبيهات"}`).join("\n")}`, { replyMarkup: OWNER_KEYBOARD });
    return true;
  }
  if (text === "🛑 إلغاء العملية") {
    const { cancelLatestActiveJob } = await import("./botDb");
    const cancelled = await cancelLatestActiveJob(telegramId);
    if (cancelled) abortYtDlp(cancelled);
    await sendMessage(chatId, cancelled ? "تم إلغاء آخر عملية نشطة." : "لا توجد عملية قابلة للإلغاء.", { replyMarkup: OWNER_KEYBOARD });
    return true;
  }
  if (text === "📦 تحميل نسخة المشروع") {
    let archive: Awaited<ReturnType<typeof createProjectArchive>> | undefined;
    await sendMessage(chatId, "📦 جارٍ تجهيز نسخة المشروع الآمنة. لا تتضمن هذه النسخة أي توكن أو سر أو ملف مؤقت…", { replyMarkup: OWNER_KEYBOARD });
    try {
      archive = await createProjectArchive();
      await sendProjectArchive(chatId, archive.archivePath, `📦 <b>نسخة مشروع البوت</b>\nالحجم: <b>${Math.round(archive.bytes / 1024)} KB</b>\nلا تتضمن النسخة الأسرار أو ملفات الوسائط المؤقتة.`);
    } catch (error) {
      await sendMessage(chatId, `تعذر إنشاء النسخة: <b>${escapeHtml(error instanceof Error ? error.message : "خطأ غير متوقع")}</b>`, { replyMarkup: OWNER_KEYBOARD });
    } finally {
      if (archive) await purgeProjectArchive(archive.workdir);
    }
    return true;
  }
  const inputs: Record<string, { action: "ban" | "unban" | "limit" | "cleanup" | "broadcast" | "addOwner" | "removeOwner"; prompt: string }> = {
    "🚫 حظر مستخدم": { action: "ban", prompt: "أرسل الآن رقم المستخدم أو @username لحظره." },
    "✅ فك الحظر": { action: "unban", prompt: "أرسل الآن رقم المستخدم أو @username لفك الحظر." },
    "⚙️ سعة البوت": { action: "limit", prompt: "أرسل العدد الجديد للسعة، مثل: 100" },
    "⏱️ مدة التنظيف": { action: "cleanup", prompt: "أرسل عدد الأيام قبل تنظيف غير النشطين، من 7 إلى 365." },
    "📣 إرسال للجميع": { action: "broadcast", prompt: "أرسل الآن نص الرسالة. ستصل للمستخدمين النشطين فقط." },
    "➕ إضافة مالك": { action: "addOwner", prompt: "أرسل المعرّف الرقمي للمالك الذي سيستلم التنبيهات." },
    "➖ حذف مالك": { action: "removeOwner", prompt: "أرسل المعرّف الرقمي للمالك المراد حذفه من قائمة التنبيهات." },
  };
  if (inputs[text]) {
    beginAdminInput(telegramId, inputs[text].action);
    await sendMessage(chatId, `✍️ ${inputs[text].prompt}\nيمكنك الإلغاء بزر «إلغاء الإدخال».`, { replyMarkup: OWNER_KEYBOARD });
    return true;
  }
  if (text === "↩️ إلغاء الإدخال") {
    pendingAdminInputs.delete(telegramId);
    await sendMessage(chatId, "تم إلغاء الإدخال الحالي.", { replyMarkup: OWNER_KEYBOARD });
    return true;
  }
  return false;
}

async function handlePendingAdminInput(message: TelegramMessage, text: string) {
  const telegramId = String(message.from!.id);
  const pending = pendingAdminInputs.get(telegramId);
  if (!pending) return false;
  if (pending.expiresAt < Date.now()) {
    pendingAdminInputs.delete(telegramId);
    await sendMessage(String(message.chat.id), "انتهت مهلة الإدخال. اختر الزر المطلوب مجدداً.", { replyMarkup: OWNER_KEYBOARD });
    return true;
  }
  const chatId = String(message.chat.id);
  const { activeRecipients, addOwner, removeOwner, setTelegramUserBlocked, updateCleanupInactiveDays, updateMaxUsers } = await import("./botDb");
  try {
    if (pending.action === "ban" || pending.action === "unban") {
      const user = await setTelegramUserBlocked(text, pending.action === "ban");
      if (!user) throw new Error("لم يتم العثور على المستخدم بهذا المعرف أو الاسم.");
      await notifyOwners(`${pending.action === "ban" ? "🚫" : "✅"} <b>تعديل حالة مستخدم</b>\nالمستخدم: <code>${user.telegramId}</code>\nبواسطة المالك: <code>${telegramId}</code>`);
      await sendMessage(chatId, `تم ${pending.action === "ban" ? "حظر" : "فك حظر"} المستخدم بنجاح.`, { replyMarkup: OWNER_KEYBOARD });
    } else if (pending.action === "limit") {
      const value = Number(text);
      await updateMaxUsers(value);
      await sendMessage(chatId, `تم ضبط السعة إلى <b>${value}</b> مستخدم.`, { replyMarkup: OWNER_KEYBOARD });
    } else if (pending.action === "cleanup") {
      const value = Number(text);
      await updateCleanupInactiveDays(value);
      await sendMessage(chatId, `تم ضبط التنظيف بعد <b>${value}</b> يوماً من عدم النشاط.`, { replyMarkup: OWNER_KEYBOARD });
    } else if (pending.action === "addOwner" || pending.action === "removeOwner") {
      if (!/^\d+$/.test(text.trim())) throw new Error("أدخل معرف تلغرام رقمي صحيح.");
      const changed = pending.action === "addOwner" ? await addOwner(text.trim(), telegramId) : await removeOwner(text.trim());
      if (!changed) throw new Error("لم يتغير شيء. تحقق من المعرّف.");
      await notifyOwners(`👑 <b>تعديل قائمة الملاك</b>\nالإجراء: ${pending.action === "addOwner" ? "إضافة" : "حذف"}\nالمعرّف: <code>${escapeHtml(text.trim())}</code>`);
      await sendMessage(chatId, "تم تعديل قائمة الملاك بنجاح.", { replyMarkup: OWNER_KEYBOARD });
    } else {
      const content = text.trim();
      if (!content || content.length > 3500) throw new Error("اكتب رسالة بين 1 و3500 حرفاً.");
      const recipients = await activeRecipients();
      await sendMessage(chatId, `📣 بدأ الإرسال إلى <b>${recipients.length}</b> مستخدماً نشطاً…`, { replyMarkup: OWNER_KEYBOARD });
      let success = 0; let failed = 0;
      for (let index = 0; index < recipients.length; index += 20) {
        const result = await Promise.allSettled(recipients.slice(index, index + 20).map(user => sendMessage(user.telegramId, escapeHtml(content))));
        result.forEach(entry => entry.status === "fulfilled" ? success += 1 : failed += 1);
        if (index + 20 < recipients.length) await new Promise(resolve => setTimeout(resolve, 1_000));
      }
      await sendMessage(chatId, `تم الإرسال.\nالناجح: <b>${success}</b>\nالمتعذر: <b>${failed}</b>`, { replyMarkup: OWNER_KEYBOARD });
    }
  } catch (error) {
    await sendMessage(chatId, `تعذر التنفيذ: <b>${escapeHtml(error instanceof Error ? error.message : "خطأ غير متوقع")}</b>`, { replyMarkup: OWNER_KEYBOARD });
  } finally {
    pendingAdminInputs.delete(telegramId);
  }
  return true;
}

async function handleMessage(message: TelegramMessage) {
  const admission = await admitMessage(message);
  if (!admission.admitted || !message.text) return;
  const text = message.text.trim();
  const chatId = String(message.chat.id);
  const telegramId = String(message.from!.id);

  if (admission.primary) {
    if (text === "/admin") {
      pendingAdminInputs.delete(telegramId);
      return sendAdminPanel(chatId);
    }
    if (isOwnerControlLabel(text)) {
      pendingAdminInputs.delete(telegramId);
      if (await handleOwnerButton(message, text)) return;
    }
    if (await handlePendingAdminInput(message, text)) return;
  }

  if (text === "/start") return sendMessage(chatId, welcomeText(userName(message)), { replyMarkup: keyboardFor(admission.primary) });
  if (text === "/help" || text === "❔ طريقة الاستخدام") return sendMessage(chatId, HELP_TEXT, { replyMarkup: keyboardFor(admission.primary) });
  if (text === "📩 إرسال بلاغ") {
    pendingReports.set(telegramId, Date.now() + 10 * 60_000);
    return sendMessage(chatId, "أرسل الآن الرابط أو وصف المشكلة باختصار. سيصل للمالك مع اسمك ورابط مباشر لملفك لتسهيل المتابعة.", { replyMarkup: keyboardFor(admission.primary) });
  }
  if (text === "/report") return sendMessage(chatId, REPORT_TEXT, { replyMarkup: keyboardFor(admission.primary) });
  if (text.startsWith("/report ") || (pendingReports.get(telegramId) || 0) > Date.now()) {
    pendingReports.delete(telegramId);
    const report = text.startsWith("/report ") ? text.slice(8).trim() : text;
    if (!report) return sendMessage(chatId, "اكتب رابطاً أو وصفاً مختصراً للمشكلة ثم أرسله مرة أخرى.", { replyMarkup: keyboardFor(admission.primary) });
    const notification = buildReportNotification(message, report);
    await notifyOwners(notification.text, { replyMarkup: notification.replyMarkup });
    return sendMessage(chatId, "تم إرسال البلاغ للمالك مع بيانات التواصل اللازمة. شكراً لمساعدتك.", { replyMarkup: keyboardFor(admission.primary) });
  }
  if (text === "/cancel" || text === "🛑 إلغاء العملية") {
    const cancelled = await cancelLatestActiveJob(telegramId);
    if (cancelled) abortYtDlp(cancelled);
    const cancelledJob = cancelled ? await getMediaJob(cancelled) : undefined;
    if (cancelled) await notifyOwners(`🛑 <b>ألغى مستخدم عملية تنزيل</b>\nالمستخدم: <code>${telegramId}</code>\nالنوع: <b>${mediaLabel(cancelledJob?.selectedChoice)}</b>\nالمهمة: <code>${cancelled}</code>`);
    return sendMessage(chatId, cancelled ? "تم إلغاء العملية. لن يُرسل الملف إذا لم يكتمل بعد." : "لا توجد عملية قابلة للإلغاء.", { replyMarkup: keyboardFor(admission.primary) });
  }
  if (!/^https:\/\//i.test(text)) return sendMessage(chatId, "أرسل رابطاً عاماً يبدأ بـ https:// أو اضغط «طريقة الاستخدام».", { replyMarkup: keyboardFor(admission.primary) });
  await inspectIncomingLink(message, text, admission.primary);
}

async function handleDownloadCallback(callback: TelegramCallbackQuery) {
  const chatId = callback.message ? String(callback.message.chat.id) : String(callback.from.id);
  const data = callback.data || "";
  const senderId = String(callback.from.id);
  const primary = await isPrimaryOwner(senderId);
  if (data.startsWith("cancel:")) {
    const cancelJob = await getMediaJob(data.slice(7));
    const cancelled = await cancelMediaJob(data.slice(7), senderId);
    if (cancelled) abortYtDlp(data.slice(7));
    if (cancelled) await notifyOwners(`🛑 <b>ألغى مستخدم عملية تنزيل</b>\nالمستخدم: <code>${senderId}</code>\nالنوع: <b>${mediaLabel(cancelJob?.selectedChoice)}</b>\nالمهمة: <code>${escapeHtml(data.slice(7))}</code>`);
    await answerCallbackQuery(callback.id, cancelled ? "تم الإلغاء" : "لا توجد عملية قابلة للإلغاء");
    return sendMessage(chatId, cancelled ? "تم إلغاء العملية." : "لا توجد عملية قابلة للإلغاء.", { replyMarkup: keyboardFor(primary) });
  }
  if (data.startsWith("retry_tiktok:")) {
    const retryJobId = data.slice("retry_tiktok:".length);
    const retryJob = await getMediaJob(retryJobId);
    const expired = !retryJob || new Date(retryJob.expiresAt).getTime() <= Date.now();
    if (expired || retryJob.telegramId !== senderId || retryJob.platform !== "tiktok" || retryJob.status !== "failed") {
      return answerCallbackQuery(callback.id, "انتهت صلاحية إعادة المحاولة. أرسل الرابط من جديد.");
    }
    await deleteMediaJob(retryJobId);
    await answerCallbackQuery(callback.id, "جارٍ إعادة فحص الرابط");
    await inspectIncomingLink({
      message_id: callback.message?.message_id || 0,
      chat: callback.message?.chat || { id: chatId, type: "private" },
      from: callback.from,
      text: retryJob.sourceUrl,
    }, retryJob.sourceUrl, primary);
    return;
  }
  const [, jobId, rawChoice] = data.split(":");
  if (!jobId || !["video", "audio", "image", "story"].includes(rawChoice)) return answerCallbackQuery(callback.id, "طلب غير صالح");
  if (!allowCallback(senderId)) return answerCallbackQuery(callback.id, "💡 أنت تضغط بسرعة. انتظر قليلاً ثم أعد المحاولة.");
  const choice = rawChoice as MediaChoice;
  const job = await getMediaJob(jobId);
  if (!job || job.telegramId !== senderId || job.status !== "ready" || job.cancelRequested) return answerCallbackQuery(callback.id, "انتهت صلاحية هذا الطلب");
  await answerCallbackQuery(callback.id, "بدأ تجهيز الملف");
  await updateMediaJob(jobId, { status: "downloading", selectedChoice: choice });
  const action: "upload_video" | "upload_audio" | "upload_photo" = choice === "video" || choice === "story" ? "upload_video" : choice === "audio" ? "upload_audio" : "upload_photo";
  let workdir: string | undefined;
  let preserveRetryJob = false;
  let deleteJobOnFinish = true;
  try {
    const queued = scheduleDownload(async () => {
      const beforeDownload = await getMediaJob(jobId);
      if (!beforeDownload || beforeDownload.cancelRequested) throw new DownloaderError("تم إلغاء العملية بنجاح.");
      await sendChatAction(chatId, action).catch(() => undefined);
      return downloadMedia(job.sourceUrl, choice, jobId);
    });
    const queueMessage = queued.position > 1
      ? `⏳ <b>طلبك في صف التنزيل</b> — أمامك <b>${queued.position - 1}</b> طلب. سيبدأ تلقائياً ويمكنك الإلغاء الآن.`
      : "⏳ <b>جارٍ تجهيز الملف الآن…</b> ستصلك النتيجة هنا فور اكتمالها، ويمكنك الإلغاء في أي وقت.";
    await sendMessage(chatId, queueMessage, { replyMarkup: keyboardFor(primary) });
    const output = await queued.completion;
    workdir = output.workdir;
    const latest = await getMediaJob(jobId);
    if (!latest || latest.cancelRequested) return;
    await sendChatAction(chatId, action).catch(() => undefined);
    await sendDownloadedMedia(chatId, choice, output.filePath, "✅ <b>اكتمل التنزيل</b> — الملف أُرسل بنجاح وسيُحذف من الخادم الآن.");
    await updateMediaJob(jobId, { status: "sent" });
    await notifyOwners(`✅ <b>تنزيل مكتمل</b>\nالمستخدم: <code>${senderId}</code>\nالنوع: <b>${mediaLabel(choice)}</b>\nالحجم: <b>${Math.round(output.bytes / 1024)} KB</b>\nالرابط: <code>${escapeHtml(job.sourceUrl.slice(0, 500))}</code>`);
  } catch (error) {
    if (error instanceof DownloaderError && error.message === "تم إلغاء العملية بنجاح.") return;
    if (error instanceof DownloadQueueError) {
      const queue = getDownloadQueueStats();
      deleteJobOnFinish = false;
      await updateMediaJob(jobId, { status: "ready" });
      await sendMessage(chatId, `⏳ ${escapeHtml(error.message)}\n\n<b>اضغط على زر التنزيل مجدداً بعد لحظات وسنستأنف العمل تلقائياً.</b>`, { replyMarkup: keyboardFor(primary) });
      await notifyOwners(`📈 <b>تنبيه ضغط</b>\nامتلأ صف التنزيل.\nقيد التنفيذ: <b>${queue.active}</b>\nفي الانتظار: <b>${queue.waiting}</b>`);
      return;
    }
    await updateMediaJob(jobId, { status: "failed" });
    preserveRetryJob = isRetryableTikTokFailure(error, job.platform);
    const retryMarkup = preserveRetryJob ? retryTikTokKeyboard(jobId) : keyboardFor(primary);
    const retryHint = preserveRetryJob ? "\n\nيمكنك الضغط على «إعادة محاولة TikTok» لإعادة الفحص تلقائياً." : "";
    await sendMessage(chatId, `تعذر إكمال التنزيل.\n<b>${escapeHtml(userFacingMediaError(error))}</b>${retryHint}`, { replyMarkup: retryMarkup });
    await notifyError({ telegramId: senderId, sourceUrl: job.sourceUrl, stage: "تنزيل وإرسال", error, mediaChoice: choice });
  } finally {
    if (workdir) await purgeDownloadedMedia(workdir);
    if (!preserveRetryJob && deleteJobOnFinish) await deleteMediaJob(jobId);
  }
}

export async function processTelegramUpdate(update: TelegramUpdate) {
  if (!isValidTelegramUpdateId(update.update_id)) return;
  if (!(await claimTelegramUpdate(update.update_id))) return;
  try {
    if (update.message) return handleMessage(update.message);
    if (update.callback_query) return handleDownloadCallback(update.callback_query);
  } catch (error) {
    const telegramId = update.message?.from ? String(update.message.from.id) : update.callback_query ? String(update.callback_query.from.id) : undefined;
    await notifyError({ telegramId, stage: "معالجة تحديث Telegram", error });
    throw error;
  }
}
