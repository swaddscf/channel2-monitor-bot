import { spawn } from "node:child_process";
import { mkdtemp, readdir, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { detectStoryLink, inspectSupportedUrl, normalizeTikTokMediaUrl } from "./validation";
import { loadTikTokAccount, mergeAccounts } from "./tiktokProfile";
import type { InspectResult, MediaChoice } from "./types";

const INSPECT_TIMEOUT_MS = 70_000;
const DOWNLOAD_TIMEOUT_MS = 150_000;
const MAX_MEDIA_BYTES = 45 * 1024 * 1024;
const activeProcesses = new Map<string, ReturnType<typeof spawn>>();
const cancelledJobs = new Set<string>();
const imageExtensions = ["jpg", "jpeg", "png", "webp", "gif", "avif"];
type ImageCandidate = { url: string; width: number; original: boolean };
const TIKTOK_IMPERSONATION_ARGS = ["--impersonate", "Chrome-136"];
const TWITTER_REQUEST_ARGS = ["--impersonate", "Chrome-136"];
const SNAPCHAT_REQUEST_ARGS = ["--impersonate", "Chrome-136"];

export class DownloaderError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DownloaderError";
  }
}

export function tiktokImpersonationArgs(platform: string) {
  return platform === "tiktok" ? [...TIKTOK_IMPERSONATION_ARGS] : [];
}

export function twitterRequestArgs(platform: string) {
  return platform === "twitter" ? [...TWITTER_REQUEST_ARGS] : [];
}

export function snapchatRequestArgs(platform: string) {
  return platform === "snapchat" ? [...SNAPCHAT_REQUEST_ARGS] : [];
}

function isTikTokRetryablePageError(message: string) {
  return /\[TikTok\].*Unexpected response from webpage request|Unexpected response from webpage request/i.test(message);
}

function runYtDlp(args: string[], timeoutMs: number, jobId?: string) {
  return new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
    const child = spawn("yt-dlp", args, { stdio: ["ignore", "pipe", "pipe"] });
    if (jobId) activeProcesses.set(jobId, child);
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new DownloaderError("انتهت مهلة معالجة الرابط. حاول مرة أخرى لاحقاً."));
    }, timeoutMs);
    child.stdout.on("data", chunk => { stdout += String(chunk); });
    child.stderr.on("data", chunk => { stderr += String(chunk); });
    child.on("error", error => {
      clearTimeout(timer);
      if (jobId) activeProcesses.delete(jobId);
      reject(new DownloaderError(`تعذر تشغيل محرك التنزيل: ${error.message}`));
    });
    child.on("close", code => {
      clearTimeout(timer);
      if (jobId) activeProcesses.delete(jobId);
      if (jobId && cancelledJobs.delete(jobId)) return reject(new DownloaderError("تم إلغاء العملية بنجاح."));
      if (code === 0) return resolve({ stdout, stderr });
      const compact = stderr.split("\n").filter(Boolean).slice(-1)[0] || "رابط غير متاح أو غير عام.";
      const normalized = compact.toLowerCase();
      if (/(private|login|sign in|cookies|not available|members only|age-restricted)/.test(normalized)) {
        return reject(new DownloaderError("لا يمكن الوصول إلى هذا المحتوى لأنه خاص أو محمي أو يتطلب تسجيل دخول. أرسل رابطاً عاماً فقط."));
      }
      reject(new DownloaderError(compact.slice(0, 350)));
    });
  });
}

async function runYtDlpWithRetry(args: string[], timeoutMs: number, jobId?: string) {
  let lastError: unknown;
  for (const delay of [0, 800, 1_600]) {
    if (delay) await new Promise(resolve => setTimeout(resolve, delay));
    try {
      return await runYtDlp(args, timeoutMs, jobId);
    } catch (error) {
      if (error instanceof DownloaderError && (/تم إلغاء العملية|خاص أو محمي|تسجيل دخول/.test(error.message))) throw error;
      lastError = error;
    }
  }
  throw lastError;
}

export function abortYtDlp(jobId: string) {
  const child = activeProcesses.get(jobId);
  if (!child) return false;
  cancelledJobs.add(jobId);
  child.kill("SIGTERM");
  const forcedKillTimer = setTimeout(() => child.kill("SIGKILL"), 3_000);
  forcedKillTimer.unref();
  return true;
}

function cleanTitle(value: unknown) {
  const title = typeof value === "string" ? value.trim() : "محتوى عام";
  return title.slice(0, 120) || "محتوى عام";
}

