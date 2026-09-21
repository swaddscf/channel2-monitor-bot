import type { InspectResult } from "./types";
import { countryLabel, formatCount } from "./tiktokProfile";

export type ButtonStyle = "primary" | "success" | "danger";

export function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" })[char] || char);
}

export function welcomeText(name: string) {
  return `✦ أهلاً <b>${escapeHtml(name)}</b>

أنا بوت تنزيل الوسائط العامة. أرسل رابطاً واحداً وسأعرض الخيارات المتاحة: <b>فيديو</b> أو <b>صوت</b> أو <b>صورة أصلية</b> أو <b>ستوري</b>.

<b>المنصات المدعومة</b>
TikTok • Instagram • Facebook • Snapchat • Pinterest • Twitter/X

<b>على TikTok أعرض لك أيضاً بطاقة الحساب</b>
الاسم، اسم المستخدم، المتابعين، المنشورات، والدولة — بشكل حقيقي من بيانات الحساب العام.

<b>بثلاث خطوات</b>
① انسخ رابط المنشور أو الفيديو أو القصة العامة.
② أرسله هنا كما هو، من دون إضافة نص آخر.
③ اختر فيديو أو صوتاً أو صورة أو ستوري عندما يؤكد المصدر توافرها.

لا أقبل الحسابات الخاصة أو المحتوى المحمي. استخدم الروابط العامة التي تملك حق تنزيلها فقط.`;
}

export const HELP_TEXT = `❔ <b>كيف أستخدم البوت؟</b>

أرسل رابطاً عاماً واحداً فقط. يدعم البوت TikTok وInstagram وFacebook وSnapchat وPinterest وTwitter/X. في Twitter/X استخدم رابط المنشور بصيغة <code>https://x.com/اسم_المستخدم/status/123</code>، وليس رابط الحساب.

بعد الفحص ستظهر الأزرار المناسبة: فيديو أو صوت أو صورة أصلية أو ستوري. لا يظهر الخيار إلا عندما يؤكد المصدر وجوده. قصص Instagram وFacebook وSnapchat تظهر عبر زر <b>تنزيل الستوري</b> إذا كان الرابط عاماً وما زال المصدر يتيحه.

على روابط TikTok يُعرض أيضاً كشف حساب الناشر عند توفر البيانات: الاسم، اسم المستخدم، عدد المتابعين والمنشورات والدولة.

استخدم زر <b>إلغاء العملية</b> لإيقاف الفحص أو التنزيل الحالي. للبلاغات، اضغط <b>إرسال بلاغ</b> وأرسل الرابط مع السبب.

قد يرفض المصدر الرابط الخاص أو المحمي أو الملف الكبير أو يحجب طلبات الخادم مؤقتاً؛ عندها ستصلك رسالة واضحة ويمكنك تجربة رابط عام آخر.`;

export const REPORT_TEXT = `لإرسال بلاغ، اكتب الرسالة بهذا الشكل:
<code>/report الرابط أو المعرّف | السبب</code>

مثال: <code>/report https://example.com/post | الرابط لا يعمل</code>`;

/**
 * Optional custom-emoji icon for buttons (Bot API 9.4+).
 * Only applied when USE_CUSTOM_BUTTON_EMOJI=1 and the numeric custom emoji ID
 * is configured; requires the bot owner to hold a Telegram Premium account or
 * own a Fragment username.
 */
function buttonIcon(envVar: string) {
  if (process.env.USE_CUSTOM_BUTTON_EMOJI !== "1") return undefined;
  const value = process.env[envVar]?.trim();
  return value ? { icon_custom_emoji_id: value } : undefined;
}

function replyButton(text: string, style?: ButtonStyle, iconEnv?: string) {
  const button: Record<string, unknown> = { text };
  if (style) button.style = style;
  Object.assign(button, buttonIcon(iconEnv || ""));
  return button;
}

function inlineButton(text: string, callbackData: string, style: ButtonStyle, iconEnv?: string) {
  const button: Record<string, unknown> = { text, callback_data: callbackData, style };
  Object.assign(button, buttonIcon(iconEnv || ""));
  return button;
}

export const USER_KEYBOARD = {
  keyboard: [
    [replyButton("❔ طريقة الاستخدام", "primary"), replyButton("🛑 إلغاء العملية", "danger")],
    [replyButton("📩 إرسال بلاغ", "primary")],
  ],
  resize_keyboard: true,
  is_persistent: true,
};

