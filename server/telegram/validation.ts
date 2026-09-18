import { timingSafeEqual } from "node:crypto";
import type { SupportedPlatform } from "./types";

const PLATFORM_HOSTS: Record<SupportedPlatform, string[]> = {
  tiktok: ["tiktok.com"],
  instagram: ["instagram.com"],
  facebook: ["facebook.com", "fb.watch"],
  snapchat: ["snapchat.com"],
  pinterest: ["pinterest.com", "pin.it"],
  twitter: ["twitter.com", "x.com"],
};

export class PublicLinkError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PublicLinkError";
  }
}

function belongsToHost(hostname: string, host: string) {
  return hostname === host || hostname.endsWith(`.${host}`);
}

export function normalizeTikTokMediaUrl(input: URL) {
  const url = new URL(input.toString());
  if (/^(?:www\.)?(?:tiktok\.com|vt\.tiktok\.com|vm\.tiktok\.com)$/i.test(url.hostname) && /^\/(@[^/]+\/)?photo\/\d+\/?$/i.test(url.pathname)) {
    url.pathname = url.pathname.replace(/\/photo\//i, "/video/");
  }
  return url;
}

export function inspectSupportedUrl(rawUrl: string): { url: URL; platform: SupportedPlatform } {
  let url: URL;
  try {
    url = new URL(rawUrl.trim());
  } catch {
    throw new PublicLinkError("أرسل رابطاً صحيحاً يبدأ بـ https:// من منصة مدعومة.");
  }

  if (url.protocol !== "https:") {
    throw new PublicLinkError("يُقبل فقط رابط HTTPS عام من منصة مدعومة.");
  }

  const hostname = url.hostname.toLowerCase().replace(/^www\./, "");
  for (const [platform, hosts] of Object.entries(PLATFORM_HOSTS) as Array<[SupportedPlatform, string[]]>) {
    if (hosts.some(host => belongsToHost(hostname, host))) {
      if (platform === "pinterest") {
        const isShortPin = hostname === "pin.it" && url.pathname.length > 1;
        const isPinterestPin = hostname !== "pin.it" && /^\/pin\/[^/]+\/?$/i.test(url.pathname);
        if (!isShortPin && !isPinterestPin) {
          throw new PublicLinkError("يدعم Pinterest روابط Pin العامة فقط، مثل https://pin.it/... أو https://www.pinterest.com/pin/...");
        }
      }
      if (platform === "twitter") {
        const isStatus = /^\/[^/]+\/status\/\d+(?:\/photo\/\d+)?\/?$/i.test(url.pathname);
        const isShortStatus = /^\/i\/web\/status\/\d+\/?$/i.test(url.pathname);
        if (!isStatus && !isShortStatus) {
          throw new PublicLinkError("يدعم Twitter/X روابط المنشورات العامة فقط، مثل https://x.com/user/status/123. أرسل رابط المنشور وليس صفحة الحساب.");
        }
      }
      if (platform === "snapchat") {
        const isSharedSnap = /^\/t\/[A-Za-z0-9_-]{4,80}\/?$/i.test(url.pathname);
        const isSpotlightOrStory = /^\/(?:@[^/]+\/)?(?:spotlight|highlight)\/[^/]+\/?$/i.test(url.pathname);
        if (!isSharedSnap && !isSpotlightOrStory) {
          throw new PublicLinkError("يدعم Snapchat روابط Spotlight وStory العامة أو رابط المشاركة /t/ فقط. لا يمكن تنزيل الحسابات أو القصص الخاصة.");
        }
      }
      if (platform === "tiktok") url = normalizeTikTokMediaUrl(url);
      return { url, platform };
    }
  }

  throw new PublicLinkError("هذا الرابط غير مدعوم. أرسل رابطاً عاماً من TikTok أو Instagram أو Facebook أو Snapchat أو Pinterest أو Twitter/X.");
}

export function isSafeWebhookSecret(value: string | undefined): value is string {
  return Boolean(value && /^[A-Za-z0-9_-]{1,256}$/.test(value));
}

export function matchesWebhookSecret(expected: string | undefined, supplied: string | undefined) {
  if (!isSafeWebhookSecret(expected) || typeof supplied !== "string") return false;
  const expectedValue = Buffer.from(expected);
  const suppliedValue = Buffer.from(supplied);
  return expectedValue.length === suppliedValue.length && timingSafeEqual(expectedValue, suppliedValue);
}