function isImageRecord(item: Record<string, unknown>) {
  const ext = String(item.ext || "").toLowerCase();
  const mime = String(item.mime_type || item.mime || "").toLowerCase();
  const url = String(item.url || item.image_url || item.display_url || item.original_url || "").toLowerCase();
  return imageExtensions.includes(ext) || mime.startsWith("image/") || /\.(jpe?g|png|webp|gif|avif)(?:$|[?&])/i.test(url);
}

function candidateFrom(item: Record<string, unknown>, original: boolean): ImageCandidate[] {
  const width = typeof item.width === "number" ? item.width : 0;
  const preferredKeys = ["original_url", "image_url", "display_url", "url"];
  return preferredKeys
    .map(key => typeof item[key] === "string" ? item[key] : "")
    .filter((url): url is string => typeof url === "string" && url.startsWith("https://"))
    .map(url => ({ url, width, original }));
}

export function imageUrlsFromMetadata(metadata: Record<string, unknown>) {
  const originals: ImageCandidate[] = [];
  const thumbnails: ImageCandidate[] = [];
  const collect = (item: Record<string, unknown>, fromThumbnail = false) => {
    const vcodec = String(item.vcodec || "");
    if (isImageRecord(item) && (!vcodec || vcodec === "none")) {
      (fromThumbnail ? thumbnails : originals).push(...candidateFrom(item, !fromThumbnail));
    }
    const formats = Array.isArray(item.formats) ? item.formats : [];
    formats.forEach(format => {
      if (format && typeof format === "object") collect(format as Record<string, unknown>, false);
    });
    const nestedKeys = ["entries", "images", "carousel_media", "carouselMedia", "media"];
    nestedKeys.forEach(key => {
      const items = Array.isArray(item[key]) ? item[key] : [];
      items.forEach(entry => { if (entry && typeof entry === "object") collect(entry as Record<string, unknown>, false); });
    });
    const itemThumbnails = Array.isArray(item.thumbnails) ? item.thumbnails : [];
    itemThumbnails.forEach(thumbnail => { if (thumbnail && typeof thumbnail === "object") collect(thumbnail as Record<string, unknown>, true); });
  };
  collect(metadata);
  const ordered = [...originals, ...thumbnails].sort((a, b) => Number(b.original) - Number(a.original) || b.width - a.width);
  return Array.from(new Map(ordered.map(candidate => [candidate.url, candidate])).values()).map(candidate => candidate.url);
}

export function imageUrlFromMetadata(metadata: Record<string, unknown>) {
  return imageUrlsFromMetadata(metadata)[0];
}

function decodeHtmlAttribute(value: string) {
  return value.replace(/&amp;/g, "&").replace(/&#x2F;/gi, "/").replace(/&quot;/g, '"');
}

export function extractFacebookOpenGraphImage(html: string) {
  if (/facebook\.com\/login|name=["']login["']/i.test(html)) return undefined;
  const patterns = [
    /<meta[^>]+property=["']og:image(?::secure_url)?["'][^>]+content=["']([^"']+)["'][^>]*>/i,
    /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image(?::secure_url)?["'][^>]*>/i,
  ];
  const raw = patterns.map(pattern => html.match(pattern)?.[1]).find(Boolean);
  const imageUrl = raw ? decodeHtmlAttribute(raw) : "";
  return /^https:\/\/scontent[^/]*\.fbcdn\.net\//i.test(imageUrl) ? imageUrl : undefined;
}

async function loadPublicFacebookOpenGraphImage(url: URL) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12_000);
  try {
    const response = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; TelegramMediaDownloader/1.0)" },
      redirect: "follow",
      signal: controller.signal,
    });
    if (!response.ok || /\/login\/?/i.test(response.url)) return undefined;
    return extractFacebookOpenGraphImage(await response.text());
  } catch {
    return undefined;
  } finally {
    clearTimeout(timeout);
  }
}

export function extractTwitterOpenGraphImage(html: string) {
  if (/sensitive content|only available in the x app|log in|sign up/i.test(html)) return undefined;
  const patterns = [
    /<meta[^>]+(?:property|name)=["'](?:og:image|twitter:image)(?::secure_url)?["'][^>]+content=["']([^"']+)["'][^>]*>/i,
    /<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["'](?:og:image|twitter:image)(?::secure_url)?["'][^>]*>/i,
  ];
  const raw = patterns.map(pattern => html.match(pattern)?.[1]).find(Boolean);
  const imageUrl = raw ? decodeHtmlAttribute(raw) : "";
  return /^https:\/\/pbs\.twimg\.com\//i.test(imageUrl) ? imageUrl : undefined;
}

async function loadPublicTwitterOpenGraphImage(url: URL) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12_000);
  try {
    const response = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; TelegramMediaDownloader/1.0)" },
      redirect: "follow",
      signal: controller.signal,
    });
    if (!response.ok || /\/i\/(?:jf\/)?(?:onboarding|login)/i.test(response.url)) return undefined;
    return extractTwitterOpenGraphImage(await response.text());
  } catch {
    return undefined;
  } finally {
    clearTimeout(timeout);
  }
}

