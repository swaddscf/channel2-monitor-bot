import { spawn } from "node:child_process";
import path from "node:path";
import type { TikTokAccount } from "./types";

const PROFILE_CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const profileCache = new Map<string, { at: number; account: TikTokAccount | undefined }>();
let pythonAvailable: Promise<boolean> | undefined;

export const TIKTOK_COUNTRY_NAMES: Record<string, string> = {
  AF: "أفغانستان", AQ: "أنتاركتيكا", AZ: "أذربيجان", AL: "ألبانيا", AM: "أرمينيا",
  AS: "ساموا الأمريكية", AU: "أستراليا", AT: "النمسا", AR: "الأرجنتين", AE: "الإمارات",
  IQ: "العراق", IR: "إيران", IT: "إيطاليا", EG: "مصر", DZ: "الجزائر", MA: "المغرب",
  SA: "السعودية", KW: "الكويت", QA: "قطر", BH: "البحرين", OM: "عُمان", JO: "الأردن",
  LB: "لبنان", SY: "سوريا", YE: "اليمن", LY: "ليبيا", TN: "تونس", SD: "السودان",
  US: "الولايات المتحدة", GB: "المملكة المتحدة", DE: "ألمانيا", FR: "فرنسا",
  ES: "إسبانيا", PT: "البرتغال", RU: "روسيا", TR: "تركيا", IN: "الهند", PK: "باكستان",
  BD: "بنغلاديش", ID: "إندونيسيا", MY: "ماليزيا", SG: "سنغافورة", TH: "تايلاند",
  VN: "فيتنام", PH: "الفلبين", JP: "اليابان", KR: "كوريا الجنوبية", CN: "الصين",
  CA: "كندا", MX: "المكسيك", BR: "البرازيل", ARG: "الأرجنتين", CL: "تشيلي", CO: "كولومبيا",
  PE: "بيرو", VE: "فنزويلا", UA: "أوكرانيا", PL: "بولندا", NL: "هولندا", BE: "بلجيكا",
  CH: "سويسرا", SE: "السويد", NO: "النرويج", DK: "الدنمارك", FI: "فنلندا", GR: "اليونان",
  RO: "رومانيا", BG: "بلغاريا", HU: "المجر", CZ: "التشيك", SK: "سلوفاكيا", HR: "كرواتيا",
  RS: "صربيا", GE: "جورجيا", NG: "نيجيريا", ZA: "جنوب أفريقيا", ET: "إثيوبيا",
  GH: "غانا", KE: "كينيا", UG: "أوغندا", TZ: "تنزانيا", CU: "كوبا", PR: "بورتوريكو",
  NZ: "نيوزيلندا", IE: "أيرلندا", IS: "آيسلندا", IL: "إسرائيل", PS: "فلسطين",
};

export function countryLabel(code?: string) {
  if (!code) return undefined;
  const normalized = String(code).trim().toUpperCase();
  return TIKTOK_COUNTRY_NAMES[normalized] || normalized;
}

export function formatCount(value?: number) {
  if (value === undefined || value === null || Number.isNaN(value) || !Number.isFinite(value)) return undefined;
  const safe = Math.max(0, Math.floor(value));
  if (safe >= 1_000_000) {
    const compact = (safe / 1_000_000).toFixed(safe >= 100_000_000 ? 0 : 1).replace(/\.0$/, "");
    return `${compact} مليون`;
  }
  if (safe >= 1_000) return `${(safe / 1_000).toFixed(safe >= 100_000 ? 0 : 1).replace(/\.0$/, "")} ألف`;
  return String(safe);
}

function pickString(value: unknown, ...keys: string[]) {
  for (const key of keys) {
    const candidate = typeof value === "object" && value !== null ? (value as Record<string, unknown>)[key] : undefined;
    if (typeof candidate === "string" && candidate.trim()) return candidate.trim();
  }
  return undefined;
}

function pickNumber(value: unknown, ...keys: string[]) {
  for (const key of keys) {
    const candidate = typeof value === "object" && value !== null ? (value as Record<string, unknown>)[key] : undefined;
    if (typeof candidate === "number" && Number.isFinite(candidate)) return Math.floor(candidate);
    if (typeof candidate === "string" && /^\d[\d,]*$/.test(candidate.replace(/,/g, ""))) {
      const parsed = Number(candidate.replace(/,/g, ""));
      if (Number.isFinite(parsed)) return parsed;
    }
  }
  return undefined;
}

