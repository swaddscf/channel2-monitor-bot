import { addForcedSubscription, addSubscriptionPlan, cancelLatestActiveJob, cancelMediaJob, claimTelegramUpdate, createMediaJob, deleteMediaJob, ensureBotSettings, ensurePrimaryOwner, findSubscriptionPlanById, getMediaJob, getOwnerRole, getTelegramUser, getUserAccess, isPrimaryOwner, listForcedSubscriptions, listSubscriptionPlans, recordBotError, recordUserDownload, removeForcedSubscription, setSubscriptionPlanActive, setUserSubscription, touchAndAdmitUser, updateMediaJob, updatePaidMode, updateUsageLimit, userDownloadsInWindow } from "./botDb";
import { abortYtDlp, downloadAllImages, downloadMedia, DownloaderError, inspectMediaLink, purgeDownloadedMedia } from "./downloader";
import { DownloadQueueError, getDownloadQueueStats, scheduleDownload } from "./downloadQueue";
import { isValidTelegramUpdateId } from "./policy";
import { inspectSupportedUrl, parseSubscriptionTarget, PublicLinkError } from "./validation";
import { answerCallbackQuery, answerPreCheckoutQuery, getChatMember, sendChatAction, sendDownloadedMedia, sendInvoice, sendMediaGroup, sendMessage, sendWelcomePhoto } from "./telegramApi";
import type { MediaChoice, TelegramCallbackQuery, TelegramMessage, TelegramPreCheckoutQuery, TelegramUpdate } from "./types";
import { escapeHtml, HELP_TEXT, inspectionText, limitsPageText, mediaChoiceKeyboard, OWNER_CLEANUP_KEYBOARD, OWNER_KEYBOARD, OWNER_LIMITS_KEYBOARD, OWNER_SETTINGS_KEYBOARD, OWNER_SUBSCRIPTIONS_KEYBOARD, OWNER_USERS_KEYBOARD, planCreatedText, planListText, REPORT_TEXT, retryTikTokKeyboard, subscriptionGateKeyboard, subscriptionGateText, subscriptionEndsLabel, subscriptionOfferKeyboard, usageLimitExceededText, USER_KEYBOARD, welcomeText, type WelcomeUserInfo } from "./messages";

