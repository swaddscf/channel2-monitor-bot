import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetDownloadQueueForTests, scheduleDownload } from "./downloadQueue";

const stubs = vi.hoisted(() => ({
  claimTelegramUpdate: vi.fn(),
  recordBotError: vi.fn(),
  isPrimaryOwner: vi.fn(),
  getOwnerRole: vi.fn(),
  sendMessage: vi.fn(),
  touchAndAdmitUser: vi.fn(),
  botStats: vi.fn(),
  listForcedSubscriptions: vi.fn(),
  addForcedSubscription: vi.fn(),
  removeForcedSubscription: vi.fn(),
  getChatMember: vi.fn(),
  sendWelcomePhoto: vi.fn(),
  setTelegramUserBlocked: vi.fn(),
  createMediaJob: vi.fn(),
  getMediaJob: vi.fn(),
  deleteMediaJob: vi.fn(),
  updateMediaJob: vi.fn(),
  answerCallbackQuery: vi.fn(),
  ensureBotSettings: vi.fn(),
  getUserAccess: vi.fn(),
  userDownloadsInWindow: vi.fn(),
  recordUserDownload: vi.fn(),
  listSubscriptionPlans: vi.fn(),
  findSubscriptionPlanById: vi.fn(),
  setUserSubscription: vi.fn(),
}));

vi.mock("./botDb", () => ({
  activeRecipients: vi.fn(async () => []),
  addForcedSubscription: stubs.addForcedSubscription,
  botStats: stubs.botStats,
  cancelLatestActiveJob: vi.fn(),
  cancelMediaJob: vi.fn(),
  claimTelegramUpdate: stubs.claimTelegramUpdate,
  cleanupBotData: vi.fn(),
  createMediaJob: stubs.createMediaJob,
  deleteMediaJob: stubs.deleteMediaJob,
  ensureBotSettings: stubs.ensureBotSettings,
  ensurePrimaryOwner: vi.fn(),
  getMediaJob: stubs.getMediaJob,
  getOwnerRole: stubs.getOwnerRole,
  getTelegramUser: vi.fn(async () => undefined),
  getUserAccess: stubs.getUserAccess,
  isPrimaryOwner: stubs.isPrimaryOwner,
  listForcedSubscriptions: stubs.listForcedSubscriptions,
  listOwners: vi.fn(async () => []),
  listSubscriptionPlans: stubs.listSubscriptionPlans,
  listTelegramUsers: vi.fn(),
  recentErrors: vi.fn(),
  recordBotError: stubs.recordBotError,
  recordUserDownload: stubs.recordUserDownload,
  removeForcedSubscription: stubs.removeForcedSubscription,
  setTelegramUserBlocked: stubs.setTelegramUserBlocked,
  setUserSubscription: stubs.setUserSubscription,
  touchAndAdmitUser: stubs.touchAndAdmitUser,
  updateCleanupInactiveDays: vi.fn(),
  updateMediaJob: stubs.updateMediaJob,
  userDownloadsInWindow: stubs.userDownloadsInWindow,
  findSubscriptionPlanById: stubs.findSubscriptionPlanById,
  setSubscriptionPlanActive: vi.fn(),
  updatePaidMode: vi.fn(),
  updateUsageLimit: vi.fn(),
  addSubscriptionPlan: vi.fn(),
}));

vi.mock("./downloader", () => ({
  abortYtDlp: vi.fn(),
  downloadAllImages: vi.fn(),
  downloadMedia: vi.fn(),
  DownloaderError: class DownloaderError extends Error {},
  inspectMediaLink: vi.fn(),
  purgeDownloadedMedia: vi.fn(),
}));

vi.mock("./telegramApi", () => ({
  answerCallbackQuery: stubs.answerCallbackQuery,
  answerPreCheckoutQuery: vi.fn(async () => true),
  getChatMember: stubs.getChatMember,
  sendChatAction: vi.fn(async () => true),
  sendDownloadedMedia: vi.fn(),
  sendInvoice: vi.fn(),
  sendMediaGroup: vi.fn(),
  sendMessage: stubs.sendMessage,
  sendWelcomePhoto: stubs.sendWelcomePhoto,
}));