function pickBoolean(value: unknown, ...keys: string[]) {
  for (const key of keys) {
    const candidate = typeof value === "object" && value !== null ? (value as Record<string, unknown>)[key] : undefined;
    if (typeof candidate === "boolean") return candidate;
  }
  return undefined;
}

export function parseTikTokUniversal(data: unknown): TikTokAccount | undefined {
  const scope = (typeof data === "object" && data !== null && (data as Record<string, unknown>).__DEFAULT_SCOPE__
    ? (data as Record<string, unknown>).__DEFAULT_SCOPE__
    : data
  ) as Record<string, unknown> | undefined;
  if (!scope || typeof scope !== "object") return undefined;
  const userDetail = scope["webapp.user-detail"] as Record<string, unknown> | undefined;
  const userInfo = (userDetail?.userInfo ?? undefined) as Record<string, unknown> | undefined;
  const user = (userInfo?.user ?? undefined) as Record<string, unknown> | undefined;
  const stats = (userInfo?.stats ?? undefined) as Record<string, unknown> | undefined;

  const videoDetail = scope["webapp.video-detail"] as Record<string, unknown> | undefined;
  const itemInfo = (videoDetail?.itemInfo ?? undefined) as Record<string, unknown> | undefined;
  const item = (itemInfo?.itemStruct ?? undefined) as Record<string, unknown> | undefined;
  const author = (item?.author ?? undefined) as Record<string, unknown> | undefined;
  const itemStats = (item?.stats ?? undefined) as Record<string, unknown> | undefined;

  const source = user ?? author ?? undefined;
  const counters = stats ?? itemStats ?? undefined;
  if (!source && !counters) return undefined;

  const usernameValue = pickString(source, "uniqueId", "unique_id", "author");
  const username = usernameValue ? usernameValue.replace(/^@/, "") : undefined;
  const nickname = pickString(source, "nickname", "channel", "uploader");
  const followers = pickNumber(source, "followerCount", "followers", "fanCount")
    ?? pickNumber(counters, "followerCount", "followers", "fanCount");
  const following = pickNumber(source, "followingCount", "following", "following_count")
    ?? pickNumber(counters, "followingCount", "following", "following_count");
  const posts = pickNumber(source, "videoCount", "video_count", "video_count_show", "awemeCount")
    ?? pickNumber(counters, "videoCount", "video_count", "video_count_show", "awemeCount");
  const hearts = pickNumber(source, "heartCount", "heart", "heart_count", "diggCount")
    ?? pickNumber(counters, "heartCount", "heart", "heart_count", "diggCount");

  return {
    nickname,
    username,
    followers,
    following,
    posts,
    hearts,
    region: pickString(source, "region", "country_code", "country"),
    verified: pickBoolean(source, "verified", "isVerified"),
    signature: pickString(source, "signature", "desc"),
    avatarUrl: pickString(source, "avatarLarger", "avatarMedium", "avatar", "avatarThumb"),
    profileUrl: username ? `https://www.tiktok.com/@${username}` : undefined,
  };
}

export function parseSigiState(data: unknown): TikTokAccount | undefined {
  const root = (typeof data === "object" && data !== null ? data : undefined) as Record<string, unknown> | undefined;
  const userModule = root?.UserModule as Record<string, unknown> | undefined;
  if (!userModule) return undefined;
  const users = (userModule.users ?? undefined) as Record<string, unknown> | undefined;
  const firstUser = users ? Object.values(users)[0] as Record<string, unknown> | undefined : undefined;
  if (!firstUser) return undefined;
  const statsMap = (userModule.stats ?? undefined) as Record<string, unknown> | undefined;
  const username = pickString(firstUser, "uniqueId", "unique_id")?.replace(/^@/, "") || undefined;
  const profileStats = (username && statsMap ? statsMap[username] : undefined) as Record<string, unknown> | undefined;
  return {
    nickname: pickString(firstUser, "nickname", "nick", "name"),
    username,
    followers: pickNumber(firstUser, "fanCount", "followerCount") ?? pickNumber(profileStats, "followerCount", "followers"),
    following: pickNumber(firstUser, "followingCount") ?? pickNumber(profileStats, "followingCount", "following"),
    posts: pickNumber(firstUser, "videoCount", "awemeCount") ?? pickNumber(profileStats, "videoCount", "videos"),
    hearts: pickNumber(firstUser, "heart", "diggCount") ?? pickNumber(profileStats, "heartCount", "diggCount", "likes"),
    region: pickString(firstUser, "region"),
    verified: pickBoolean(firstUser, "verified"),
    signature: pickString(firstUser, "signature", "desc"),
    avatarUrl: pickString(firstUser, "avatarLarger", "avatarMedium", "avatarThumb"),
    profileUrl: username ? `https://www.tiktok.com/@${username}` : undefined,
  };
}

