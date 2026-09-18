import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetDownloadQueueForTests, scheduleDownload } from "./downloadQueue";

const stubs = vi.hoisted(() => ({
  claimTelegramUpdate: vi.fn(),
  recordBotError: vi.fn(),
  isPrimaryOwner: vi.fn(),
  sendMessage: vi.fn(),
  touchAndAdmitUser: vi.fn(),
  updateMaxUsers: vi.fn(),
  botStats: vi.fn(),
  createProjectArchive: vi.fn(),
  sendProjectArchive: vi.fn(),
  purgeProjectArchive: vi.fn(),
  inspectMediaLink: vi.fn(),
  listOwners: vi.fn(),
  createMediaJob: vi.fn(),
  getMediaJob: vi.fn(),
  deleteMediaJob: vi.fn(),
  updateMediaJob: vi.fn(),
  answerCallbackQuery: vi.fn(),
}));

vi.mock("./botDb", () => ({
  activeRecipients: vi.fn(),
  addOwner: vi.fn(),
  botStats: stubs.botStats,
  cancelLatestActiveJob: vi.fn(),
  cancelMediaJob: vi.fn(),
  claimTelegramUpdate: stubs.claimTelegramUpdate,
  cleanupBotData: vi.fn(),
  createMediaJob: stubs.createMediaJob,
  deleteMediaJob: stubs.deleteMediaJob,
  ensurePrimaryOwner: vi.fn(),
  getMediaJob: stubs.getMediaJob,
  getOwnerRole: vi.fn(),
  isPrimaryOwner: stubs.isPrimaryOwner,
  listOwners: stubs.listOwners,
  listTelegramUsers: vi.fn(),
  recentErrors: vi.fn(),
  recordBotError: stubs.recordBotError,
  removeOwner: vi.fn(),
  setTelegramUserBlocked: vi.fn(),
  touchAndAdmitUser: stubs.touchAndAdmitUser,
  updateCleanupInactiveDays: vi.fn(),
  updateMediaJob: stubs.updateMediaJob,
  updateMaxUsers: stubs.updateMaxUsers,
}));

vi.mock("./downloader", () => ({
  abortYtDlp: vi.fn(),
  downloadMedia: vi.fn(),
  DownloaderError: class DownloaderError extends Error {},
  inspectMediaLink: stubs.inspectMediaLink,
  purgeDownloadedMedia: vi.fn(),
}));

vi.mock("./projectArchive", () => ({
  createProjectArchive: stubs.createProjectArchive,
  purgeProjectArchive: stubs.purgeProjectArchive,
}));

vi.mock("./telegramApi", () => ({
  answerCallbackQuery: stubs.answerCallbackQuery,
  sendChatAction: vi.fn(async () => true),
  sendDownloadedMedia: vi.fn(),
  sendMessage: stubs.sendMessage,
  sendProjectArchive: stubs.sendProjectArchive,
}));

import { buildReportNotification, ownerFacingMediaError, processTelegramUpdate, userFacingMediaError } from "./botService";
import { OWNER_KEYBOARD, USER_KEYBOARD } from "./messages";