export const OWNER_KEYBOARD = {
  keyboard: [
    [replyButton("📊 الإحصاءات", "success"), replyButton("👥 آخر المستخدمين", "primary")],
    [replyButton("✅ النشطون", "primary"), replyButton("🌙 غير النشطين", "primary"), replyButton("🚫 المحظورون", "primary")],
    [replyButton("🚫 حظر مستخدم", "danger"), replyButton("✅ فك الحظر", "success")],
    [replyButton("📣 إرسال للجميع", "primary"), replyButton("⚙️ سعة البوت", "primary")],
    [replyButton("🧹 تنظيف الآن", "danger"), replyButton("⏱️ مدة التنظيف", "primary")],
    [replyButton("👑 الملاك", "primary"), replyButton("➕ إضافة مالك", "success"), replyButton("➖ حذف مالك", "danger")],
    [replyButton("📦 تحميل نسخة المشروع", "success")],
    [replyButton("📋 أخطاء حديثة", "primary"), replyButton("↩️ إلغاء الإدخال", "primary")],
    [replyButton("🛑 إلغاء العملية", "danger")],
  ],
  resize_keyboard: true,
  is_persistent: true,
};

export function inspectionText(result: InspectResult) {
  const duration = result.durationSeconds ? `\nالمدة التقريبية: <b>${Math.round(result.durationSeconds)} ثانية</b>` : "";
  const platformLabels: Record<InspectResult["platform"], string> = {
    tiktok: "TikTok",
    instagram: "Instagram",
    facebook: "Facebook",
    snapchat: "Snapchat",
    pinterest: "Pinterest",
    twitter: "Twitter/X",
  };
  let accountBlock = "";
  const account = result.account;
  if (account) {
    const lines: string[] = [];
    if (account.nickname || account.username) lines.push(`👤 <b>${escapeHtml(account.nickname || account.username!)}</b>`);
    if (account.username) {
      const verifiedMark = account.verified ? " ✅ موثق" : "";
      lines.push(`معرّف: <code>@${escapeHtml(account.username)}</code>${verifiedMark}`);
    } else if (account.verified) {
      lines.push("✅ حساب موثق");
    }
    const stats: string[] = [];
    if (account.followers !== undefined) stats.push(`👥 <b>${formatCount(account.followers)}</b> متابع`);
    if (account.posts !== undefined) stats.push(`📹 <b>${formatCount(account.posts)}</b> منشور`);
    if (account.hearts !== undefined) stats.push(`❤️ <b>${formatCount(account.hearts)}</b> إعجاب`);
    if (stats.length) lines.push(stats.join(" • "));
    const region = countryLabel(account.region);
    if (region) lines.push(`📍 الدولة: <b>${escapeHtml(region)}</b>`);
    if (account.signature) lines.push(`✍️ ${escapeHtml(account.signature.slice(0, 150))}`);
    if (account.profileUrl) lines.push(`🔗 <code>${escapeHtml(account.profileUrl)}</code>`);
    accountBlock = `\n\n${lines.join("\n")}`;
  }
  return `✦ <b>تم فحص الرابط</b>

المنصة: <b>${platformLabels[result.platform]}</b>
العنوان: <b>${escapeHtml(result.title)}</b>${duration}${accountBlock}

اختر نوع الملف المناسب. لا يُعرض إلا ما أكده الفحص من هذا الرابط العام.`;
}

const MEDIA_BUTTONS: Record<InspectResult["choices"][number], { text: string; style: ButtonStyle; iconEnv: string }> = {
  video: { text: "🎬 تنزيل فيديو", style: "primary", iconEnv: "BUTTON_CUSTOM_EMOJI_DOWNLOAD" },
  audio: { text: "🎵 تنزيل صوت", style: "success", iconEnv: "BUTTON_CUSTOM_EMOJI_AUDIO" },
  image: { text: "🖼 تنزيل صورة أصلية", style: "primary", iconEnv: "BUTTON_CUSTOM_EMOJI_IMAGE" },
  story: { text: "📖 تنزيل الستوري", style: "success", iconEnv: "BUTTON_CUSTOM_EMOJI_STORY" },
};

export function mediaChoiceKeyboard(jobId: string, choices: InspectResult["choices"]) {
  return {
    inline_keyboard: [
      ...choices.map(choice => [inlineButton(MEDIA_BUTTONS[choice].text, `dl:${jobId}:${choice}`, MEDIA_BUTTONS[choice].style, MEDIA_BUTTONS[choice].iconEnv)]),
      [inlineButton("✖️ إلغاء العملية", `cancel:${jobId}`, "danger", "BUTTON_CUSTOM_EMOJI_CANCEL")],
    ],
  };
}

export function retryTikTokKeyboard(jobId: string) {
  return {
    inline_keyboard: [[inlineButton("🔄 إعادة محاولة TikTok", `retry_tiktok:${jobId}`, "primary")]],
  };
}