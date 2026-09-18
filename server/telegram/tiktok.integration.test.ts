import { stat } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { downloadMedia, inspectMediaLink, purgeDownloadedMedia } from "./downloader";

const runLive = process.env.RUN_LIVE_MEDIA_TESTS === "1";
const publicTikTokVideo = "https://www.tiktok.com/@scout2015/video/6718335390845095173";
const publicTikTokPhoto = "https://www.tiktok.com/@mens.guidance/photo/7467226363544554770";
const reportedShortTikTokVideo = "https://vt.tiktok.com/ZSVXKeJL7/";
const newlyReportedShortTikTokVideo = "https://vt.tiktok.com/ZSVXE4oUt/";

describe("فحص فيديو TikTok عام", () => {
  it.runIf(runLive)("يعرض الفيديو والصوت فقط عندما يؤكدهما المصدر", async () => {
    const inspection = await inspectMediaLink(publicTikTokVideo, "live-tiktok-inspection");
    expect(inspection.platform).toBe("tiktok");
    expect(inspection.choices).toContain("video");
    expect(inspection.choices).toContain("audio");
  }, 100_000);

  it.runIf(runLive)("ينزّل الصوت في ملف مؤقت ثم يحذفه", async () => {
    const output = await downloadMedia(publicTikTokVideo, "audio", "live-tiktok-audio");
    try {
      expect((await stat(output.filePath)).size).toBeGreaterThan(0);
    } finally {
      await purgeDownloadedMedia(output.workdir);
    }
  }, 150_000);

  it.runIf(runLive)("ينزّل الفيديو في ملف مؤقت ثم يحذفه", async () => {
    const output = await downloadMedia(publicTikTokVideo, "video", "live-tiktok-video");
    try {
      expect((await stat(output.filePath)).size).toBeGreaterThan(0);
    } finally {
      await purgeDownloadedMedia(output.workdir);
    }
  }, 180_000);

  it.runIf(runLive)("يفحص رابط TikTok للصورة وينزّل الصورة المؤقتة", async () => {
    const inspection = await inspectMediaLink(publicTikTokPhoto, "live-tiktok-photo-inspection");
    expect(inspection.platform).toBe("tiktok");
    expect(inspection.choices).toContain("image");
    const output = await downloadMedia(publicTikTokPhoto, "image", "live-tiktok-photo-download");
    try {
      expect((await stat(output.filePath)).size).toBeGreaterThan(0);
    } finally {
      await purgeDownloadedMedia(output.workdir);
    }
  }, 180_000);

  it.runIf(runLive)("يفحص الرابط المختصر الذي واجه خطأ استجابة الصفحة", async () => {
    const inspection = await inspectMediaLink(reportedShortTikTokVideo, "live-tiktok-reported-short-link");
    expect(inspection.platform).toBe("tiktok");
    expect(inspection.choices.length).toBeGreaterThan(0);
  }, 100_000);

  it.runIf(runLive)("يفحص الرابط المختصر الجديد الذي أبلغ عنه المستخدم", async () => {
    const inspection = await inspectMediaLink(newlyReportedShortTikTokVideo, "live-tiktok-newly-reported-short-link");
    expect(inspection.platform).toBe("tiktok");
    expect(inspection.choices).toContain("video");
    expect(inspection.choices).toContain("audio");
    const output = await downloadMedia(newlyReportedShortTikTokVideo, "video", "live-tiktok-newly-reported-short-link-download");
    try {
      expect((await stat(output.filePath)).size).toBeGreaterThan(0);
    } finally {
      await purgeDownloadedMedia(output.workdir);
    }
  }, 180_000);
});