const recentRequests = new Map<string, number[]>();
const pendingAdminInputs = new Map<string, { action: "ban" | "unban" | "cleanup" | "broadcast" | "addChannel" | "removeChannel" | "limitCount" | "limitWindow" | "planName" | "planDays" | "planStars" | "stopPlan"; expiresAt: number }>();
const planDrafts = new Map<string, { name: string; days: number }>();
const pendingReports = new Map<string, number>();
const ownerPageStacks = new Map<string, string[]>();
let primaryOwnerEnsured = false;
const legacyOwnerLabels: Record<string, string> = {
  "✅ الحاضرون": "✅ النشطون",
  "🔒 حظر مستخدم": "🚫 حظر مستخدم",
  "🔓 فك الحظر": "✅ فك الحظر",
  "📣 رسالة جماعية": "📣 إرسال للجميع",
  "⚙️ حد المستخدمين": "⚙️ سعة البوت",
  "🗓 إعداد التنظيف": "⏱️ مدة التنظيف",
  "🧹 تنظيف البيانات": "🧹 تنظيف البيانات",
  "📋 سجلات الأخطاء": "📋 أخطاء حديثة",
};
const ownerControlLabels = new Set([
  "📊 الإحصاءات", "👥 إدارة المستخدمين", "👥 آخر المستخدمين", "✅ النشطون", "🌙 غير النشطين", "🚫 المحظورون",
  "🚫 حظر مستخدم", "✅ فك الحظر", "🔒 الاشتراك الإجباري", "➕ إضافة قناة/بوت", "➖ إزالة قناة/بوت", "📋 قائمة الاشتراك",
  "⚙️ الإعدادات", "⏱️ مدة التنظيف", "🧹 تنظيف البيانات", "🧹 تنظيف الآن", "📣 إرسال للجميع", "📋 أخطاء حديثة",
  "💳 الحدود والاشتراك", "⏱️ عدد التنزيلات", "⏲️ النافذة (ساعات)", "✅ تشغيل حد الاستخدام", "🚫 حد: مجاني",
  "💳 وضع البوت: مدفوع", "🆓 وضع البوت: مجاني", "➕ إضافة حزمة", "⛔ إيقاف حزمة", "📋 قائمة الحزم",
  "↩️ رجوع", "🏠 الرئيسية", "🛑 إلغاء العملية", "↩️ إلغاء الإدخال", "/admin",
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

function beginAdminInput(telegramId: string, action: "ban" | "unban" | "cleanup" | "broadcast" | "addChannel" | "removeChannel" | "limitCount" | "limitWindow" | "planName" | "planDays" | "planStars" | "stopPlan") {
  pendingAdminInputs.set(telegramId, { action, expiresAt: Date.now() + 10 * 60_000 });
}

function ownerStack(telegramId: string) {
  let stack = ownerPageStacks.get(telegramId);
  if (!stack) {
    stack = ["main"];
    ownerPageStacks.set(telegramId, stack);
  }
  return stack;
}

function ownerKeyboardFor(telegramId: string) {
  const current = ownerStack(telegramId)[ownerStack(telegramId).length - 1];
  if (current === "users") return OWNER_USERS_KEYBOARD;
  if (current === "settings") return OWNER_SETTINGS_KEYBOARD;
  if (current === "subscriptions") return OWNER_SUBSCRIPTIONS_KEYBOARD;
  if (current === "cleanup") return OWNER_CLEANUP_KEYBOARD;
  if (current === "limits") return OWNER_LIMITS_KEYBOARD;
  return OWNER_KEYBOARD;
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
  const primary = await isPrimaryOwner(telegramId);
  if (admission.isNew) {
    await notifyOwners(`👤 <b>مستخدم جديد</b>\nالاسم: <b>${escapeHtml(userName(message))}</b>\nالمعرّف: <code>${telegramId}</code>${message.from.username ? `\nالمعرف: @${escapeHtml(message.from.username)}` : ""}`);
  }
  return { admitted: true, primary };
}

async function checkForcedSubscriptions(telegramId: string) {
  const subscriptions = await listForcedSubscriptions();
  if (!subscriptions.length) return [] as typeof subscriptions;
  const missing: typeof subscriptions = [];
  for (const subscription of subscriptions) {
    if (subscription.kind === "bot") continue;
    let member = false;
    try {
      const chatMember = await getChatMember(subscription.target, telegramId);
      member = ["creator", "administrator", "member"].includes(chatMember.status || "");
    } catch { member = false; }
    if (!member) missing.push(subscription);
  }
  return missing;
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
    await sendMessage(chatId, inspectionText(result), { replyMarkup: mediaChoiceKeyboard(jobId, result.choices, result.imageCount) });
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
  return `📊 <b>إحصاءات سريعة</b>\n\nالمستخدمون: <b>${stats.total}</b>\nالنشطون اليوم: <b>${stats.activeToday}</b>\nالجدد اليوم: <b>${stats.joinedToday}</b>\nالمحظورون: <b>${stats.blocked}</b>\nغير النشطين: <b>${stats.inactive}</b>\nالتنظيف بعد: <b>${stats.settings.cleanupInactiveDays} يوماً</b>`;
}

async function sendAdminPanel(chatId: string, telegramId: string) {
  ownerStack(telegramId).length = 0;
  ownerStack(telegramId).push("main");
  await sendMessage(chatId, "👑 <b>لوحة المالك الأساسية</b>\nاختر وظيفة من الأزرار. عند الحاجة لرقم أو نص سأطلبه منك في رسالة منفصلة.", { replyMarkup: OWNER_KEYBOARD });
}

async function sendLimitsPage(chatId: string) {
  await sendMessage(chatId, limitsPageText(await ensureBotSettings()), { replyMarkup: OWNER_LIMITS_KEYBOARD });
}

async function sendUserList(chatId: string, title: string, users: Awaited<ReturnType<typeof import("./botDb")["listTelegramUsers"]>>, replyMarkup: Record<string, unknown>) {
  if (!users.length) return sendMessage(chatId, `لا توجد نتائج في قائمة «${title}».`, { replyMarkup });
  const lines = users.map((user, index) => `${index + 1}. <b>${escapeHtml(user.displayName)}</b>${user.username ? ` (@${escapeHtml(user.username)})` : ""}\n<code>${user.telegramId}</code> — ${user.status === "blocked" ? "محظور" : "نشط"}`);
  return sendMessage(chatId, `👥 <b>${title}</b>\n\n${lines.join("\n")}`, { replyMarkup });
}

function pendingInputPrompt(action: "ban" | "unban" | "cleanup" | "broadcast" | "addChannel" | "removeChannel" | "limitCount" | "limitWindow" | "planName" | "planDays" | "planStars" | "stopPlan") {
  const prompts: Record<typeof action, string> = {
    ban: "أرسل الآن رقم المستخدم أو @username لحظره.",
    unban: "أرسل الآن رقم المستخدم أو @username لفك الحظر.",
    cleanup: "أرسل عدد الأيام قبل تنظيف غير النشطين، من 7 إلى 365.",
    broadcast: "أرسل الآن نص الرسالة. ستصل للمستخدمين النشطين فقط.",
    addChannel: "أرسل معرف القناة أو المجموعة أو البوت:\n- @username\n- أو رقم القناة\n- أو رابط t.me/username",
    removeChannel: "أرسل معرف القناة أو @username أو معرّفها من قائمة الاشتراك.",
    limitCount: "أرسل عدد التنزيلات المسموح لكل مستخدم خلال النافذة (1 إلى 1000).",
    limitWindow: "أرسل مدة النافذة بالساعات (1 إلى 8760). مثال: 12 لكل يومين، و24 ليوم كامل.",
    planName: "أرسل اسم الحزمة (مثال: أسبوعي أو شهري).",
    planDays: "أرسل مدة الحزمة بالأيام (مثال: 7 لأسبوع، و30 لشهر).",
    planStars: "أرسل السعر بالنجوم ⭐ (رقماً صحيحاً).",
    stopPlan: "أرسل اسم الحزمة التي تريد إيقافها، من قائمة الحزم.",
  };
  return prompts[action];
}

async function handleOwnerButton(message: TelegramMessage, text: string) {
  const chatId = String(message.chat.id);
  const telegramId = String(message.from!.id);
  text = normalizeOwnerLabel(text);
  const replyMarkup = ownerKeyboardFor(telegramId);

  if (text === "↩️ رجوع") {
    const stack = ownerStack(telegramId);
    if (stack.length > 1) stack.pop();
    await sendMessage(chatId, "↩️ <b>رجوع</b>", { replyMarkup: ownerKeyboardFor(telegramId) });
    return true;
  }
  if (text === "🏠 الرئيسية") {
    const stack = ownerStack(telegramId);
    stack.length = 0;
    stack.push("main");
    await sendMessage(chatId, "🏠 <b>الرئيسية</b>", { replyMarkup: OWNER_KEYBOARD });
    return true;
  }
  if (text === "👥 إدارة المستخدمين") {
    ownerStack(telegramId).push("users");
    await sendMessage(chatId, "👥 <b>إدارة المستخدمين</b>\nالقوائم، الحظر، وفك الحظر.", { replyMarkup: OWNER_USERS_KEYBOARD });
    return true;
  }
  if (text === "🔒 الاشتراك الإجباري") {
    ownerStack(telegramId).push("subscriptions");
    await sendMessage(chatId, "🔒 <b>الاشتراك الإجباري</b>\nأضف القنوات أو المجموعات أو البوتات المطلوبة قبل استخدام البوت. ملكية العضوية تُفحص تلقائياً قبل تنزيل أي رابط.", { replyMarkup: OWNER_SUBSCRIPTIONS_KEYBOARD });
    return true;
  }
  if (text === "⚙️ الإعدادات") {
    ownerStack(telegramId).push("settings");
    await sendMessage(chatId, "⚙️ <b>الإعدادات</b>", { replyMarkup: OWNER_SETTINGS_KEYBOARD });
    return true;
  }
  if (text === "🧹 تنظيف البيانات") {
    ownerStack(telegramId).push("cleanup");
    await sendMessage(chatId, "🧹 <b>تنظيف البيانات</b>", { replyMarkup: OWNER_CLEANUP_KEYBOARD });
    return true;
  }
  if (text === "💳 الحدود والاشتراك") {
    ownerStack(telegramId).push("limits");
    return sendLimitsPage(chatId);
  }
  if (text === "📋 قائمة الحزم") {
    await sendMessage(chatId, planListText(await listSubscriptionPlans()), { replyMarkup: OWNER_LIMITS_KEYBOARD });
    return true;
  }
  if (text === "✅ تشغيل حد الاستخدام") {
    await updateUsageLimit({ enabled: true });
    await sendMessage(chatId, "✅ تم تشغيل حد الاستخدام.", { replyMarkup: OWNER_LIMITS_KEYBOARD });
    return true;
  }
  if (text === "🚫 حد: مجاني") {
    await updateUsageLimit({ enabled: false });
    await sendMessage(chatId, "🚫 تم إلغاء الحد. البوت الآن مجاني بلا موقت.", { replyMarkup: OWNER_LIMITS_KEYBOARD });
    return true;
  }
  if (text === "💳 وضع البوت: مدفوع") {
    await updatePaidMode(true);
    await sendMessage(chatId, "💳 تم تفعيل الوضع المدفوع. ستظهر حزم الاشتراك لمن استنفد حصته.", { replyMarkup: OWNER_LIMITS_KEYBOARD });
    return true;
  }
  if (text === "🆓 وضع البوت: مجاني") {
    await updatePaidMode(false);
    await sendMessage(chatId, "🆓 أُطفئ الوضع المدفوع. لن تظهر أزرار الاشتراك.", { replyMarkup: OWNER_LIMITS_KEYBOARD });
    return true;
  }
  if (text === "📊 الإحصاءات") {
    const { botStats } = await import("./botDb");
    await sendMessage(chatId, formatStats(await botStats()), { replyMarkup: OWNER_KEYBOARD });
    return true;
  }
  if (text === "👥 آخر المستخدمين") {
    const { listTelegramUsers } = await import("./botDb");
    await sendUserList(chatId, "آخر 50 مستخدماً", await listTelegramUsers("recent"), replyMarkup);
    return true;
  }
  if (text === "✅ النشطون") {
    const { listTelegramUsers } = await import("./botDb");
    await sendUserList(chatId, "المستخدمون النشطون", await listTelegramUsers("active"), replyMarkup);
    return true;
  }
  if (text === "🌙 غير النشطين") {
    const { listTelegramUsers } = await import("./botDb");
    await sendUserList(chatId, "المستخدمون غير النشطين", await listTelegramUsers("inactive"), replyMarkup);
    return true;
  }
  if (text === "🚫 المحظورون") {
    const { listTelegramUsers } = await import("./botDb");
    await sendUserList(chatId, "المستخدمون المحظورون", await listTelegramUsers("blocked"), replyMarkup);
    return true;
  }
  if (text === "🧹 تنظيف الآن") {
    const { cleanupBotData } = await import("./botDb");
    const result = await cleanupBotData();
    await sendMessage(chatId, `تم التنظيف. أزيلت سجلات <b>${result.removedInactiveUsers}</b> مستخدم غير نشط والعمليات المؤقتة المنتهية.`, { replyMarkup });
    return true;
  }
  if (text === "📋 أخطاء حديثة") {
    const { recentErrors } = await import("./botDb");
    const errors = await recentErrors(8);
    await sendMessage(chatId, errors.length ? `📋 <b>آخر الأخطاء</b>\n\n${errors.map(error => `• <b>${escapeHtml(error.stage)}</b> — <code>${escapeHtml(error.telegramId || "—")}</code>\n${escapeHtml(error.message.slice(0, 160))}`).join("\n\n")}` : "لا توجد أخطاء مسجلة حالياً.", { replyMarkup: OWNER_KEYBOARD });
    return true;
  }
  if (text === "📋 قائمة الاشتراك") {
    const subscriptions = await listForcedSubscriptions();
    if (!subscriptions.length) {
      await sendMessage(chatId, "لا توجد قنوات اشتراك مفروضة حالياً.", { replyMarkup: OWNER_SUBSCRIPTIONS_KEYBOARD });
      return true;
    }
    const lines = subscriptions.map((subscription, index) => {
      const kindLabel = subscription.kind === "group" ? "مجموعة" : subscription.kind === "bot" ? "بوت" : "قناة";
      const link = subscription.inviteUrl ? `<a href="${escapeHtml(subscription.inviteUrl)}">${escapeHtml(subscription.label)}</a>` : `<code>${escapeHtml(subscription.label)}</code>`;
      return `${index + 1}. (${kindLabel}) ${link}\n   <code>${escapeHtml(subscription.target)}</code>`;
    }).join("\n");
    const note = subscriptions.some(subscription => subscription.kind === "bot")
      ? "\n\nℹ️ لا توجد واجهة عامة للتحقق من بدء المستخدم لبوت؛ يُعتبر اشتراك البوت مكتملاً دائماً."
      : "";
    await sendMessage(chatId, `🔒 <b>قائمة الاشتراك الإجباري (${subscriptions.length})</b>\n\n${lines}${note}\n\nللإزالة اضغط «إزالة قناة/بوت» وأرسل نفس المعرّف.`, { replyMarkup: OWNER_SUBSCRIPTIONS_KEYBOARD });
    return true;
  }
  if (text === "🛑 إلغاء العملية") {
    const { cancelLatestActiveJob } = await import("./botDb");
    const cancelled = await cancelLatestActiveJob(telegramId);
    if (cancelled) abortYtDlp(cancelled);
    await sendMessage(chatId, cancelled ? "تم إلغاء آخر عملية نشطة." : "لا توجد عملية قابلة للإلغاء.", { replyMarkup: keyboardFor(true) });
    return true;
  }
  const inputs: Record<string, { action: "ban" | "unban" | "cleanup" | "broadcast" | "addChannel" | "removeChannel" | "limitCount" | "limitWindow" | "planName" | "planDays" | "planStars" | "stopPlan" }> = {
    "🚫 حظر مستخدم": { action: "ban" },
    "✅ فك الحظر": { action: "unban" },
    "⏱️ مدة التنظيف": { action: "cleanup" },
    "📣 إرسال للجميع": { action: "broadcast" },
    "➕ إضافة قناة/بوت": { action: "addChannel" },
    "➖ إزالة قناة/بوت": { action: "removeChannel" },
    "⏱️ عدد التنزيلات": { action: "limitCount" },
    "⏲️ النافذة (ساعات)": { action: "limitWindow" },
    "➕ إضافة حزمة": { action: "planName" },
    "⛔ إيقاف حزمة": { action: "stopPlan" },
  };
  if (inputs[text]) {
    beginAdminInput(telegramId, inputs[text].action);
    await sendMessage(chatId, `✍️ ${pendingInputPrompt(inputs[text].action)}\nيمكنك اختيار زر أداري آخر لإلغاء هذا الإدخال.`, { replyMarkup });
    return true;
  }
  if (text === "↩️ إلغاء الإدخال") {
    pendingAdminInputs.delete(telegramId);
    await sendMessage(chatId, "تم إلغاء الإدخال الحالي.", { replyMarkup });
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
    await sendMessage(String(message.chat.id), "انتهت مهلة الإدخال. اختر الزر المطلوب مجدداً.", { replyMarkup: ownerKeyboardFor(telegramId) });
    return true;
  }
  const chatId = String(message.chat.id);
  const replyMarkup = ownerKeyboardFor(telegramId);
  if (pending.action === "planName" || pending.action === "planDays" || pending.action === "planStars") {
    pendingAdminInputs.delete(telegramId);
    try {
      if (pending.action === "planName") {
        const name = text.trim().slice(0, 60);
        if (!name) throw new Error("اكتب اسماً صحيحاً للحزمة.");
        planDrafts.set(telegramId, { name, days: 0 });
        beginAdminInput(telegramId, "planDays");
        await sendMessage(chatId, "✍️ أرسل مدة الحزمة بالأيام (مثال: 7 لأسبوع، 30 لشهر).");
      } else if (pending.action === "planDays") {
        const draft = planDrafts.get(telegramId);
        const days = Number(text.trim());
        if (!draft) throw new Error("ابدأ من جديد بطلب «إضافة حزمة».");
        if (!Number.isInteger(days) || days < 1 || days > 3650) throw new Error("أرسل عدداً صحيحاً من الأيام بين 1 و3650.");
        planDrafts.set(telegramId, { ...draft, days });
        beginAdminInput(telegramId, "planStars");
        await sendMessage(chatId, "✍️ أرسل السعر بالنجوم ⭐ (رقماً صحيحاً).");
      } else {
        const draft = planDrafts.get(telegramId);
        const stars = Number(text.trim());
        if (!draft?.name || !draft.days) throw new Error("ابدأ من جديد بطلب «إضافة حزمة».");
        if (!Number.isInteger(stars) || stars < 1 || stars > 100_000) throw new Error("أرسل عدد نجوم صحيحاً بين 1 و100000.");
        const plan = await addSubscriptionPlan({ name: draft.name, durationDays: draft.days, stars });
        planDrafts.delete(telegramId);
        await sendMessage(chatId, planCreatedText(plan), { replyMarkup: OWNER_LIMITS_KEYBOARD });
        await notifyOwners(`💳 <b>إضافة حزمة اشتراك</b>\nالاسم: <b>${escapeHtml(plan.name)}</b>\nالمدة: <b>${plan.durationDays} يوم</b>\nالسعر: <b>${plan.stars} ⭐</b>`);
      }
    } catch (error) {
      await sendMessage(chatId, `تعذر التنفيذ: <b>${escapeHtml(error instanceof Error ? error.message : "خطأ غير متوقع")}</b>`, { replyMarkup: ownerKeyboardFor(telegramId) });
    }
    return true;
  }
  const { activeRecipients, setTelegramUserBlocked, updateCleanupInactiveDays } = await import("./botDb");
  try {
    if (pending.action === "ban" || pending.action === "unban") {
      const user = await setTelegramUserBlocked(text, pending.action === "ban");
      if (!user) throw new Error("لم يتم العثور على المستخدم بهذا المعرف أو الاسم.");
      await notifyOwners(`${pending.action === "ban" ? "🚫" : "✅"} <b>تعديل حالة مستخدم</b>\nالمستخدم: <code>${user.telegramId}</code>\nبواسطة المالك: <code>${telegramId}</code>`);
      await sendMessage(chatId, `تم ${pending.action === "ban" ? "حظر" : "فك حظر"} المستخدم بنجاح.`, { replyMarkup });
    } else if (pending.action === "cleanup") {
      const value = Number(text);
      await updateCleanupInactiveDays(value);
      await sendMessage(chatId, `تم ضبط التنظيف بعد <b>${value}</b> يوماً من عدم النشاط.`, { replyMarkup });
    } else if (pending.action === "addChannel") {
      const parsed = parseSubscriptionTarget(text);
      const added = await addForcedSubscription({ target: parsed.target, inviteUrl: parsed.inviteUrl, label: parsed.label, kind: parsed.kind });
      if (!added) throw new Error("هذه القناة/البوت مضاف بالفعل.");
      await notifyOwners(`🔒 <b>إضافة اشتراك إجباري</b>\nالنوع: <b>${parsed.kind}</b>\nالمعرّف: <code>${escapeHtml(parsed.target)}</code>\nالرابط: <code>${escapeHtml(parsed.inviteUrl || "—")}</code>`);
      await sendMessage(chatId, `✅ تمت إضافة «<b>${escapeHtml(parsed.label)}</b>» إلى الاشتراك الإجباري.\nسيُطلب من المستخدمين الانضمام قبل استخدام البوت.`, { replyMarkup });
    } else if (pending.action === "removeChannel") {
      const removed = await removeForcedSubscription(text);
      if (!removed) throw new Error("لم يتم العثور على هذا الاشتراك. تحقق من المعرّف.");
      await notifyOwners(`🔓 <b>إزالة اشتراك إجباري</b>\nالمعرّف: <code>${escapeHtml(text.trim())}</code>`);
      await sendMessage(chatId, "✅ تمت إزالة الاشتراك بنجاح.", { replyMarkup });
    } else if (pending.action === "limitCount") {
      const value = Number(text.trim());
      if (!Number.isInteger(value) || value < 1 || value > 1000) throw new Error("أدخل عدد تنزيلات بين 1 و1000.");
      await updateUsageLimit({ count: value, enabled: true });
      await sendMessage(chatId, `تم ضبط حد التنزيل: <b>${value}</b> تنزيل لكل نافذة. البوت الآن محدود.`, { replyMarkup });
    } else if (pending.action === "limitWindow") {
      const value = Number(text.trim());
      if (!Number.isInteger(value) || value < 1 || value > 8_760) throw new Error("أدخل عدد ساعات بين 1 و8760.");
      await updateUsageLimit({ windowHours: value });
      await sendMessage(chatId, `تم ضبط نافذة الحد: <b>${value}</b> ساعة.`, { replyMarkup });
    } else if (pending.action === "stopPlan") {
      const stopped = await setSubscriptionPlanActive(text, false);
      if (!stopped) throw new Error("لم يتم العثور على حزمة بهذا الاسم. تحقق من قائمة الحزم.");
      await notifyOwners(`⛔ <b>إيقاف حزمة</b>\nالحزمة: <b>${escapeHtml(text.trim())}</b>`);
      await sendMessage(chatId, `⛔ أُوقفت الحزمة «<b>${escapeHtml(text.trim())}</b>». لن تظهر لعملاء جدد.`, { replyMarkup });
    } else {
      const content = text.trim();
      if (!content || content.length > 3500) throw new Error("اكتب رسالة بين 1 و3500 حرفاً.");
      const recipients = await activeRecipients();
      await sendMessage(chatId, `📣 بدأ الإرسال إلى <b>${recipients.length}</b> مستخدماً نشطاً…`, { replyMarkup });
      let success = 0; let failed = 0;
      for (let index = 0; index < recipients.length; index += 20) {
        const result = await Promise.allSettled(recipients.slice(index, index + 20).map(user => sendMessage(user.telegramId, escapeHtml(content))));
        result.forEach(entry => entry.status === "fulfilled" ? success += 1 : failed += 1);
        if (index + 20 < recipients.length) await new Promise(resolve => setTimeout(resolve, 1_000));
      }
      await sendMessage(chatId, `تم الإرسال.\nالناجح: <b>${success}</b>\nالمتعذر: <b>${failed}</b>`, { replyMarkup });
    }
  } catch (error) {
    await sendMessage(chatId, `تعذر التنفيذ: <b>${escapeHtml(error instanceof Error ? error.message : "خطأ غير متوقع")}</b>`, { replyMarkup });
  } finally {
    pendingAdminInputs.delete(telegramId);
  }
  return true;
}

async function handleMessage(message: TelegramMessage) {
  const admission = await admitMessage(message);
  if (message.successful_payment) return handleSuccessfulPayment(message);
  if (!admission.admitted || !message.text) return;
  const text = message.text.trim();
  const chatId = String(message.chat.id);
  const telegramId = String(message.from!.id);

  const role = await getOwnerRole(telegramId);
  if (!role && !admission.primary) {
    const missing = await checkForcedSubscriptions(telegramId);
    if (missing.length) {
      await sendMessage(chatId, subscriptionGateText(missing), { replyMarkup: subscriptionGateKeyboard(missing) });
      return;
    }
  }

  if (admission.primary) {
    if (text === "/admin") {
      pendingAdminInputs.delete(telegramId);
      return sendAdminPanel(chatId, telegramId);
    }
    if (isOwnerControlLabel(text)) {
      pendingAdminInputs.delete(telegramId);
      if (await handleOwnerButton(message, text)) return;
    }
    if (await handlePendingAdminInput(message, text)) return;
  }

  if (text === "/start" || text === "🚀 تشغيل البوت" || /^\/start@/i.test(text)) {
    pendingAdminInputs.delete(telegramId);
    pendingReports.delete(telegramId);
    const info: WelcomeUserInfo = { username: message.from?.username, language: message.from?.language_code };
    const user = await getTelegramUser(telegramId);
    if (user?.firstSeenAt) info.firstSeen = user.firstSeenAt;
    await sendWelcomePhoto(chatId).catch(() => undefined);
    return sendMessage(chatId, welcomeText(userName(message), info), { replyMarkup: keyboardFor(admission.primary) });
  }
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

async function handleSuccessfulPayment(message: TelegramMessage) {
  const payment = message.successful_payment!;
  const telegramId = String(message.from!.id);
  const chatId = String(message.chat.id);
  const primary = await isPrimaryOwner(telegramId);
  const planId = payment.invoice_payload.replace(/^sub:/, "");
  const plan = await findSubscriptionPlanById(planId);
  if (!plan) {
    return sendMessage(chatId, "تم استلام مدفوعاتك، لكن تعذر التعرف على الحزمة. تواصل مع المالك.", { replyMarkup: keyboardFor(primary) });
  }
  const access = await getUserAccess(telegramId);
  const base = Math.max(Date.now(), access.subscriptionExpiresAt || 0);
  const expiresAt = base + plan.durationDays * 86_400_000;
  await setUserSubscription(telegramId, expiresAt, plan.id);
  await notifyOwners(`💰 <b>اشتراك جديد بالنجوم</b>\nالمستخدم: <code>${escapeHtml(telegramId)}</code>\nالحزمة: <b>${escapeHtml(plan.name)}</b>\nالمدة: <b>${plan.durationDays} يوم</b>\nالسعر: <b>${plan.stars} ⭐</b>\nينتهي: <b>${subscriptionEndsLabel(expiresAt)}</b>\nالتزام: <code>${escapeHtml(payment.telegram_payment_charge_id)}</code>`);
  return sendMessage(chatId, `✅ <b>تم تفعيل اشتراكك بنجاح!</b>\n\nالحزمة: <b>${escapeHtml(plan.name)}</b>\nالمدة: <b>${plan.durationDays} يوم</b>\nينتهي: <b>${subscriptionEndsLabel(expiresAt)}</b>\n\nتنزيلاتك مفتوحة الآن بلا حدود. شكراً لدعمك 🎉`, { replyMarkup: keyboardFor(primary) });
}

async function handlePreCheckoutQuery(query: TelegramPreCheckoutQuery) {
  const planId = query.invoice_payload.replace(/^sub:/, "");
  const plan = await findSubscriptionPlanById(planId);
  if (!plan || !plan.active) return answerPreCheckoutQuery(query.id, false, "الحزمة غير متاحة حالياً.");
  return answerPreCheckoutQuery(query.id, true);
}

async function handleDownloadCallback(callback: TelegramCallbackQuery) {
  const chatId = callback.message ? String(callback.message.chat.id) : String(callback.from.id);
  const data = callback.data || "";
  const senderId = String(callback.from.id);
  const primary = await isPrimaryOwner(senderId);
  if (data === "sub_check") {
    if (!allowCallback(senderId)) return answerCallbackQuery(callback.id, "💡 أنت تضغط بسرعة. انتظر قليلاً ثم أعد المحاولة.");
    const missing = await checkForcedSubscriptions(senderId);
    if (missing.length) return answerCallbackQuery(callback.id, "ما زلت غير مشترك في كل القنوات المطلوبة");
    await answerCallbackQuery(callback.id, "تم التحقق من الاشتراك ✅");
    return sendMessage(chatId, "✅ <b>تم التحقق من الاشتراك بنجاح</b>\nاضغط «🚀 تشغيل البوت» ثم أرسل رابط المنشور للبدء.", { replyMarkup: keyboardFor(primary) });
  }
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
  if (data === "sub_dismiss") return answerCallbackQuery(callback.id, "حسناً. ستظل الحصة الحالية متاحة.");
  if (data.startsWith("sub_plan:")) {
    if (!allowCallback(senderId)) return answerCallbackQuery(callback.id, "💡 أنت تضغط بسرعة. انتظر قليلاً ثم أعد المحاولة.");
    const planId = data.slice("sub_plan:".length);
    const plan = await findSubscriptionPlanById(planId);
    if (!plan || !plan.active) return answerCallbackQuery(callback.id, "الحزمة غير متاحة حالياً");
    await answerCallbackQuery(callback.id, "جارٍ تجهيز فاتورة الدفع ⭐…");
    try {
      await sendInvoice(chatId, {
        title: `اشتراك ${plan.name}`,
        description: `تفعيل تنزيلات بلا حدود لمدة ${plan.durationDays} يوماً مقابل ${plan.stars} نجمة.`,
        payload: `sub:${plan.id}`,
        stars: plan.stars,
      });
    } catch (error) {
      console.error("[Telegram Stars] sendInvoice failed", error);
      await sendMessage(chatId, "تعذر إنشاء فاتورة الدفع حالياً. تأكد من توفر نجوم تواصل أو حاول لاحقاً.", { replyMarkup: keyboardFor(primary) });
    }
    return;
  }
  const parts = data.split(":");
  const jobId = parts[1];
  const rawChoice = parts[2];
  const allImages = rawChoice === "images";
  const choice: MediaChoice = allImages ? "image" : (rawChoice as MediaChoice);
  if (!jobId || !["video", "audio", "image", "story"].includes(choice)) return answerCallbackQuery(callback.id, "طلب غير صالح");
  if (!allowCallback(senderId)) return answerCallbackQuery(callback.id, "💡 أنت تضغط بسرعة. انتظر قليلاً ثم أعد المحاولة.");
  const job = await getMediaJob(jobId);
  if (!job || job.telegramId !== senderId || job.status !== "ready" || job.cancelRequested) return answerCallbackQuery(callback.id, "انتهت صلاحية هذا الطلب");
  const settings = await ensureBotSettings();
  if (!primary && settings.usageLimitEnabled) {
    const access = await getUserAccess(senderId);
    const subscribed = Boolean(access.subscriptionExpiresAt && access.subscriptionExpiresAt > Date.now());
    if (!subscribed) {
      const used = await userDownloadsInWindow(senderId, settings.usageLimitWindowHours);
      if (used >= settings.usageLimitCount) {
        const plans = await listSubscriptionPlans();
        const hasActivePlans = plans.some(plan => plan.active);
        await answerCallbackQuery(callback.id, hasActivePlans ? "انتهت حصتك المجانية" : "انتهت حصتك اليومية");
        if (hasActivePlans && settings.paidModeEnabled) {
          return sendMessage(chatId, usageLimitExceededText(settings.usageLimitCount, settings.usageLimitWindowHours, true), { replyMarkup: subscriptionOfferKeyboard(plans) });
        }
        return sendMessage(chatId, usageLimitExceededText(settings.usageLimitCount, settings.usageLimitWindowHours, false), { replyMarkup: keyboardFor(primary) });
      }
    }
  }
  await answerCallbackQuery(callback.id, allImages ? "بدأ تجهيز الصور" : "بدأ تجهيز الملف");
  await updateMediaJob(jobId, { status: "downloading", selectedChoice: choice });
  const action: "upload_video" | "upload_audio" | "upload_photo" = allImages || choice === "image" ? "upload_photo" : choice === "audio" ? "upload_audio" : "upload_video";
  let workdir: string | undefined;
  let preserveRetryJob = false;
  let deleteJobOnFinish = true;
  try {
    const queued = scheduleDownload(async () => {
      const beforeDownload = await getMediaJob(jobId);
      if (!beforeDownload || beforeDownload.cancelRequested) throw new DownloaderError("تم إلغاء العملية بنجاح.");
      await sendChatAction(chatId, action).catch(() => undefined);
      if (allImages) return downloadAllImages(job.sourceUrl, jobId);
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
    if (allImages) {
      const files = (output as { files: Array<{ path: string }> }).files;
      const caption = `✅ <b>اكتمل تنزيل الصور</b>\nعدد الصور: <b>${files.length}</b>\nسيُحذف الملف من الخادم الآن.`;
      await sendMediaGroup(chatId, files.map(file => ({ path: file.path, caption })));
    } else {
      await sendDownloadedMedia(chatId, choice, (output as { filePath: string }).filePath, "✅ <b>اكتمل التنزيل</b> — الملف أُرسل بنجاح وسيُحذف من الخادم الآن.");
    }
    await updateMediaJob(jobId, { status: "sent" });
    await notifyOwners(`✅ <b>تنزيل مكتمل</b>\nالمستخدم: <code>${senderId}</code>\nالنوع: <b>${allImages ? "صور كاملة" : mediaLabel(choice)}</b>\nالحجم: <b>${Math.round(output.bytes / 1024)} KB</b>\nالرابط: <code>${escapeHtml(job.sourceUrl.slice(0, 500))}</code>`);
    if (!primary) await recordUserDownload(senderId, settings.usageLimitWindowHours);
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
    await notifyError({ telegramId: senderId, sourceUrl: job.sourceUrl, stage: "تنزيل وإرسال", error, mediaChoice: allImages ? "image" : choice });
  } finally {
    if (workdir) await purgeDownloadedMedia(workdir);
    if (!preserveRetryJob && deleteJobOnFinish) await deleteMediaJob(jobId);
  }
}

export async function processTelegramUpdate(update: TelegramUpdate) {
  if (!isValidTelegramUpdateId(update.update_id)) return;
  if (!(await claimTelegramUpdate(update.update_id))) return;
  try {
    if (update.pre_checkout_query) return handlePreCheckoutQuery(update.pre_checkout_query);
    if (update.message) return handleMessage(update.message);
    if (update.callback_query) return handleDownloadCallback(update.callback_query);
  } catch (error) {
    const telegramId = update.message?.from ? String(update.message.from.id) : update.callback_query ? String(update.callback_query.from.id) : update.pre_checkout_query ? String(update.pre_checkout_query.from.id) : undefined;
    await notifyError({ telegramId, stage: "معالجة تحديث Telegram", error });
    throw error;
  }
}