async function resolveTikTokPublicUrl(url: URL) {
  let current = new URL(url.toString());
  for (let attempt = 0; attempt < 3; attempt += 1) {
    current = normalizeTikTokMediaUrl(current);
    if (!/^(?:www\.)?(?:vt\.|vm\.)?tiktok\.com$/i.test(current.hostname)) return current;
    if (!/^\/(?:@[^/]+\/)?(?:photo|video)\/\d+\/?$/i.test(current.pathname) && !/\/(?:photo|video)\/\d+\/?$/i.test(current.pathname)) {
      try {
        const response = await fetch(current, {
          method: "GET",
          headers: { "User-Agent": "Mozilla/5.0 (compatible; TelegramMediaDownloader/1.0)" },
          redirect: "manual",
          signal: AbortSignal.timeout(10_000),
        });
        const location = response.headers.get("location");
        if (!location) return current;
        current = new URL(location, current);
        continue;
      } catch {
        return current;
      }
    }
    return normalizeTikTokMediaUrl(current);
  }
  return normalizeTikTokMediaUrl(current);
}

async function loadMetadata(rawUrl: string, jobId?: string) {
  let { url, platform } = inspectSupportedUrl(rawUrl);
  if (platform === "tiktok") url = await resolveTikTokPublicUrl(url);
  let stdout: string;
  try {
    ({ stdout } = await runYtDlpWithRetry([
      ...tiktokImpersonationArgs(platform), ...twitterRequestArgs(platform), ...snapchatRequestArgs(platform), "--dump-single-json", "--no-playlist", "--skip-download", "--ignore-no-formats-error", url.toString(),
    ], INSPECT_TIMEOUT_MS, jobId));
  } catch (error) {
    if (platform === "facebook") {
      const imageUrl = await loadPublicFacebookOpenGraphImage(url);
      if (imageUrl) return { title: "صورة Facebook عامة", image_url: imageUrl, mime_type: "image/jpeg" };
      throw new DownloaderError("لم يمنح Facebook الخادم وصولاً عاماً لهذه الصورة؛ أعاد المصدر طلب تسجيل الدخول أو حماية المنصة. أرسل رابط منشور عام من صفحة عامة أو رابط صورة قابل للمشاركة.");
    }
    if (platform === "tiktok" && error instanceof DownloaderError && isTikTokRetryablePageError(error.message)) {
      throw new DownloaderError("تعذر الوصول إلى صفحة TikTok مؤقتاً بسبب حماية المصدر. أعد إرسال الرابط بعد قليل؛ يحاول البوت تلقائياً متصفحاً متوافقاً وإعادة المحاولة.");
    }
    if (platform === "twitter" && error instanceof DownloaderError) {
      const message = error.message.toLowerCase();
      if (/private|login|sign in|protected|not found|suspended|unavailable/.test(message)) {
        throw new DownloaderError("لا يمكن تنزيل هذا المنشور من Twitter/X لأنه خاص أو محذوف أو يتطلب تسجيل الدخول. أرسل رابط منشور عام متاح للجميع.");
      }
      throw new DownloaderError("تعذر الوصول إلى منشور Twitter/X حالياً. قد تكون المنصة حجبت طلبات الخادم مؤقتاً؛ جرّب الرابط العام مرة أخرى لاحقاً.");
    }
    if (platform === "snapchat" && error instanceof DownloaderError) {
      const message = error.message.toLowerCase();
      if (/private|login|sign in|protected|not found|unavailable|no video formats/.test(message)) {
        throw new DownloaderError("لا يمكن تنزيل هذا Snapchat لأنه خاص أو منتهٍ أو لا يتيح فيديو عاماً. أرسل رابط Spotlight أو Story عام ما زال متاحاً.");
      }
      throw new DownloaderError("تعذر الوصول إلى فيديو Snapchat حالياً. قد تكون المنصة حجبت طلبات الخادم مؤقتاً؛ جرّب رابطاً عاماً آخر لاحقاً.");
    }
    throw error;
  }
  try {
    return JSON.parse(stdout) as Record<string, unknown>;
  } catch {
    throw new DownloaderError("تعذر فحص الرابط. تأكد أن المنشور أو القصة عامة ومتاحة.");
  }
}