import { buildReportNotification, processTelegramUpdate } from "./botService";
import { OWNER_KEYBOARD, OWNER_LIMITS_KEYBOARD, subscriptionGateKeyboard, subscriptionOfferKeyboard, usageLimitExceededText, USER_KEYBOARD } from "./messages";

function subscription(target: string, inviteUrl: string, kind = "channel") {
  return { id: `sub-${target}`, target, inviteUrl, label: `@${target}`, kind, createdAt: new Date() };
}

function ownerMessage(updateId: number, text: string, chatId = "902", id = 902) {
  return {
    update_id: updateId,
    message: { text, chat: { id: chatId, type: "private" }, from: { id, first_name: "مالك" } },
  } as never;
}

function userMessage(updateId: number, text: string, chatId = "901", id = 901) {
  return {
    update_id: updateId,
    message: { text, chat: { id: chatId, type: "private" }, from: { id, first_name: "مستخدم" } },
  } as never;
}

describe("معالجة تحديثات Telegram", () => {
  beforeEach(() => {
    stubs.claimTelegramUpdate.mockReset();
    stubs.recordBotError.mockReset();
    stubs.isPrimaryOwner.mockReset();
    stubs.getOwnerRole.mockReset();
    stubs.sendMessage.mockReset();
    stubs.touchAndAdmitUser.mockReset();
    stubs.botStats.mockReset();
    stubs.listForcedSubscriptions.mockReset();
    stubs.addForcedSubscription.mockReset();
    stubs.removeForcedSubscription.mockReset();
    stubs.getChatMember.mockReset();
    stubs.sendWelcomePhoto.mockReset();
    stubs.setTelegramUserBlocked.mockReset();
    stubs.createMediaJob.mockReset();
    stubs.getMediaJob.mockReset();
    stubs.deleteMediaJob.mockReset();
    stubs.updateMediaJob.mockReset();
    stubs.answerCallbackQuery.mockReset();
    stubs.ensureBotSettings.mockReset();
    stubs.getUserAccess.mockReset();
    stubs.userDownloadsInWindow.mockReset();
    stubs.recordUserDownload.mockReset();
    stubs.listSubscriptionPlans.mockReset();
    stubs.findSubscriptionPlanById.mockReset();
    stubs.setUserSubscription.mockReset();
    stubs.listForcedSubscriptions.mockResolvedValue([]);
    stubs.getOwnerRole.mockResolvedValue(undefined);
    stubs.getChatMember.mockResolvedValue({ status: "member" });
    stubs.sendWelcomePhoto.mockResolvedValue(true);
    stubs.ensureBotSettings.mockResolvedValue({
      id: "settings", maxUsers: 100, cleanupInactiveDays: 30, cleanupTempMinutes: 60,
      broadcastRatePerSecond: 20, notifyNewUsers: true, usageLimitEnabled: false,
      usageLimitCount: 5, usageLimitWindowHours: 24, paidModeEnabled: false,
      updatedAt: new Date().toISOString(),
    });
    stubs.getUserAccess.mockResolvedValue({ subscriptionExpiresAt: null, subscriptionPlanId: null, downloadTimestamps: [] });
    stubs.userDownloadsInWindow.mockResolvedValue(0);
  });

  afterEach(() => {
    resetDownloadQueueForTests();
    delete process.env.DOWNLOAD_MAX_CONCURRENT;
    delete process.env.DOWNLOAD_MAX_WAITING;
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
    stubs.sendWelcomePhoto.mockResolvedValue(true);
    await processTelegramUpdate(userMessage(44, "/start"));
    expect(stubs.sendMessage).toHaveBeenCalledWith("901", expect.stringContaining("أهلاً"), { replyMarkup: USER_KEYBOARD });
    expect(stubs.sendWelcomePhoto).toHaveBeenCalledWith("901");
  });

  it("يعرض لوحة المالك للمالك الأساسي فقط عند /start", async () => {
    stubs.claimTelegramUpdate.mockResolvedValue(true);
    stubs.touchAndAdmitUser.mockResolvedValue({ admission: "active", isNew: false });
    stubs.isPrimaryOwner.mockResolvedValue(true);
    stubs.getOwnerRole.mockResolvedValue("primary");
    await processTelegramUpdate(ownerMessage(45, "/start"));
    expect(stubs.sendMessage).toHaveBeenCalledWith("902", expect.stringContaining("أهلاً"), { replyMarkup: OWNER_KEYBOARD });
  });

  it("يفعّل زر «تشغيل البوت» تدفق الترحيب مثل /start", async () => {
    stubs.claimTelegramUpdate.mockResolvedValue(true);
    stubs.touchAndAdmitUser.mockResolvedValue({ admission: "active", isNew: false });
    stubs.isPrimaryOwner.mockResolvedValue(false);
    await processTelegramUpdate(userMessage(45, "🚀 تشغيل البوت"));
    expect(stubs.sendMessage).toHaveBeenCalledWith("901", expect.stringContaining("أهلاً"), { replyMarkup: USER_KEYBOARD });
    expect(stubs.sendWelcomePhoto).toHaveBeenCalledWith("901");
  });

  it("يمنع المستخدم غير المشترك قبل إرسال أي رابط عبر بوابة الاشتراك", async () => {
    stubs.claimTelegramUpdate.mockResolvedValue(true);
    stubs.touchAndAdmitUser.mockResolvedValue({ admission: "active", isNew: false });
    stubs.isPrimaryOwner.mockResolvedValue(false);
    stubs.listForcedSubscriptions.mockResolvedValue([subscription("mychannel", "https://t.me/mychannel")]);
    stubs.getChatMember.mockResolvedValue({ status: "left" });
    await processTelegramUpdate(userMessage(46, "https://vt.tiktok.com/ZSqhSCYFF/"));
    const delivered = stubs.sendMessage.mock.calls.map(([, text]) => String(text));
    expect(delivered.some(text => text.includes("اشتراك إجباري"))).toBe(true);
    expect(stubs.sendMessage).toHaveBeenCalledWith("901", expect.stringContaining("اشتراك إجباري"), {
      replyMarkup: subscriptionGateKeyboard([subscription("mychannel", "https://t.me/mychannel")]),
    });
    expect(stubs.createMediaJob).not.toHaveBeenCalled();
  });

  it("يسمح بفحص الرابط للمستخدم المشترك", async () => {
    stubs.claimTelegramUpdate.mockResolvedValue(true);
    stubs.touchAndAdmitUser.mockResolvedValue({ admission: "active", isNew: false });
    stubs.isPrimaryOwner.mockResolvedValue(false);
    stubs.listForcedSubscriptions.mockResolvedValue([subscription("mychannel", "https://t.me/mychannel")]);
    stubs.getChatMember.mockResolvedValue({ status: "member" });
    stubs.createMediaJob.mockResolvedValue("job-ok");
    await processTelegramUpdate(userMessage(47, "https://vt.tiktok.com/ZSqhSCYFF/"));
    expect(stubs.createMediaJob).toHaveBeenCalledWith("901", "https://vt.tiktok.com/ZSqhSCYFF/", "tiktok");
  });

  it("يحوّل التحقق من الاشتراك بعد الضغط على زر «تحققت» وينجح عند العضوية", async () => {
    stubs.claimTelegramUpdate.mockResolvedValue(true);
    stubs.isPrimaryOwner.mockResolvedValue(false);
    stubs.listForcedSubscriptions.mockResolvedValue([subscription("mychannel", "https://t.me/mychannel")]);
    stubs.getChatMember.mockResolvedValue({ status: "member" });
    await processTelegramUpdate({
      update_id: 48,
      callback_query: { id: "check1", data: "sub_check", from: { id: 901, first_name: "مستخدم" }, message: { message_id: 3, chat: { id: 901, type: "private" } } },
    } as never);
    expect(stubs.answerCallbackQuery).toHaveBeenCalledWith("check1", "تم التحقق من الاشتراك ✅");
    expect(stubs.sendMessage).toHaveBeenCalledWith("901", expect.stringContaining("تم التحقق من الاشتراك بنجاح"), expect.anything());
  });

  it("يضيف قناة اشتراك إجباري من إدخال المالك", async () => {
    stubs.claimTelegramUpdate.mockResolvedValue(true);
    stubs.touchAndAdmitUser.mockResolvedValue({ admission: "active", isNew: false });
    stubs.isPrimaryOwner.mockResolvedValue(true);
    stubs.getOwnerRole.mockResolvedValue("primary");
    stubs.addForcedSubscription.mockResolvedValue(true);
    await processTelegramUpdate(ownerMessage(49, "➕ إضافة قناة/بوت"));
    await processTelegramUpdate(ownerMessage(50, "mychannel"));
    expect(stubs.addForcedSubscription).toHaveBeenCalledWith({
      target: "mychannel", inviteUrl: "https://t.me/mychannel", label: "@mychannel", kind: "channel",
    });
    expect(stubs.sendMessage).toHaveBeenCalledWith("902", expect.stringContaining("تمت إضافة"), expect.anything());
  });

  it("يزيل قناة اشتراك إجباري من إدخال المالك", async () => {
    stubs.claimTelegramUpdate.mockResolvedValue(true);
    stubs.touchAndAdmitUser.mockResolvedValue({ admission: "active", isNew: false });
    stubs.isPrimaryOwner.mockResolvedValue(true);
    stubs.getOwnerRole.mockResolvedValue("primary");
    stubs.removeForcedSubscription.mockResolvedValue(true);
    await processTelegramUpdate(ownerMessage(51, "➖ إزالة قناة/بوت"));
    await processTelegramUpdate(ownerMessage(52, "mychannel"));
    expect(stubs.removeForcedSubscription).toHaveBeenCalledWith("mychannel");
  });

  it("يلغي إدخال الزر السابق وينفذ الزر الإداري الجديد فقط", async () => {
    stubs.touchAndAdmitUser.mockResolvedValue({ admission: "active", isNew: false });
    stubs.isPrimaryOwner.mockResolvedValue(true);
    stubs.getOwnerRole.mockResolvedValue("primary");
    stubs.claimTelegramUpdate.mockResolvedValue(true);
    await processTelegramUpdate(ownerMessage(53, "🚫 حظر مستخدم"));
    await processTelegramUpdate(ownerMessage(54, "⏱️ مدة التنظيف"));
    await processTelegramUpdate(ownerMessage(55, "30"));
    expect(stubs.setTelegramUserBlocked).not.toHaveBeenCalled();
    expect((await import("./botDb")).updateCleanupInactiveDays).toHaveBeenCalledWith(30);
  });

  it("لا يحمّل استعلامات لوحة المالك عندما يرسل المالك نصاً عادياً", async () => {
    stubs.touchAndAdmitUser.mockResolvedValue({ admission: "active", isNew: false });
    stubs.isPrimaryOwner.mockResolvedValue(true);
    stubs.getOwnerRole.mockResolvedValue("primary");
    stubs.claimTelegramUpdate.mockResolvedValue(true);
    await processTelegramUpdate(ownerMessage(56, "نص عادي"));
    expect(stubs.botStats).not.toHaveBeenCalled();
  });

  it("لا يحمّل الإحصاءات أثناء معالجة قيمة زر معلقة", async () => {
    stubs.touchAndAdmitUser.mockResolvedValue({ admission: "active", isNew: false });
    stubs.isPrimaryOwner.mockResolvedValue(true);
    stubs.getOwnerRole.mockResolvedValue("primary");
    stubs.claimTelegramUpdate.mockResolvedValue(true);
    await processTelegramUpdate(ownerMessage(57, "🚫 حظر مستخدم"));
    await processTelegramUpdate(ownerMessage(58, "180"));
    expect(stubs.botStats).not.toHaveBeenCalled();
    expect(stubs.setTelegramUserBlocked).toHaveBeenCalledWith("180", true);
  });

  it("لا يعرض زر الاشتراك الإجباري في لوحة أزرار المستخدم العادي", async () => {
    stubs.touchAndAdmitUser.mockResolvedValue({ admission: "active", isNew: false });
    stubs.isPrimaryOwner.mockResolvedValue(false);
    stubs.claimTelegramUpdate.mockResolvedValue(true);
    const texts = USER_KEYBOARD.keyboard.flat().map(button => button.text);
    expect(texts).not.toContain("🔒 الاشتراك الإجباري");
    expect(texts).not.toContain("📊 الإحصاءات");
  });

  it("يصفي خطأ TikTok الخام في رسالة المستخدم وتنبيه المالك ضمن تدفق الفحص", async () => {
    const previousOwnerId = process.env.OWNER_ID;
    process.env.OWNER_ID = "990";
    stubs.claimTelegramUpdate.mockResolvedValue(true);
    stubs.touchAndAdmitUser.mockResolvedValue({ admission: "active", isNew: false });
    stubs.isPrimaryOwner.mockResolvedValue(false);
    const { inspectMediaLink } = await import("./downloader");
    vi.mocked(inspectMediaLink).mockRejectedValue(new Error("ERROR: [TikTok] 7675360019281448199: Unexpected response from webpage request"));
    try {
      await processTelegramUpdate(userMessage(59, "https://vt.tiktok.com/ZSVXE4oUt/"));
      const deliveredTexts = stubs.sendMessage.mock.calls.map(([, text]) => String(text));
      expect(deliveredTexts.some(text => text.includes("ERROR:"))).toBe(false);
      expect(deliveredTexts.some(text => text.includes("حماية المصدر"))).toBe(true);
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
    const { inspectMediaLink } = await import("./downloader");
    stubs.createMediaJob.mockResolvedValueOnce("retry-old").mockResolvedValueOnce("retry-new");
    vi.mocked(inspectMediaLink).mockRejectedValueOnce(new Error("ERROR: [TikTok] 1: Unexpected response from webpage request"));
    await processTelegramUpdate(userMessage(60, "https://vt.tiktok.com/ZSVXE4oUt/"));
    expect(stubs.updateMediaJob).toHaveBeenCalledWith("retry-old", { status: "failed" });
    expect(stubs.sendMessage).toHaveBeenCalledWith("901", expect.stringContaining("إعادة محاولة TikTok"), {
      replyMarkup: { inline_keyboard: [[{ text: "🔄 إعادة محاولة TikTok", callback_data: "retry_tiktok:retry-old", style: "primary" }]] },
    });

    stubs.getMediaJob
      .mockResolvedValueOnce({ id: "retry-old", telegramId: "901", sourceUrl: "https://vt.tiktok.com/ZSVXE4oUt/", platform: "tiktok", status: "failed", expiresAt: new Date(Date.now() + 60_000) })
      .mockResolvedValueOnce({ id: "retry-new", cancelRequested: false });
    vi.mocked(inspectMediaLink).mockResolvedValue({ platform: "tiktok", title: "فيديو", choices: ["video", "audio"] });
    await processTelegramUpdate({
      update_id: 61,
      callback_query: {
        id: "retry-callback", data: "retry_tiktok:retry-old", from: { id: 901, first_name: "مستخدم" },
        message: { message_id: 12, chat: { id: 901, type: "private" } },
      },
    } as never);
    expect(stubs.deleteMediaJob).toHaveBeenCalledWith("retry-old");
    expect(vi.mocked(inspectMediaLink)).toHaveBeenLastCalledWith("https://vt.tiktok.com/ZSVXE4oUt/", "retry-new");
    expect(stubs.answerCallbackQuery).toHaveBeenCalledWith("retry-callback", "جارٍ إعادة فحص الرابط");
  });

  it("يرفض زر إعادة محاولة TikTok إذا ضغطه مستخدم آخر", async () => {
    stubs.claimTelegramUpdate.mockResolvedValue(true);
    stubs.isPrimaryOwner.mockResolvedValue(false);
    stubs.getMediaJob.mockResolvedValue({ id: "retry-owned", telegramId: "901", sourceUrl: "https://vt.tiktok.com/1", platform: "tiktok", status: "failed", expiresAt: new Date(Date.now() + 60_000) });
    await processTelegramUpdate({
      update_id: 62,
      callback_query: { id: "other-user", data: "retry_tiktok:retry-owned", from: { id: 911, first_name: "آخر" } },
    } as never);
    expect(stubs.deleteMediaJob).not.toHaveBeenCalled();
    expect(stubs.answerCallbackQuery).toHaveBeenCalledWith("other-user", "انتهت صلاحية إعادة المحاولة. أرسل الرابط من جديد.");
  });

  it("يبقي الطلب قابلاً للتنزيل عند امتلاء صف التنزيل", async () => {
    stubs.claimTelegramUpdate.mockResolvedValue(true);
    stubs.isPrimaryOwner.mockResolvedValue(false);
    stubs.getMediaJob.mockResolvedValue({
      id: "busy-job", telegramId: "901", sourceUrl: "https://www.tiktok.com/@a/video/1", platform: "tiktok", status: "ready", cancelRequested: false,
    });
    process.env.DOWNLOAD_MAX_CONCURRENT = "2";
    process.env.DOWNLOAD_MAX_WAITING = "12";
    scheduleDownload(async () => new Promise<never>(() => undefined));
    scheduleDownload(async () => new Promise<never>(() => undefined));
    for (let index = 0; index < 12; index += 1) scheduleDownload(async () => index);
    await processTelegramUpdate({
      update_id: 63,
      callback_query: {
        id: "busy-callback", data: "dl:busy-job:video", from: { id: 901, first_name: "مستخدم" },
        message: { message_id: 22, chat: { id: 901, type: "private" } },
      },
    } as never);
    expect(stubs.answerCallbackQuery).toHaveBeenCalledWith("busy-callback", "بدأ تجهيز الملف");
    expect(stubs.updateMediaJob).toHaveBeenCalledWith("busy-job", { status: "ready" });
    expect(stubs.deleteMediaJob).not.toHaveBeenCalledWith("busy-job");
    expect(stubs.sendMessage).toHaveBeenCalledWith("901", expect.stringContaining("اضغط على زر التنزيل مجدداً"), expect.anything());
  });

  it("لا يعرض إعادة محاولة TikTok عندما يكون المحتوى خاصاً أو غير متاح", async () => {
    stubs.claimTelegramUpdate.mockResolvedValue(true);
    stubs.touchAndAdmitUser.mockResolvedValue({ admission: "active", isNew: false });
    stubs.isPrimaryOwner.mockResolvedValue(false);
    const { inspectMediaLink } = await import("./downloader");
    stubs.createMediaJob.mockResolvedValue("private-tiktok");
    vi.mocked(inspectMediaLink).mockRejectedValue(new Error("لا يمكن الوصول إلى هذا المحتوى لأنه خاص أو محمي أو يتطلب تسجيل دخول."));
    await processTelegramUpdate(userMessage(64, "https://vt.tiktok.com/ZSVXE4oUt/"));
    const deliveredTexts = stubs.sendMessage.mock.calls.map(([, text]) => String(text));
    expect(deliveredTexts.some(text => text.includes("إعادة محاولة TikTok"))).toBe(false);
    expect(stubs.deleteMediaJob).toHaveBeenCalledWith("private-tiktok");
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

  it("يعرض صفحة الحدود للمالك ويضبط عدد التنزيلات من الإدخال", async () => {
    stubs.claimTelegramUpdate.mockResolvedValue(true);
    stubs.touchAndAdmitUser.mockResolvedValue({ admission: "active", isNew: false });
    stubs.isPrimaryOwner.mockResolvedValue(true);
    stubs.getOwnerRole.mockResolvedValue("primary");
    await processTelegramUpdate(ownerMessage(70, "💳 الحدود والاشتراك"));
    expect(stubs.sendMessage).toHaveBeenCalledWith("902", expect.stringContaining("حد الاستخدام"), { replyMarkup: OWNER_LIMITS_KEYBOARD });
    await processTelegramUpdate(ownerMessage(71, "⏱️ عدد التنزيلات"));
    await processTelegramUpdate(ownerMessage(72, "5"));
    expect((await import("./botDb")).updateUsageLimit).toHaveBeenCalledWith({ count: 5, enabled: true });
    expect(stubs.sendMessage).toHaveBeenCalledWith("902", expect.stringContaining("تم ضبط حد التنزيل"), { replyMarkup: OWNER_LIMITS_KEYBOARD });
  });

  it("يعرض حزم الاشتراك للمستخدم الذي استنفد حصته في الوضع المدفوع", async () => {
    stubs.claimTelegramUpdate.mockResolvedValue(true);
    stubs.isPrimaryOwner.mockResolvedValue(false);
    stubs.getMediaJob.mockResolvedValue({
      id: "quota-job", telegramId: "901", sourceUrl: "https://www.tiktok.com/@a/video/1", platform: "tiktok", status: "ready", cancelRequested: false,
    });
    stubs.ensureBotSettings.mockResolvedValue({
      id: "settings", maxUsers: 100, cleanupInactiveDays: 30, cleanupTempMinutes: 60,
      broadcastRatePerSecond: 20, notifyNewUsers: true, usageLimitEnabled: true,
      usageLimitCount: 5, usageLimitWindowHours: 24, paidModeEnabled: true,
      updatedAt: new Date().toISOString(),
    });
    stubs.getUserAccess.mockResolvedValue({ subscriptionExpiresAt: null, subscriptionPlanId: null, downloadTimestamps: [] });
    stubs.userDownloadsInWindow.mockResolvedValue(5);
    const plans = [{ id: "p1", name: "شهري", durationDays: 30, stars: 100, active: true, createdAt: new Date() }];
    stubs.listSubscriptionPlans.mockResolvedValue(plans);
    await processTelegramUpdate({
      update_id: 73,
      callback_query: { id: "quota-cb", data: "dl:quota-job:video", from: { id: 901, first_name: "مستخدم" }, message: { message_id: 30, chat: { id: 901, type: "private" } } },
    } as never);
    expect(stubs.answerCallbackQuery).toHaveBeenCalledWith("quota-cb", "انتهت حصتك المجانية");
    expect(stubs.sendMessage).toHaveBeenCalledWith("901", usageLimitExceededText(5, 24, true), { replyMarkup: subscriptionOfferKeyboard(plans) });
    expect(stubs.deleteMediaJob).not.toHaveBeenCalledWith("quota-job");
  });

  it("يفعّل اشتراك المستخدم فور نجاح الدفع بالنجوم", async () => {
    stubs.claimTelegramUpdate.mockResolvedValue(true);
    stubs.touchAndAdmitUser.mockResolvedValue({ admission: "active", isNew: false });
    stubs.isPrimaryOwner.mockResolvedValue(false);
    stubs.findSubscriptionPlanById.mockResolvedValue({ id: "p1", name: "شهري", durationDays: 30, stars: 100, active: true, createdAt: new Date() });
    await processTelegramUpdate({
      update_id: 74,
      message: {
        message_id: 40, chat: { id: 901, type: "private" }, from: { id: 901, first_name: "مستخدم" },
        successful_payment: { invoice_payload: "sub:p1", telegram_payment_charge_id: "charge-1", provider_payment_charge_id: "p-1", currency: "XTR", total_amount: 100 },
      },
    } as never);
    expect(stubs.setUserSubscription).toHaveBeenCalledWith("901", expect.any(Number), "p1");
    expect(stubs.sendMessage).toHaveBeenCalledWith("901", expect.stringContaining("تم تفعيل اشتراكك"), expect.anything());
  });

  it("يرفض إتمام الدفع للحزمة المتوقفة عبر استعلام ما قبل الشحن", async () => {
    stubs.claimTelegramUpdate.mockResolvedValue(true);
    stubs.findSubscriptionPlanById.mockResolvedValue(undefined);
    await processTelegramUpdate({
      update_id: 75,
      pre_checkout_query: { id: "pcq-1", from: { id: 901, first_name: "مستخدم" }, invoice_payload: "sub:ghost", currency: "XTR", total_amount: 100 },
    } as never);
    const { answerPreCheckoutQuery } = await import("./telegramApi");
    expect(answerPreCheckoutQuery).toHaveBeenCalledWith("pcq-1", false, "الحزمة غير متاحة حالياً.");
  });
});