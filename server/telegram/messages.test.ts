import { afterEach, describe, expect, it } from "vitest";
import { mediaChoiceKeyboard, OWNER_KEYBOARD, OWNER_SUBSCRIPTIONS_KEYBOARD, retryTikTokKeyboard, subscriptionGateKeyboard, USER_KEYBOARD } from "./messages";
import type { ForcedSubscription } from "./types";

describe("أزرار Telegram الملونة", () => {
  afterEach(() => {
    delete process.env.USE_CUSTOM_BUTTON_EMOJI;
    delete process.env.BUTTON_CUSTOM_EMOJI_DOWNLOAD;
  });

  it("يضيف نمط style لأزرار المستخدم مع زر تشغيل البوت في الأعلى", () => {
    expect(USER_KEYBOARD.keyboard[0][0]).toMatchObject({ text: "🚀 تشغيل البوت", style: "success" });
    expect(USER_KEYBOARD.keyboard[1][0]).toMatchObject({ text: "❔ طريقة الاستخدام", style: "primary" });
    expect(USER_KEYBOARD.keyboard[1][1]).toMatchObject({ text: "📩 إرسال بلاغ", style: "primary" });
    expect(USER_KEYBOARD.keyboard[2][0]).toMatchObject({ text: "🛑 إلغاء العملية", style: "danger" });
  });

  it("ينظم لوحة المالك الرئيسية ويحذف الأزرار غير المهمة", () => {
    expect(OWNER_KEYBOARD.keyboard[0][0]).toMatchObject({ text: "🚀 تشغيل البوت", style: "success" });
    expect(OWNER_KEYBOARD.keyboard[1][0]).toMatchObject({ text: "📊 الإحصاءات", style: "success" });
    const texts = OWNER_KEYBOARD.keyboard.flat().map(button => button.text);
    expect(texts).toContain("👥 إدارة المستخدمين");
    expect(texts).toContain("🔒 الاشتراك الإجباري");
    expect(texts).toContain("⚙️ الإعدادات");
    expect(texts).not.toContain("📦 تحميل نسخة المشروع");
  });

  it("لا تضم لوحة المالك أزرار نسخة المشروع أو إدارة الملاك", () => {
    const texts = OWNER_KEYBOARD.keyboard.flat().map(button => button.text);
    expect(texts).toContain("👥 إدارة المستخدمين");
    expect(texts).not.toContain("➕ إضافة مالك");
    expect(texts).not.toContain("➖ حذف مالك");
    expect(texts).not.toContain("👑 الملاك");
    expect(texts).not.toContain("📦 تحميل نسخة المشروع");
  });

  it("توفر صفحات فرعية للمالك مع أزرار رجوع ورئيسية", () => {
    const footer = OWNER_SUBSCRIPTIONS_KEYBOARD.keyboard.at(-1);
    expect(footer).toEqual([
      expect.objectContaining({ text: "↩️ رجوع" }),
      expect.objectContaining({ text: "🏠 الرئيسية" }),
    ]);
    expect(OWNER_SUBSCRIPTIONS_KEYBOARD.keyboard[0][0]).toMatchObject({ text: "➕ إضافة قناة/بوت", style: "success" });
    expect(OWNER_SUBSCRIPTIONS_KEYBOARD.keyboard[0][1]).toMatchObject({ text: "➖ إزالة قناة/بوت", style: "danger" });
  });

  it("يبني أزرار الوسائط مع style و callback_data الصحيح", () => {
    expect(mediaChoiceKeyboard("job1", ["video", "audio", "image"]).inline_keyboard).toEqual([
      [{ text: "🎬 تنزيل فيديو", callback_data: "dl:job1:video", style: "primary" }],
      [{ text: "🎵 تنزيل صوت", callback_data: "dl:job1:audio", style: "success" }],
      [{ text: "🖼 تنزيل صورة أصلية", callback_data: "dl:job1:image", style: "primary" }],
      [{ text: "✖️ إلغاء العملية", callback_data: "cancel:job1", style: "danger" }],
    ]);
  });

  it("يضيف زر تنزيل الصور كاملة عند وجود أكثر من صورة", () => {
    const keyboard = mediaChoiceKeyboard("job1", ["video", "image"], 5).inline_keyboard;
    expect(keyboard).toEqual([
      [{ text: "🎬 تنزيل فيديو", callback_data: "dl:job1:video", style: "primary" }],
      [{ text: "🖼 تنزيل صورة أصلية", callback_data: "dl:job1:image", style: "primary" }],
      [{ text: "🖼 تنزيل الصور كاملة (5)", callback_data: "dl:job1:images", style: "success" }],
      [{ text: "✖️ إلغاء العملية", callback_data: "cancel:job1", style: "danger" }],
    ]);
  });

  it("لا يضيف زر الصور كاملة عندما تكون الصورة فردية", () => {
    const texts = mediaChoiceKeyboard("job1", ["image"]).inline_keyboard.flat().map(button => button.text);
    expect(texts).not.toContain("🖼 تنزيل الصور كاملة");
  });

  it("يبني زر إعادة محاولة TikTok بنمط primary", () => {
    expect(retryTikTokKeyboard("job9")).toEqual({
      inline_keyboard: [[{ text: "🔄 إعادة محاولة TikTok", callback_data: "retry_tiktok:job9", style: "primary" }]],
    });
  });

  it("يبني قائمة بوابة الاشتراك الإجباري مع أزرار انضمام وتحقق", () => {
    const subscription: ForcedSubscription = {
      id: "sub1", target: "mychannel", inviteUrl: "https://t.me/mychannel", label: "@mychannel", kind: "channel", createdAt: new Date(),
    };
    const keyboard = subscriptionGateKeyboard([subscription]).inline_keyboard;
    expect(keyboard[0][0]).toMatchObject({ text: "🔗 اشترك الآن · @mychannel", url: "https://t.me/mychannel" });
    expect(keyboard[1][0]).toMatchObject({ text: "✅ تحققت من الاشتراك", callback_data: "sub_check" });
  });

  it("لا يضيف إيموجي مخصصاً تلقائياً من دون تفعيل", () => {
    const button = mediaChoiceKeyboard("job1", ["video"]).inline_keyboard[0][0] as Record<string, unknown>;
    expect(button.icon_custom_emoji_id).toBeUndefined();
  });

  it("يضيف icon_custom_emoji_id عند تفعيل الميزة وضبط المعرّف", () => {
    process.env.USE_CUSTOM_BUTTON_EMOJI = "1";
    process.env.BUTTON_CUSTOM_EMOJI_DOWNLOAD = "5368324170671202286";
    const button = mediaChoiceKeyboard("job1", ["video"]).inline_keyboard[0][0] as Record<string, unknown>;
    expect(button.icon_custom_emoji_id).toBe("5368324170671202286");
  });
});