export async function inspectMediaLink(rawUrl: string, jobId?: string): Promise<InspectResult> {
  const { platform } = inspectSupportedUrl(rawUrl);
  const isStory = detectStoryLink(rawUrl);
  const accountPromise = platform === "tiktok"
    ? loadTikTokAccount(rawUrl).catch(() => undefined)
    : Promise.resolve(undefined);
  const [metadata, account, story] = await Promise.all([
    loadMetadata(rawUrl, jobId),
    accountPromise,
    Promise.resolve(isStory),
  ]);
  const formats = Array.isArray(metadata.formats) ? metadata.formats as Array<Record<string, unknown>> : [];
  const directExtension = String(metadata.ext || "").toLowerCase();
  const directIsImage = imageExtensions.includes(directExtension);
  const directVideoCodec = String(metadata.vcodec || "");
  const directAudioCodec = String(metadata.acodec || "");
  const hasVideo = formats.some(format => format.vcodec && format.vcodec !== "none") || (Boolean(metadata.url) && !directIsImage && Boolean(directVideoCodec) && directVideoCodec !== "none");
  const hasAudio = formats.some(format => format.acodec && format.acodec !== "none") || (hasVideo && Boolean(directAudioCodec) && directAudioCodec !== "none");
  const hasImageFormat = directIsImage || formats.some(format => {
    const ext = String(format.ext || "").toLowerCase();
    return imageExtensions.includes(ext) && (!format.vcodec || format.vcodec === "none");
  });
  const sourceImageUrls = imageUrlsFromMetadata(metadata);
  const hasImage = hasImageFormat || Boolean(sourceImageUrls.length);
  const choices: MediaChoice[] = [];
  if (hasVideo) choices.push(story ? "story" : "video");
  if (hasAudio) choices.push("audio");
  if (hasImage) choices.push("image");
  if (!choices.length && platform === "twitter") {
    const imageUrl = await loadPublicTwitterOpenGraphImage(new URL(rawUrl));
    if (imageUrl) {
      return { platform, title: "صورة Twitter/X عامة", choices: ["image"], thumbnail: imageUrl };
    }
    throw new DownloaderError("لم يتيح X وسائط عامة قابلة للإرسال لهذا المنشور. قد يكون حساساً ومتاحاً عبر تطبيق X فقط أو محمياً بتسجيل الدخول.");
  }
  if (!choices.length) throw new DownloaderError("لم يؤكد المصدر وجود فيديو أو صوت أو صورة عامة قابلة للإرسال. قد يكون المنشور خاصاً أو قصة منتهية أو ألبوماً لا يتيح المصدر استخراج وسائطه.");

  const enrichedAccount = mergeAccounts(
    account,
    typeof metadata.channel === "string" && metadata.channel.trim() ? { nickname: metadata.channel.trim() } : undefined,
    typeof metadata.uploader === "string" && metadata.uploader.trim() ? { username: metadata.uploader.trim().replace(/^@/, "") } : undefined,
  );

  const result: InspectResult = {
    platform,
    title: cleanTitle(metadata.title),
    choices,
    durationSeconds: typeof metadata.duration === "number" ? metadata.duration : undefined,
    thumbnail: sourceImageUrls[0],
  };
  if (sourceImageUrls.length > 1) result.imageCount = sourceImageUrls.length;
  if (enrichedAccount) result.account = enrichedAccount;
  return result;
}