export function extractTikTokProfile(html: string): TikTokAccount | undefined {
  if (!html) return undefined;
  const scriptPattern = /<script[^>]*\bid=["']__UNIVERSAL_DATA_FOR_REHYDRATION__["'][^>]*>([\s\S]*?)<\/script>/i;
  const universalMatch = scriptPattern.exec(html);
  if (universalMatch) {
    const raw = universalMatch[1].trim();
    try {
      if (raw) return parseTikTokUniversal(JSON.parse(raw));
    } catch { /* continue to next source */ }
  }
  if (html.length < 2_000) return undefined;
  const sigiPattern = /<script[^>]*\bid=["']SIGI_STATE["'][^>]*>([\s\S]*?)<\/script>/i;
  const sigiMatch = sigiPattern.exec(html);
  if (sigiMatch) {
    try {
      const parsed = parseSigiState(JSON.parse(sigiMatch[1].trim()));
      if (parsed) return parsed;
    } catch { /* continue to next source */ }
  }
  const statsMatch = html.match(/"stats"\s*:\s*\{\s*"followerCount"\s*:\s*(\d[\d,]*)["\s,}]/i);
  const userMatch = html.match(/"nickname"\s*:\s*"([^"\\]*(?:\\.[^"\\]*)*)"[^}]*?"uniqueId"\s*:\s*"([^"\\]+)"/i);
  if (statsMatch || userMatch) {
    const followers = statsMatch ? Number(statsMatch[1].replace(/,/g, "")) : undefined;
    const regionMatch = html.match(/"region"\s*:\s*"([A-Za-z]{2})"/i);
    const nickMatch = html.match(/"nickname"\s*:\s*"((?:[^"\\]|\\.)*)"/i);
    const uniqueMatch = html.match(/"uniqueId"\s*:\s*"([^"\\]+)"/i);
    const verifiedMatch = html.match(/"verified"\s*:\s*true/i);
    const account: TikTokAccount = {
      nickname: nickMatch ? nickMatch[1].replace(/\\"/g, '"') : undefined,
      username: (uniqueMatch?.[1] || "").replace(/^@/, "") || undefined,
      followers,
      region: regionMatch?.[1],
      verified: Boolean(verifiedMatch),
      profileUrl: uniqueMatch ? `https://www.tiktok.com/@${uniqueMatch[1].replace(/^@/, "")}` : undefined,
    };
    if (account.nickname || account.username || account.followers !== undefined || account.region) return account;
  }
  return undefined;
}

function runWithTimeout(command: string, args: string[], timeoutMs: number) {
  return new Promise<{ code: number | null; stdout: string; stderr: string }>(resolve => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
    }, timeoutMs);
    child.stdout.on("data", chunk => { stdout += String(chunk); });
    child.stderr.on("data", chunk => { stderr += String(chunk); });
    child.on("error", () => {
      clearTimeout(timer);
      resolve({ code: -1, stdout, stderr });
    });
    child.on("close", code => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr });
    });
  });
}

function isPythonAvailable() {
  if (!pythonAvailable) {
    pythonAvailable = runWithTimeout("python3", ["-c", "import sys"], 4_000).then(result => result.code === 0);
  }
  return pythonAvailable;
}

async function fetchViaPython(url: string): Promise<string | undefined> {
  if (!(await isPythonAvailable())) return undefined;
  const scriptPath = path.resolve(process.cwd(), "scripts", "tiktok_profile.py");
  const result = await runWithTimeout("python3", [scriptPath, url], 15_000);
  if (result.code !== 0 || !result.stdout) return undefined;
  const trimmed = result.stdout.trim();
  if (!trimmed || trimmed === "{}" || trimmed === "NO_DATA") return undefined;
  return trimmed;
}

async function fetchViaNode(url: string): Promise<string | undefined> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12_000);
  try {
    const response = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
        "Referer": "https://www.tiktok.com/",
      },
      redirect: "follow",
      signal: controller.signal,
    });
    if (!response.ok) return undefined;
    return await response.text();
  } catch {
    return undefined;
  } finally {
    clearTimeout(timer);
  }
}

