import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

// =============================================================================
// Spam protection + premium (featured) users
// - Persisted to data/protection.json (same DATA_DIR convention as botDb).
// - Spam: soft limit per minute; repeated violations within the strike window
//   mute the user automatically for the owner-configured duration.
// - Premium users bypass the usage limit, forced subscriptions and spam checks.
// =============================================================================

const SPAM_WINDOW_MS = 60_000;
const SPAM_MAX_PER_WINDOW = 5;
const SPAM_STRIKES_TO_MUTE = 3;
const SPAM_STRIKES_WINDOW_MS = 10 * 60_000;
const DEFAULT_MUTE_MINUTES = 30;
const MAX_MUTE_MINUTES = 1_440;

type ProtectionFile = {
  spamMuteMinutes: number;
  premiumUsers: string[];
};

const state: ProtectionFile = {
  spamMuteMinutes: DEFAULT_MUTE_MINUTES,
  premiumUsers: [],
};

const requestWindows = new Map<string, number[]>();
const strikeTimestamps = new Map<string, number[]>();
const activeMutes = new Map<string, number>();

let persistenceReady: Promise<void> | undefined;
let writeChain: Promise<void> = Promise.resolve();

function protectionFile() {
  const dir = process.env.DATA_DIR?.trim() || path.join(process.cwd(), "data");
  return path.join(dir, "protection.json");
}

async function loadProtectionFromDisk() {
  try {
    const parsed = JSON.parse(await readFile(protectionFile(), "utf8")) as Partial<ProtectionFile>;
    if (Number.isFinite(parsed.spamMuteMinutes) && (parsed.spamMuteMinutes as number) >= 1) {
      state.spamMuteMinutes = Math.min(parsed.spamMuteMinutes as number, MAX_MUTE_MINUTES);
    }
    if (Array.isArray(parsed.premiumUsers)) {
      state.premiumUsers = Array.from(new Set(
        parsed.premiumUsers.filter((id): id is string => typeof id === "string" && /^\d+$/.test(id)),
      ));
    }
  } catch {
    // First boot or unreadable storage: start with defaults.
    try {
      await mkdir(path.dirname(protectionFile()), { recursive: true });
      await persistProtection();
    } catch { /* persistence is best-effort */ }
  }
}

function persistProtection() {
  writeChain = writeChain.then(async () => {
    try {
      await mkdir(path.dirname(protectionFile()), { recursive: true });
      await writeFile(protectionFile(), JSON.stringify(state, null, 2), "utf8");
    } catch { /* persistence is best-effort */ }
  });
  return writeChain.catch(() => undefined);
}

function ensureLoaded() {
  if (!persistenceReady) {
    persistenceReady = loadProtectionFromDisk();
  }
  return persistenceReady;
}

export type SpamVerdict = {
  allowed: boolean;
  mutedUntil: number | null;
  newlyMuted: boolean;
  softLimited: boolean;
};

export async function checkMessageSpam(telegramId: string, bypass: boolean): Promise<SpamVerdict> {
  await ensureLoaded();
  if (bypass) return { allowed: true, mutedUntil: null, newlyMuted: false, softLimited: false };
  const now = Date.now();
  const mutedUntil = activeMutes.get(telegramId) ?? 0;
  if (mutedUntil > now) {
    return { allowed: false, mutedUntil, newlyMuted: false, softLimited: false };
  }
  if (mutedUntil) activeMutes.delete(telegramId);

  const window = (requestWindows.get(telegramId) || []).filter(value => now - value < SPAM_WINDOW_MS);
  if (window.length >= SPAM_MAX_PER_WINDOW) {
    window.push(now);
    requestWindows.set(telegramId, window);
    const strikes = (strikeTimestamps.get(telegramId) || []).filter(value => now - value < SPAM_STRIKES_WINDOW_MS);
    strikes.push(now);
    strikeTimestamps.set(telegramId, strikes);
    if (strikes.length >= SPAM_STRIKES_TO_MUTE) {
      const until = now + state.spamMuteMinutes * 60_000;
      activeMutes.set(telegramId, until);
      strikeTimestamps.delete(telegramId);
      return { allowed: false, mutedUntil: until, newlyMuted: true, softLimited: false };
    }
    return { allowed: true, mutedUntil: null, newlyMuted: false, softLimited: true };
  }
  window.push(now);
  requestWindows.set(telegramId, window);
  return { allowed: true, mutedUntil: null, newlyMuted: false, softLimited: false };
}

export async function getProtectionSettings() {
  await ensureLoaded();
  return { spamMuteMinutes: state.spamMuteMinutes, premiumUsers: [...state.premiumUsers] };
}

export async function setSpamMuteMinutes(minutes: number) {
  if (!Number.isInteger(minutes) || minutes < 1 || minutes > MAX_MUTE_MINUTES) {
    throw new Error("أدخل مدة بالدقائق بين 1 و1440.");
  }
  state.spamMuteMinutes = minutes;
  await persistProtection();
}

export async function isPremiumUser(telegramId: string) {
  await ensureLoaded();
  return state.premiumUsers.includes(telegramId);
}

export async function listPremiumUsers() {
  await ensureLoaded();
  return [...state.premiumUsers];
}

export async function addPremiumUser(telegramId: string) {
  await ensureLoaded();
  const normalized = telegramId.trim();
  if (!/^\d+$/.test(normalized)) throw new Error("أدخل معرّف تلغرام رقمي صحيح.");
  if (state.premiumUsers.includes(normalized)) return false;
  state.premiumUsers.push(normalized);
  await persistProtection();
  return true;
}

export async function removePremiumUser(telegramId: string) {
  await ensureLoaded();
  const normalized = telegramId.trim();
  const index = state.premiumUsers.indexOf(normalized);
  if (index === -1) return false;
  state.premiumUsers.splice(index, 1);
  await persistProtection();
  return true;
}

/** Test isolation: reset in-memory spam trackers and settings without touching disk. */
export function resetProtectionForTests() {
  state.spamMuteMinutes = DEFAULT_MUTE_MINUTES;
  state.premiumUsers = [];
  requestWindows.clear();
  strikeTimestamps.clear();
  activeMutes.clear();
  persistenceReady = Promise.resolve();
}
