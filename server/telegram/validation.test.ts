import { describe, expect, it } from "vitest";
import { extractFacebookOpenGraphImage, extractTwitterOpenGraphImage, imageUrlFromMetadata, imageUrlsFromMetadata, snapchatRequestArgs, tiktokImpersonationArgs, twitterRequestArgs } from "./downloader";
import { welcomeText } from "./messages";
import { PublicLinkError, inspectSupportedUrl, isSafeWebhookSecret, matchesWebhookSecret, normalizeTikTokMediaUrl } from "./validation";

describe("فحص روابط التنزيل العامة", () => {
  it("يتعرف على رابط TikTok العام عبر HTTPS", () => {
    expect(inspectSupportedUrl("https://www.tiktok.com/@sample/video/123").platform).toBe("tiktok");
  });

  it("يطبع رابط TikTok للصورة إلى الصيغة التي يدعمها محرك الاستخراج", () => {
    const result = inspectSupportedUrl("https://www.tiktok.com/@sample/photo/123");
    expect(result.platform).toBe("tiktok");
    expect(result.url.pathname).toBe("/@sample/video/123");
  });

  it("يقبل رابط Twitter/X لمنشور عام ويرفض صفحة الحساب", () => {
    expect(inspectSupportedUrl("https://x.com/sample/status/123456789").platform).toBe("twitter");
    expect(inspectSupportedUrl("https://twitter.com/sample/status/123456789/photo/1").platform).toBe("twitter");
    expect(() => inspectSupportedUrl("https://x.com/sample")).toThrow(PublicLinkError);
  });

  it("يقبل روابط Snapchat العامة ويمنع صفحات الحسابات", () => {
    expect(inspectSupportedUrl("https://www.snapchat.com/spotlight/public-id").platform).toBe("snapchat");
    expect(inspectSupportedUrl("https://snapchat.com/t/AbC12345").platform).toBe("snapchat");
    expect(() => inspectSupportedUrl("https://www.snapchat.com/@creator")).toThrow(PublicLinkError);
  });

  it("يطبع رابط TikTok Photo إلى مسار فيديو مدعوم", () => {
    expect(normalizeTikTokMediaUrl(new URL("https://www.tiktok.com/@creator/photo/7667339458886257940")).pathname).toBe("/@creator/video/7667339458886257940");
    expect(inspectSupportedUrl("https://www.tiktok.com/@creator/photo/7667339458886257940").url.pathname).toBe("/@creator/video/7667339458886257940");
  });

  it("يقبل روابط Pinterest Pin المختصرة والرسمية فقط", () => {
    expect(inspectSupportedUrl("https://pin.it/5CUKh1RZE").platform).toBe("pinterest");
    expect(inspectSupportedUrl("https://www.pinterest.com/pin/123456789/").platform).toBe("pinterest");
    expect(() => inspectSupportedUrl("https://www.pinterest.com/ideas/home-decor/1234/")).toThrow(PublicLinkError);
  });

  it("يرفض رابطاً بلا HTTPS أو من نطاق غير مدعوم", () => {
    expect(() => inspectSupportedUrl("http://instagram.com/p/example")).toThrow(PublicLinkError);
    expect(() => inspectSupportedUrl("https://example.org/media")).toThrow(PublicLinkError);
  });
});

describe("حماية Webhook", () => {
  it("لا يقبل إلا سراً صالحاً ومطابقاً", () => {
    const secret = "SecRet_2026-Webhook";
    expect(isSafeWebhookSecret(secret)).toBe(true);
    expect(isSafeWebhookSecret("secret with spaces")).toBe(false);
    expect(matchesWebhookSecret(secret, secret)).toBe(true);
    expect(matchesWebhookSecret(secret, "different-secret")).toBe(false);
  });
});

describe("رسالة الترحيب العربية", () => {
  it("تُخصص الاسم وتهرب علامات HTML", () => {
    const text = welcomeText("<مستخدم>");
    expect(text).toContain("&lt;مستخدم&gt;");
    expect(text).toContain("TikTok");
    expect(text).toContain("فيديو");
  });
});

describe("اختيار الصورة الأصلية", () => {
  it("يفضل رابط الوسيط الأصلي على رابط المعاينة", () => {
    const url = imageUrlFromMetadata({
      url: "https://cdn.example.org/original.png",
      ext: "png",
      thumbnail: "https://cdn.example.org/thumbnail.jpg",
    });
    expect(url).toBe("https://cdn.example.org/original.png");
  });

  it("يجمع صوراً أصلية متعددة من بيانات دوارة ويزيل التكرار", () => {
    const urls = imageUrlsFromMetadata({
      carousel_media: [
        { image_url: "https://cdn.example.org/first.jpg", width: 900, mime_type: "image/jpeg" },
        { original_url: "https://cdn.example.org/second.webp", width: 1600, ext: "webp" },
        { image_url: "https://cdn.example.org/first.jpg", width: 900, mime_type: "image/jpeg" },
      ],
      thumbnails: [{ url: "https://cdn.example.org/fallback.jpg", width: 200, ext: "jpg" }],
    });
    expect(urls).toEqual(["https://cdn.example.org/second.webp", "https://cdn.example.org/first.jpg", "https://cdn.example.org/fallback.jpg"]);
  });

  it("يستخرج صورة X العامة من Open Graph ويرفض صفحة المحتوى الحساس", () => {
    expect(extractTwitterOpenGraphImage('<meta property="og:image" content="https://pbs.twimg.com/media/example.jpg">')).toBe("https://pbs.twimg.com/media/example.jpg");
    expect(extractTwitterOpenGraphImage("<div>Sensitive Content This post is only available in the X app</div>")).toBeUndefined();
    expect(extractTwitterOpenGraphImage('<meta property="og:image" content="https://example.com/private.jpg">')).toBeUndefined();
  });

  it("يقبل Open Graph لصورة Facebook العامة ويرفض صفحة تسجيل الدخول", () => {
    const publicHtml = '<meta property="og:image" content="https://scontent.famm1-1.fna.fbcdn.net/v/t39.30808-6/photo.jpg?x=1&amp;y=2">';
    expect(extractFacebookOpenGraphImage(publicHtml)).toBe("https://scontent.famm1-1.fna.fbcdn.net/v/t39.30808-6/photo.jpg?x=1&y=2");
    expect(extractFacebookOpenGraphImage('<form name="login"><meta property="og:image" content="https://scontent.xx.fbcdn.net/photo.jpg">')).toBeUndefined();
  });
});

describe("دعم TikTok وTwitter/X", () => {
  it("يضيف انتحال المتصفح لمسار TikTok فقط", () => {
    expect(tiktokImpersonationArgs("tiktok")).toEqual(["--impersonate", "Chrome-136"]);
    expect(tiktokImpersonationArgs("instagram")).toEqual([]);
  });

  it("يضيف انتحال المتصفح لمسار Twitter/X فقط", () => {
    expect(twitterRequestArgs("twitter")).toEqual(["--impersonate", "Chrome-136"]);
    expect(twitterRequestArgs("facebook")).toEqual([]);
  });

  it("يضيف انتحال المتصفح لمسار Snapchat فقط", () => {
    expect(snapchatRequestArgs("snapchat")).toEqual(["--impersonate", "Chrome-136"]);
    expect(snapchatRequestArgs("instagram")).toEqual([]);
  });
});
