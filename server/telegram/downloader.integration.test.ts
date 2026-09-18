import { stat } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { downloadMedia, inspectMediaLink, purgeDownloadedMedia } from "./downloader";

const runLive = process.env.RUN_LIVE_DOWNLOAD_TESTS === "1";
const userProvidedPublicPin = "https://pin.it/5CUKh1RZE";

describe("تنزيل صورة عامة من Pinterest", () => {
  it.runIf(runLive)("يفحص رابط Pin عاماً ثم ينزّل الصورة المؤقتة ويحذفها", async () => {
    const inspection = await inspectMediaLink(userProvidedPublicPin, "live-pin-inspection");
    expect(inspection.platform).toBe("pinterest");
    expect(inspection.choices).toContain("image");
    expect(inspection.choices).not.toContain("video");
    expect(inspection.choices).not.toContain("audio");

    const output = await downloadMedia(userProvidedPublicPin, "image", "live-pin-download");
    try {
      expect((await stat(output.filePath)).size).toBeGreaterThan(0);
    } finally {
      await purgeDownloadedMedia(output.workdir);
    }
  }, 100_000);
});