describe("معالجة تحديثات Telegram", () => {
  beforeEach(() => {
    stubs.claimTelegramUpdate.mockReset();
    stubs.recordBotError.mockReset();
    stubs.isPrimaryOwner.mockReset();
    stubs.sendMessage.mockReset();
    stubs.touchAndAdmitUser.mockReset();
    stubs.updateMaxUsers.mockReset();
    stubs.botStats.mockReset();
    stubs.createProjectArchive.mockReset();
    stubs.sendProjectArchive.mockReset();
    stubs.purgeProjectArchive.mockReset();
    stubs.inspectMediaLink.mockReset();
    stubs.listOwners.mockReset();
    stubs.createMediaJob.mockReset();
    stubs.getMediaJob.mockReset();
    stubs.deleteMediaJob.mockReset();
    stubs.updateMediaJob.mockReset();
    stubs.answerCallbackQuery.mockReset();
    stubs.listOwners.mockResolvedValue([]);
  });

  afterEach(() => {
    resetDownloadQueueForTests();
  });

  it("يرفض update_id غير صالح قبل أي عملية قاعدة بيانات", async () => {
    await processTelegramUpdate({ update_id: -1 } as never);
    expect(stubs.claimTelegramUpdate).not.toHaveBeenCalled();
  });

  it("لا يعالج التحديث المكرر بعد أن ترفضه طبقة المطالبة", async () => {
    stubs.claimTelegramUpdate.mockResolvedValue(false);
    await processTelegramUpdate({ update_id: 42 } as never);
    expect(stubs.claimTelegramUpdate).toHaveBeenCalledWith(42);
    expect(stubs.recordBotError).not.toHaveBeenCalled();
  });

  it("يقبل تحديثاً صالحاً مرة واحدة عندما تمنحه طبقة المطالبة", async () => {
    stubs.claimTelegramUpdate.mockResolvedValue(true);
    await processTelegramUpdate({ update_id: 43 } as never);
    expect(stubs.claimTelegramUpdate).toHaveBeenCalledWith(43);
  });

  it("يعرض أزرار المستخدم فقط للمستخدم العادي عند /start", async () => {
    stubs.claimTelegramUpdate.mockResolvedValue(true);
    stubs.touchAndAdmitUser.mockResolvedValue({ admission: "active", isNew: false });
    stubs.isPrimaryOwner.mockResolvedValue(false);
    await processTelegramUpdate({
      update_id: 44,
      message: { text: "/start", chat: { id: 901, type: "private" }, from: { id: 901, first_name: "مستخدم" } },
    } as never);
    expect(stubs.sendMessage).toHaveBeenCalledWith("901", expect.stringContaining("أهلاً"), { replyMarkup: USER_KEYBOARD });
  });

  it("يعرض لوحة المالك للمالك الأساسي فقط عند /start", async () => {
    stubs.claimTelegramUpdate.mockResolvedValue(true);
    stubs.touchAndAdmitUser.mockResolvedValue({ admission: "active", isNew: false });
    stubs.isPrimaryOwner.mockResolvedValue(true);
    await processTelegramUpdate({
      update_id: 45,
      message: { text: "/start", chat: { id: 902, type: "private" }, from: { id: 902, first_name: "مالك" } },
    } as never);
    expect(stubs.sendMessage).toHaveBeenCalledWith("902", expect.stringContaining("أهلاً"), { replyMarkup: OWNER_KEYBOARD });
  });

  it("يضبط سعة البوت من الزر ثم الرقم من دون أمر نصي", async () => {
    stubs.touchAndAdmitUser.mockResolvedValue({ admission: "active", isNew: false });
    stubs.isPrimaryOwner.mockResolvedValue(true);
    stubs.claimTelegramUpdate.mockResolvedValue(true);
    await processTelegramUpdate({
      update_id: 46,
      message: { text: "⚙️ سعة البوت", chat: { id: 902, type: "private" }, from: { id: 902, first_name: "مالك" } },
    } as never);
    expect(stubs.sendMessage).toHaveBeenCalledWith("902", expect.stringContaining("أرسل العدد الجديد"), { replyMarkup: OWNER_KEYBOARD });

    stubs.claimTelegramUpdate.mockResolvedValue(true);
    await processTelegramUpdate({
      update_id: 47,
      message: { text: "150", chat: { id: 902, type: "private" }, from: { id: 902, first_name: "مالك" } },
    } as never);
    expect(stubs.updateMaxUsers).toHaveBeenCalledWith(150);
    expect(stubs.sendMessage).toHaveBeenCalledWith("902", expect.stringContaining("150"), { replyMarkup: OWNER_KEYBOARD });
    expect(stubs.botStats).not.toHaveBeenCalled();
  });

  it("يلغي إدخال الزر السابق وينفذ الزر الإداري الجديد فقط", async () => {
    stubs.touchAndAdmitUser.mockResolvedValue({ admission: "active", isNew: false });
    stubs.isPrimaryOwner.mockResolvedValue(true);
    stubs.claimTelegramUpdate.mockResolvedValue(true);
    await processTelegramUpdate({
      update_id: 48,
      message: { text: "🔒 حظر مستخدم", chat: { id: 902, type: "private" }, from: { id: 902, first_name: "مالك" } },
    } as never);
    await processTelegramUpdate({
      update_id: 49,
      message: { text: "⚙️ سعة البوت", chat: { id: 902, type: "private" }, from: { id: 902, first_name: "مالك" } },
    } as never);
    await processTelegramUpdate({
      update_id: 50,
      message: { text: "220", chat: { id: 902, type: "private" }, from: { id: 902, first_name: "مالك" } },
    } as never);
    expect(stubs.updateMaxUsers).toHaveBeenCalledWith(220);
  });

  it("لا يحمّل استعلامات لوحة المالك عندما يرسل المالك نصاً عادياً", async () => {
    stubs.touchAndAdmitUser.mockResolvedValue({ admission: "active", isNew: false });
    stubs.isPrimaryOwner.mockResolvedValue(true);
    stubs.claimTelegramUpdate.mockResolvedValue(true);
    await processTelegramUpdate({
      update_id: 51,
      message: { text: "نص عادي", chat: { id: 902, type: "private" }, from: { id: 902, first_name: "مالك" } },
    } as never);
    expect(stubs.botStats).not.toHaveBeenCalled();
  });

  it("لا يحمّل الإحصاءات أثناء معالجة قيمة زر معلقة", async () => {
    stubs.touchAndAdmitUser.mockResolvedValue({ admission: "active", isNew: false });
    stubs.isPrimaryOwner.mockResolvedValue(true);
    stubs.claimTelegramUpdate.mockResolvedValue(true);
    await processTelegramUpdate({
      update_id: 52,
      message: { text: "⚙️ سعة البوت", chat: { id: 902, type: "private" }, from: { id: 902, first_name: "مالك" } },
    } as never);
    await processTelegramUpdate({
      update_id: 53,
      message: { text: "180", chat: { id: 902, type: "private" }, from: { id: 902, first_name: "مالك" } },
    } as never);
    expect(stubs.botStats).not.toHaveBeenCalled();
    expect(stubs.updateMaxUsers).toHaveBeenCalledWith(180);
  });

  it("لا ينشئ نسخة المشروع لغير المالك الأساسي", async () => {
    stubs.touchAndAdmitUser.mockResolvedValue({ admission: "active", isNew: false });
    stubs.isPrimaryOwner.mockResolvedValue(false);
    stubs.claimTelegramUpdate.mockResolvedValue(true);
    await processTelegramUpdate({
      update_id: 54,
      message: { text: "📦 نسخة المشروع", chat: { id: 901, type: "private" }, from: { id: 901, first_name: "مستخدم" } },
    } as never);
    expect(stubs.createProjectArchive).not.toHaveBeenCalled();
    expect(stubs.sendProjectArchive).not.toHaveBeenCalled();
  });

  it("لا يرى المالك الإضافي زر نسخة المشروع ولا يستطيع طلبه", async () => {
    stubs.touchAndAdmitUser.mockResolvedValue({ admission: "active", isNew: false });
    stubs.isPrimaryOwner.mockResolvedValue(false);
    stubs.claimTelegramUpdate.mockResolvedValue(true);
    await processTelegramUpdate({
      update_id: 56,
      message: { text: "/start", chat: { id: 903, type: "private" }, from: { id: 903, first_name: "مالك إضافي" } },
    } as never);
    expect(stubs.sendMessage).toHaveBeenCalledWith("903", expect.stringContaining("أهلاً"), { replyMarkup: USER_KEYBOARD });
    await processTelegramUpdate({
      update_id: 57,
      message: { text: "📦 نسخة المشروع", chat: { id: 903, type: "private" }, from: { id: 903, first_name: "مالك إضافي" } },
    } as never);
    expect(stubs.createProjectArchive).not.toHaveBeenCalled();
    expect(stubs.sendProjectArchive).not.toHaveBeenCalled();
  });

  it("يرسل نسخة المشروع للمالك الأساسي ثم يحذف الأرشيف المؤقت", async () => {
    stubs.touchAndAdmitUser.mockResolvedValue({ admission: "active", isNew: false });
    stubs.isPrimaryOwner.mockResolvedValue(true);
    stubs.claimTelegramUpdate.mockResolvedValue(true);
    stubs.createProjectArchive.mockResolvedValue({ archivePath: "/tmp/project.zip", workdir: "/tmp/project-export", bytes: 2_048 });
    await processTelegramUpdate({
      update_id: 55,
      message: { text: "📦 نسخة المشروع", chat: { id: 902, type: "private" }, from: { id: 902, first_name: "مالك" } },
    } as never);
    expect(stubs.sendProjectArchive).toHaveBeenCalledWith("902", "/tmp/project.zip", expect.stringContaining("نسخة مشروع البوت"));
    expect(stubs.purgeProjectArchive).toHaveBeenCalledWith("/tmp/project-export");
  });

  it("ينشئ بطاقة بلاغ باسم المستخدم ورابط مباشر لملفه", () => {
    const notification = buildReportNotification({
      text: "مشكلة في الرابط",
      chat: { id: 904, type: "private" },
      from: { id: 904, first_name: "مستخدم", username: "tester_user" },
    } as never, "الرابط لا يعمل");
    expect(notification.text).toContain("@tester_user");
    expect(notification.text).toContain("الرابط لا يعمل");
    expect(notification.replyMarkup.inline_keyboard[0][0].url).toBe("https://t.me/tester_user");
  });

  it("يستخدم رابط Telegram المباشر عندما لا يملك المبلّغ اسم مستخدم", () => {
    const notification = buildReportNotification({
      text: "مشكلة",
      chat: { id: 905, type: "private" },
      from: { id: 905, first_name: "مستخدم بلا معرف" },
    } as never, "تفاصيل مختصرة");
    expect(notification.text).toContain("905");
    expect(notification.replyMarkup.inline_keyboard[0][0].url).toBe("tg://user?id=905");
  });

  it("يصفي خطأ TikTok الخام في رسالة المستخدم وتنبيه المالك ضمن تدفق الفحص", async () => {
    const previousOwnerId = process.env.OWNER_ID;
    process.env.OWNER_ID = "990";
    stubs.claimTelegramUpdate.mockResolvedValue(true);
    stubs.touchAndAdmitUser.mockResolvedValue({ admission: "active", isNew: false });
    stubs.isPrimaryOwner.mockResolvedValue(false);
    stubs.inspectMediaLink.mockRejectedValue(new Error("ERROR: [TikTok] 7675360019281448199: Unexpected response from webpage request"));
    try {
      await processTelegramUpdate({
        update_id: 58,
        message: { text: "https://vt.tiktok.com/ZSVXE4oUt/", chat: { id: 909, type: "private" }, from: { id: 909, first_name: "مستخدم" } },
      } as never);
      const deliveredTexts = stubs.sendMessage.mock.calls.map(([, text]) => String(text));
      expect(deliveredTexts.some(text => text.includes("ERROR:"))).toBe(false);
      expect(deliveredTexts.some(text => text.includes("حماية المصدر"))).toBe(true);
      expect(deliveredTexts.some(text => text.includes("رفض TikTok"))).toBe(true);
      expect(stubs.recordBotError).toHaveBeenCalledWith(expect.objectContaining({ message: expect.stringContaining("رفض TikTok") }));
    } finally {
      if (previousOwnerId === undefined) delete process.env.OWNER_ID;
      else process.env.OWNER_ID = previousOwnerId;
    }
  });

  it("يعرض إعادة محاولة TikTok للطلب الفاشل ويعيد فحص الرابط لصاحبه فقط", async () => {
    stubs.claimTelegramUpdate.mockResolvedValue(true);
    stubs.touchAndAdmitUser.mockResolvedValue({ admission: "active", isNew: false });
    stubs.isPrimaryOwner.mockResolvedValue(false);
    stubs.createMediaJob.mockResolvedValueOnce("retry-old").mockResolvedValueOnce("retry-new");
    stubs.inspectMediaLink.mockRejectedValueOnce(new Error("ERROR: [TikTok] 1: Unexpected response from webpage request"));
    await processTelegramUpdate({
      update_id: 59,
      message: { text: "https://vt.tiktok.com/ZSVXE4oUt/", chat: { id: 910, type: "private" }, from: { id: 910, first_name: "مستخدم" } },
    } as never);
    expect(stubs.updateMediaJob).toHaveBeenCalledWith("retry-old", { status: "failed" });
    expect(stubs.sendMessage).toHaveBeenCalledWith("910", expect.stringContaining("إعادة محاولة TikTok"), {
      replyMarkup: { inline_keyboard: [[{ text: "🔄 إعادة محاولة TikTok", callback_data: "retry_tiktok:retry-old", style: "primary" }]] },
    });

    stubs.getMediaJob
      .mockResolvedValueOnce({ id: "retry-old", telegramId: "910", sourceUrl: "https://vt.tiktok.com/ZSVXE4oUt/", platform: "tiktok", status: "failed", expiresAt: new Date(Date.now() + 60_000) })
      .mockResolvedValueOnce({ id: "retry-new", cancelRequested: false });
    stubs.inspectMediaLink.mockResolvedValueOnce({ platform: "tiktok", title: "فيديو", choices: ["video", "audio"] });
    await processTelegramUpdate({
      update_id: 60,
      callback_query: {
        id: "retry-callback", data: "retry_tiktok:retry-old", from: { id: 910, first_name: "مستخدم" },
        message: { message_id: 12, chat: { id: 910, type: "private" } },
      },
    } as never);
    expect(stubs.deleteMediaJob).toHaveBeenCalledWith("retry-old");
    expect(stubs.inspectMediaLink).toHaveBeenLastCalledWith("https://vt.tiktok.com/ZSVXE4oUt/", "retry-new");
    expect(stubs.answerCallbackQuery).toHaveBeenCalledWith("retry-callback", "جارٍ إعادة فحص الرابط");
  });

  it("يرفض زر إعادة محاولة TikTok إذا ضغطه مستخدم آخر", async () => {
    stubs.claimTelegramUpdate.mockResolvedValue(true);
    stubs.isPrimaryOwner.mockResolvedValue(false);
    stubs.getMediaJob.mockResolvedValue({ id: "retry-owned", telegramId: "910", sourceUrl: "https://vt.tiktok.com/ZSVXE4oUt/", platform: "tiktok", status: "failed", expiresAt: new Date(Date.now() + 60_000) });
    await processTelegramUpdate({
      update_id: 61,
      callback_query: { id: "other-user", data: "retry_tiktok:retry-owned", from: { id: 911, first_name: "آخر" } },
    } as never);
    expect(stubs.deleteMediaJob).not.toHaveBeenCalled();
    expect(stubs.answerCallbackQuery).toHaveBeenCalledWith("other-user", "انتهت صلاحية إعادة المحاولة. أرسل الرابط من جديد.");
  });

  it("يبقي الطلب قابلاً للتنزيل عند امتلاء صف التنزيل", async () => {
    stubs.claimTelegramUpdate.mockResolvedValue(true);
    stubs.isPrimaryOwner.mockResolvedValue(false);
    stubs.getMediaJob.mockResolvedValue({
      id: "busy-job", telegramId: "920", sourceUrl: "https://www.tiktok.com/@a/video/1", platform: "tiktok", status: "ready", cancelRequested: false,
    });
    scheduleDownload(async () => new Promise<never>(() => undefined));
    scheduleDownload(async () => new Promise<never>(() => undefined));
    for (let index = 0; index < 12; index += 1) scheduleDownload(async () => index);
    await processTelegramUpdate({
      update_id: 62,
      callback_query: {
        id: "busy-callback", data: "dl:busy-job:video", from: { id: 920, first_name: "مستخدم" },
        message: { message_id: 22, chat: { id: 920, type: "private" } },
      },
    } as never);
    expect(stubs.answerCallbackQuery).toHaveBeenCalledWith("busy-callback", "بدأ تجهيز الملف");
    expect(stubs.updateMediaJob).toHaveBeenCalledWith("busy-job", { status: "ready" });
    expect(stubs.deleteMediaJob).not.toHaveBeenCalledWith("busy-job");
    expect(stubs.sendMessage).toHaveBeenCalledWith("920", expect.stringContaining("اضغط على زر التنزيل مجدداً"), expect.anything());
  });

  it("لا يعرض إعادة محاولة TikTok عندما يكون المحتوى خاصاً أو غير متاح", async () => {
    stubs.claimTelegramUpdate.mockResolvedValue(true);
    stubs.touchAndAdmitUser.mockResolvedValue({ admission: "active", isNew: false });
    stubs.isPrimaryOwner.mockResolvedValue(false);
    stubs.createMediaJob.mockResolvedValue("private-tiktok");
    stubs.inspectMediaLink.mockRejectedValue(new Error("لا يمكن الوصول إلى هذا المحتوى لأنه خاص أو محمي أو يتطلب تسجيل دخول."));
    await processTelegramUpdate({
      update_id: 62,
      message: { text: "https://vt.tiktok.com/ZSVXE4oUt/", chat: { id: 912, type: "private" }, from: { id: 912, first_name: "مستخدم" } },
    } as never);
    const deliveredTexts = stubs.sendMessage.mock.calls.map(([, text]) => String(text));
    expect(deliveredTexts.some(text => text.includes("إعادة محاولة TikTok"))).toBe(false);
    expect(stubs.deleteMediaJob).toHaveBeenCalledWith("private-tiktok");
  });
});

describe("رسائل فشل TikTok", () => {
  it("لا تمرر خطأ محرك TikTok الخام إلى المستخدم أو المالك", () => {
    const raw = new Error("ERROR: [TikTok] 7675360019281448199: Unexpected response from webpage request");
    expect(userFacingMediaError(raw)).not.toContain("ERROR:");
    expect(userFacingMediaError(raw)).toContain("حماية المصدر");
    expect(ownerFacingMediaError(raw)).not.toContain("ERROR:");
    expect(ownerFacingMediaError(raw)).toContain("رفض TikTok");
  });
});