export async function downloadMedia(rawUrl: string, choice: MediaChoice, jobId: string) {
  let { url, platform } = inspectSupportedUrl(rawUrl);
  if (platform === "tiktok") url = await resolveTikTokPublicUrl(url);
  const workdir = await mkdtemp(path.join(os.tmpdir(), `telegram-media-${jobId}-`));
  const output = path.join(workdir, "media.%(ext)s");
  if (choice === "image") {
    try {
      const metadata = await loadMetadata(url.toString(), jobId);
      const imageUrl = imageUrlFromMetadata(metadata);
      if (!imageUrl) throw new DownloaderError("لم يؤكد المصدر رابط صورة أصلية قابلة للإرسال. تحقق أن المنشور عام وليس قصة منتهية أو ألبوماً محمياً.");
      const response = await fetch(imageUrl);
      if (!response.ok) throw new DownloaderError("رفض المصدر جلب الصورة العامة حالياً. جرّب الرابط مرة أخرى لاحقاً أو أرسل رابط المنشور العام الأصلي.");
      const contentLength = Number(response.headers.get("content-length") || 0);
      if (contentLength > MAX_MEDIA_BYTES) throw new DownloaderError("حجم الصورة أكبر من الحد الآمن للإرسال عبر البوت.");
      const contentType = response.headers.get("content-type") || "image/jpeg";
      if (!contentType.startsWith("image/")) throw new DownloaderError("المصدر لم يُرجع ملف صورة صالحاً.");
      const bytes = Buffer.from(await response.arrayBuffer());
      if (bytes.byteLength > MAX_MEDIA_BYTES) throw new DownloaderError("حجم الصورة أكبر من الحد الآمن للإرسال عبر البوت.");
      const extension = contentType.includes("png") ? "png" : contentType.includes("webp") ? "webp" : "jpg";
      const filePath = path.join(workdir, `media.${extension}`);
      await writeFile(filePath, bytes);
      return { workdir, filePath, bytes: bytes.byteLength };
    } catch (error) {
      await rm(workdir, { recursive: true, force: true });
      throw error;
    }
  }

  const args = [...tiktokImpersonationArgs(platform), ...twitterRequestArgs(platform), ...snapchatRequestArgs(platform), "--no-playlist", "--no-warnings", "--restrict-filenames", "--retries", "2", "--extractor-retries", "2", "--fragment-retries", "2", "--socket-timeout", "20", "--max-filesize", String(MAX_MEDIA_BYTES), "-o", output];
  if (choice === "audio") {
    args.push("-x", "--audio-format", "mp3", "-f", "bestaudio/best");
  } else {
    args.push("-f", "bestvideo*+bestaudio/best", "--merge-output-format", "mp4");
  }
  args.push(url.toString());

  try {
    await runYtDlpWithRetry(args, DOWNLOAD_TIMEOUT_MS, jobId);
    const files = (await readdir(workdir))
      .filter(file => !file.endsWith(".part") && !file.endsWith(".ytdl"))
      .map(file => path.join(workdir, file));
    if (!files.length) throw new DownloaderError("اكتمل الطلب دون ملف قابل للإرسال.");
    const candidate = files[0];
    const fileInfo = await stat(candidate);
    if (fileInfo.size > MAX_MEDIA_BYTES) {
      throw new DownloaderError("حجم الملف أكبر من الحد الآمن للإرسال عبر البوت. جرّب رابطاً أقصر أو جودة أقل.");
    }
    return { workdir, filePath: candidate, bytes: fileInfo.size };
  } catch (error) {
    await rm(workdir, { recursive: true, force: true });
    throw error;
  }
}

export async function purgeDownloadedMedia(workdir: string) {
  await rm(workdir, { recursive: true, force: true });
}

async function writeRemoteImage(url: string, destination: string): Promise<number> {
  const response = await fetch(url);
  if (!response.ok) throw new DownloaderError("رفض المصدر جلب إحدى الصور حالياً. جرّب الرابط مرة أخرى لاحقاً.");
  const contentType = response.headers.get("content-type") || "image/jpeg";
  if (!contentType.startsWith("image/")) throw new DownloaderError("أحد الملفات التي أرجعها المصدر ليس صورة صالحة.");
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.byteLength > MAX_MEDIA_BYTES) throw new DownloaderError("حجم إحدى الصور أكبر من الحد الآمن للإرسال عبر البوت.");
  await writeFile(destination, bytes);
  return bytes.byteLength;
}

function extensionForUrl(url: string) {
  return /\.png(?:$|[?#])/i.test(url) ? "png" : /\.webp(?:$|[?#])/i.test(url) ? "webp" : /\.gif(?:$|[?#])/i.test(url) ? "gif" : "jpg";
}

export async function downloadAllImages(rawUrl: string, jobId: string) {
  const workdir = await mkdtemp(path.join(os.tmpdir(), `telegram-gallery-${jobId}-`));
  try {
    const metadata = await loadMetadata(rawUrl, jobId);
    const urls = Array.from(new Set(imageUrlsFromMetadata(metadata)));
    if (!urls.length) throw new DownloaderError("لم يؤكد المصدر روابط صور قابلة للإرسال. تحقق أن المشاركة عامة ومتاحة.");
    const files: Array<{ path: string }> = [];
    let totalBytes = 0;
    for (let index = 0; index < urls.length; index += 1) {
      const filePath = path.join(workdir, `media-${index + 1}.${extensionForUrl(urls[index])}`);
      const bytes = await writeRemoteImage(urls[index], filePath);
      totalBytes += bytes;
      files.push({ path: filePath });
    }
    return { workdir, files, bytes: totalBytes };
  } catch (error) {
    await rm(workdir, { recursive: true, force: true });
    throw error;
  }
}