export async function fetchTikTokAuthorBasics(url: string): Promise<TikTokAccount | undefined> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 9_000);
  try {
    const response = await fetch(`https://www.tikwm.com/api/?url=${encodeURIComponent(url)}&hd=0`, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; TelegramMediaDownloader/1.0)" },
      signal: controller.signal,
    });
    if (!response.ok) return undefined;
    const payload = (await response.json().catch(() => null)) as { data?: Record<string, unknown>; msg?: string } | null;
    const data = payload?.data;
    if (!data) return undefined;
    const author = (data.author ?? undefined) as Record<string, unknown> | undefined;
    if (!author) {
      const region = typeof data.region === "string" ? data.region : undefined;
      const title = typeof data.title === "string" ? data.title : undefined;
      if (region || title) return { region, signature: title };
      return undefined;
    }
    const usernameValue = pickString(author, "unique_id", "uniqueId", "author");
    const username = usernameValue ? usernameValue.replace(/^@/, "") : undefined;
    return {
      nickname: pickString(author, "nickname", "name"),
      username,
      region: typeof data.region === "string" ? data.region : undefined,
      avatarUrl: pickString(author, "avatar"),
      profileUrl: username ? `https://www.tiktok.com/@${username}` : undefined,
    };
  } catch {
    return undefined;
  } finally {
    clearTimeout(timer);
  }
}

export function tiktokUsernameFromUrl(rawUrl: string) {
  try {
    const match = new URL(rawUrl).pathname.match(/^\/@([A-Za-z0-9_.-]+)/);
    return match ? match[1] : undefined;
  } catch {
    return undefined;
  }
}

export function mergeAccounts(...sources: Array<TikTokAccount | undefined>) {
  const merged: TikTokAccount = {};
  for (const source of sources) {
    if (!source) continue;
    if (merged.nickname === undefined && source.nickname) merged.nickname = source.nickname;
    if (merged.username === undefined && source.username) merged.username = source.username;
    if (merged.followers === undefined && source.followers !== undefined) merged.followers = source.followers;
    if (merged.following === undefined && source.following !== undefined) merged.following = source.following;
    if (merged.posts === undefined && source.posts !== undefined) merged.posts = source.posts;
    if (merged.hearts === undefined && source.hearts !== undefined) merged.hearts = source.hearts;
    if (merged.region === undefined && source.region) merged.region = source.region;
    if (merged.verified === undefined && source.verified !== undefined) merged.verified = source.verified;
    if (merged.signature === undefined && source.signature) merged.signature = source.signature;
    if (merged.avatarUrl === undefined && source.avatarUrl) merged.avatarUrl = source.avatarUrl;
    if (merged.profileUrl === undefined && source.profileUrl) merged.profileUrl = source.profileUrl;
  }
  return Object.keys(merged).length ? merged : undefined;
}

export async function loadTikTokAccount(
  rawUrl: string,
  fallback?: { nickname?: string; username?: string; region?: string },
): Promise<TikTokAccount | undefined> {
  const usernameFromUrl = tiktokUsernameFromUrl(rawUrl);
  const username = usernameFromUrl || fallback?.username;
  const cacheKey = username || rawUrl;
  const cached = profileCache.get(cacheKey);
  if (cached && Date.now() - cached.at < PROFILE_CACHE_TTL_MS) return cached.account;

  let account: TikTokAccount | undefined;
  if (username) {
    const profileUrl = `https://www.tiktok.com/@${encodeURIComponent(username)}`;
    const rawScope = await fetchViaPython(profileUrl);
    if (rawScope) {
      try {
        account = parseTikTokUniversal(JSON.parse(rawScope));
      } catch { account = undefined; }
    }
    if (!account) {
      const html = await fetchViaNode(profileUrl);
      account = html ? extractTikTokProfile(html) : undefined;
    }
  }
  if (!account || !account.region || !account.nickname) {
    const basics = await fetchTikTokAuthorBasics(rawUrl);
    account = mergeAccounts(account, basics);
  }
  const merged = mergeAccounts(
    account,
    fallback?.nickname ? { nickname: fallback.nickname } : undefined,
    fallback?.username ? { username: fallback.username, profileUrl: `https://www.tiktok.com/@${fallback.username.replace(/^@/, "")}` } : undefined,
    fallback?.region ? { region: fallback.region } : undefined,
  );
  profileCache.set(cacheKey, { at: Date.now(), account: merged });
  return merged;
}