import { describe, expect, it } from "vitest";
import { downloadMedia, inspectMediaLink, purgeDownloadedMedia } from "./downloader";

const publicUrl = process.env.TWITTER_PUBLIC_URL?.trim();

describe("تنزيل Twitter/X العام", () => {
  it.runIf(Boolean(publicUrl))("يفحص المنشور العام وينزّل الفيديو أو الصوت ثم يحذف الملف المؤقت", async () => {
    const inspection = await inspectMediaLink(publicUrl!, "live-twitter-inspection");
    expect(inspection.platform).toBe("twitter");
    expect(inspection.choices.some(choice => choice === "video" || choice === "audio" || choice === "image")).toBe(true);

    const choice = inspection.choices.includes("video") ? "video" : inspection.choices.includes("image") ? "image" : "audio";
    const output = await downloadMedia(publicUrl!, choice, "live-twitter-download");
    try {
      expect(output.bytes).toBeGreaterThan(0);
    } finally {
      await purgeDownloadedMedia(output.workdir);
    }
  }, 180_000);
});
