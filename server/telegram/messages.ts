import type { ForcedSubscription, InspectResult } from "./types";
import { countryLabel, formatCount } from "./tiktokProfile";

export type ButtonStyle = "primary" | "success" | "danger";

export function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" })[char] || char);
}

export type WelcomeUserInfo = {
  username?: string;
  language?: string;
  firstSeen?: Date;
};

function languageLabel(code?: string) {
  if (!code) return undefined;
  const normalized = code.toLowerCase();
  const labels: Record<string, string> = {
    ar: "العربية", en: "الإنجليزية", fr: "الفرنسية", es: "الإسبانية", de: "الألمانية",
    ru: "الروسية", tr: "التركية", fa: "الفارسية", ur: "الأردية", hi: "الهندية",
    id: "الإندونيسية", pt: "البرتغالية", it: "الإيطالية", nl: "الهولندية", zh: "الصينية",
    ja: "اليابانية", ko: "الكورية", pl: "البولندية", uk: "الأوكرانية", vi: "الفيتنامية",
  };
  return labels[normalized] || normalized;
}

function userCard(info?: WelcomeUserInfo) {
  if (!info) return "";
  const lines = ["🧾 <b>بيانات ملفك</b>"];
  if (info.username) lines.push(`المعرف: @${escapeHtml(info.username)}`);
  const language = languageLabel(info.language);
  if (language) lines.push(`اللغة: ${escapeHtml(language)}`);
  if (info.firstSeen) lines.push(`أول استخدام: ${info.firstSeen.toLocaleDateString("ar-EG", { day: "numeric", month: "long", year: "numeric" })}`);
  return `\n\n${lines.join("\n")}`;
}

export function welcomeText(name: string, info?: WelcomeUserInfo) {
  return `✦ <b>أهلاً بك يا ${escapeHtml(name)}</b> 🎬

أنا بوت تحميل الوسائط العامة. أرسل رابطاً واحداً وسأعرض لك ما يمكن تنزيله من: <b>فيديو</b> • <b>صوت</b> • <b>الصور كاملة</b> • <b>ستوري</b>.
${userCard(info)}

<b>المنصات المدعومة</b>
TikTok • Instagram • Facebook • Snapchat • Pinterest • Twitter/X

<b>على TikTok أعرض لك أيضاً بطاقة الحساب</b>
الاسم، اسم المستخدم، المتابعين، المنشورات، والدولة — من البيانات العامة للحساب، مع عدد صور المشاركة إذا كانت متعددة.

<b>بثلاث خطوات</b>
① انسخ رابط المنشور أو الفيديو أو القصة العامة.
② أرسله هنا كما هو، من دون إضافة نص آخر.
③ انقر نوع الملف الذي تريد تنزيله عندما يؤكد المصدر توفره.

لا أقبل الحسابات الخاصة أو المحتوى المحمي. استخدم الروابط العامة التي تملك حق تنزيلها فقط.`;
}

export const HELP_TEXT = `❔ <b>كيف أستخدم البوت؟</b>

أرسل رابطاً عاماً واحداً فقط. يدعم البوت TikTok وInstagram وFacebook وSnapchat وPinterest وTwitter/X. في Twitter/X استخدم رابط المنشور بصيغة <code>https://x.com/اسم_المستخدم/status/123</code>، وليس رابط الحساب.

بعد الفحص تظهر الأزرار المناسبة: فيديو أو صوت أو صورة أصلية أو ستوري. المشاركات المتعددة الصور تعرض عدد الصور وزر <b>تنزيل الصور كاملة</b>.

على روابط TikTok يُعرض أيضاً كشف حساب الناشر عند توفر البيانات.

استخدم زر <b>إلغاء العملية</b> لإيقاف الفحص أو التنزيل الحالي. للبلاغات، اضغط <b>إرسال بلاغ</b>.`;

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
    [replyButton("🚀 تشغيل البوت", "success")],
    [replyButton("❔ طريقة الاستخدام", "primary"), replyButton("📩 إرسال بلاغ", "primary")],
    [replyButton("🛑 إلغاء العملية", "danger")],
  ],
  resize_keyboard: true,
  is_persistent: true,
};

const OWNER_FOOTER = [
  [replyButton("↩️ رجوع", "primary"), replyButton("🏠 الرئيسية", "primary")],
];

export const OWNER_KEYBOARD = {
  keyboard: [
    [replyButton("🚀 تشغيل البوت", "success")],
    [replyButton("📊 الإحصاءات", "success"), replyButton("👥 إدارة المستخدمين", "primary")],
    [replyButton("🔒 الاشتراك الإجباري", "primary"), replyButton("⚙️ الإعدادات", "primary")],
    [replyButton("🧹 تنظيف البيانات", "danger"), replyButton("📣 إرسال للجميع", "primary")],
    [replyButton("📋 أخطاء حديثة", "primary"), replyButton("🛑 إلغاء العملية", "danger")],
  ],
  resize_keyboard: true,
  is_persistent: true,
};

