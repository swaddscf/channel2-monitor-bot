import { afterEach, describe, expect, it } from "vitest";
import { OWNER_KEYBOARD, USER_KEYBOARD, mediaChoiceKeyboard, retryTikTokKeyboard } from "./messages";

describe("أزرار Telegram الملونة", () => {
  afterEach(() => {
    delete process.env.USE_CUSTOM_BUTTON_EMOJI;
    delete process.env.BUTTON_CUSTOM_EMOJI_DOWNLOAD;
  });

  it("يضيف نمط style لأزرار المستخدم", () => {
    expect(USER_KEYBOARD.keyboard[0][0]).toMatchObject({ text: "❔ طريقة الاستخدام", style: "primary" });
    expect(USER_KEYBOARD.keyboard[0][1]).toMatchObject({ text: "🛑 إلغاء العملية", style: "danger" });
    expect(USER_KEYBOARD.keyboard[1][0]).toMatchObject({ text: "📩 إرسال بلاغ", style: "primary" });
  });

  it("يضيف نمط style لأزرار المالك الأساسية", () => {
    expect(OWNER_KEYBOARD.keyboard[0][0]).toMatchObject({ text: "📊 الإحصاءات", style: "success" });
    expect(OWNER_KEYBOARD.keyboard[5][1]).toMatchObject({ text: "➕ إضافة مالك", style: "success" });
    expect(OWNER_KEYBOARD.keyboard[5][2]).toMatchObject({ text: "➖ حذف مالك", style: "danger" });
  });

  it("يبني أزرار الوسائط مع style و callback_data الصحيح", () => {
    expect(mediaChoiceKeyboard("job1", ["video", "audio", "image"]).inline_keyboard).toEqual([
      [{ text: "🎬 تنزيل فيديو", callback_data: "dl:job1:video", style: "primary" }],
      [{ text: "🎵 تنزيل صوت", callback_data: "dl:job1:audio", style: "success" }],
      [{ text: "🖼 تنزيل صورة أصلية", callback_data: "dl:job1:image", style: "primary" }],
      [{ text: "✖️ إلغاء العملية", callback_data: "cancel:job1", style: "danger" }],
    ]);
  });

  it("يبني زر إعادة محاولة TikTok بنمط primary", () => {
    expect(retryTikTokKeyboard("job9")).toEqual({
      inline_keyboard: [[{ text: "🔄 إعادة محاولة TikTok", callback_data: "retry_tiktok:job9", style: "primary" }]],
    });
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