export const OWNER_USERS_KEYBOARD = {
  keyboard: [
    [replyButton("👥 آخر المستخدمين", "primary"), replyButton("✅ النشطون", "primary")],
    [replyButton("🌙 غير النشطين", "primary"), replyButton("🚫 المحظورون", "primary")],
    [replyButton("🚫 حظر مستخدم", "danger"), replyButton("✅ فك الحظر", "success")],
    ...OWNER_FOOTER,
  ],
  resize_keyboard: true,
  is_persistent: true,
};

export const OWNER_SETTINGS_KEYBOARD = {
  keyboard: [
    [replyButton("⏱️ مدة التنظيف", "primary")],
    ...OWNER_FOOTER,
  ],
  resize_keyboard: true,
  is_persistent: true,
};

export const OWNER_CLEANUP_KEYBOARD = {
  keyboard: [
    [replyButton("🧹 تنظيف الآن", "danger"), replyButton("⏱️ مدة التنظيف", "primary")],
    ...OWNER_FOOTER,
  ],
  resize_keyboard: true,
  is_persistent: true,
};

export const OWNER_SUBSCRIPTIONS_KEYBOARD = {
  keyboard: [
    [replyButton("➕ إضافة قناة/بوت", "success"), replyButton("➖ إزالة قناة/بوت", "danger")],
    [replyButton("📋 قائمة الاشتراك", "primary")],
    ...OWNER_FOOTER,
  ],
  resize_keyboard: true,
  is_persistent: true,
};

export function subscriptionGateText(missing: ForcedSubscription[]) {
  const items = missing.map((subscription, index) => {
    const kindLabel = subscription.kind === "group" ? "مجموعة" : subscription.kind === "bot" ? "بوت" : "قناة";
    const link = subscription.inviteUrl ? ` <a href="${escapeHtml(subscription.inviteUrl)}">@${escapeHtml(subscription.label.replace(/^@/, ""))}</a>` : ` <code>${escapeHtml(subscription.label)}</code>`;
    return `${index + 1}. (${kindLabel})${link}`;
  }).join("\n");
  return `🔒 <b>اشتراك إجباري</b>

للحصول على خدمة التنزيل يجب الاشتراك أولاً في:

${items}

اضغط زر الاشتراك ثم زر <b>«تحققت من الاشتراك»</b>.`;
}

export function subscriptionGateKeyboard(missing: ForcedSubscription[]) {
  const joinRows = missing
    .filter(subscription => Boolean(subscription.inviteUrl))
    .map(subscription => [{ text: `🔗 اشترك الآن · ${subscription.label}`, url: subscription.inviteUrl }]);
  return {
    inline_keyboard: [
      ...joinRows,
      [inlineButton("✅ تحققت من الاشتراك", "sub_check", "primary")],
    ],
  };
}

export function inspectionText(result: InspectResult) {
  const duration = result.durationSeconds ? `\nالمدة التقريبية: <b>${Math.round(result.durationSeconds)} ثانية</b>` : "";
  const imagesCount = result.imageCount && result.imageCount > 1 ? `\n🖼 عدد الصور المتاحة: <b>${result.imageCount}</b>` : "";
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
العنوان: <b>${escapeHtml(result.title)}</b>${duration}${imagesCount}${accountBlock}

اختر نوع الملف المناسب. لا يُعرض إلا ما أكده الفحص من هذا الرابط العام.`;
}

const MEDIA_BUTTONS: Record<InspectResult["choices"][number], { text: string; style: ButtonStyle; iconEnv: string }> = {
  video: { text: "🎬 تنزيل فيديو", style: "primary", iconEnv: "BUTTON_CUSTOM_EMOJI_DOWNLOAD" },
  audio: { text: "🎵 تنزيل صوت", style: "success", iconEnv: "BUTTON_CUSTOM_EMOJI_AUDIO" },
  image: { text: "🖼 تنزيل صورة أصلية", style: "primary", iconEnv: "BUTTON_CUSTOM_EMOJI_IMAGE" },
  story: { text: "📖 تنزيل الستوري", style: "success", iconEnv: "BUTTON_CUSTOM_EMOJI_STORY" },
};

export function mediaChoiceKeyboard(jobId: string, choices: InspectResult["choices"], imageCount?: number) {
  const rows = choices.map(choice => [inlineButton(MEDIA_BUTTONS[choice].text, `dl:${jobId}:${choice}`, MEDIA_BUTTONS[choice].style, MEDIA_BUTTONS[choice].iconEnv)]);
  if (imageCount && imageCount > 1 && choices.includes("image")) {
    rows.push([inlineButton(`🖼 تنزيل الصور كاملة (${imageCount})`, `dl:${jobId}:images`, "success", "BUTTON_CUSTOM_EMOJI_IMAGE")]);
  }
  rows.push([inlineButton("✖️ إلغاء العملية", `cancel:${jobId}`, "danger", "BUTTON_CUSTOM_EMOJI_CANCEL")]);
  return { inline_keyboard: rows };
}

export function retryTikTokKeyboard(jobId: string) {
  return {
    inline_keyboard: [[inlineButton("🔄 إعادة محاولة TikTok", `retry_tiktok:${jobId}`, "primary")]],
  };
}