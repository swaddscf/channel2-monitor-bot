import { nanoid } from "nanoid";
import { canAdmitNewUser, cleanupInactiveBefore, isValidCleanupDays, isValidMaxUsers } from "./policy";
import type { TelegramFrom } from "./types";

const DEFAULT_SETTINGS = {
  maxUsers: 100,
  cleanupInactiveDays: 30,
  cleanupTempMinutes: 60,
  broadcastRatePerSecond: 20,
  notifyNewUsers: true,
};

export type Admission = "active" | "blocked" | "capacity";

export type MemoryBotSettings = {
  id: number;
  maxUsers: number;
  cleanupInactiveDays: number;
  cleanupTempMinutes: number;
  broadcastRatePerSecond: number;
  notifyNewUsers: boolean;
  updatedAt: Date;
};

export type MemoryBotUser = {
  id: number;
  telegramId: string;
  username: string | null;
  displayName: string;
  languageCode: string | null;
  status: "active" | "blocked";
  firstSeenAt: Date;
  lastSeenAt: Date;
  lastActivityAt: Date;
};

export type MemoryBotOwner = {
  id: number;
  telegramId: string;
  role: "primary" | "owner";
  addedAt: Date;
  addedByTelegramId: string;
};

export type MemoryBotJob = {
  id: string;
  telegramId: string;
  sourceUrl: string;
  platform: string;
  status: "inspecting" | "ready" | "downloading" | "sent" | "cancelled" | "failed" | "expired";
  choicesJson: string | null;
  selectedChoice: string | null;
  cancelRequested: boolean;
  expiresAt: Date;
  createdAt: Date;
  updatedAt: Date;
};

export type MemoryBotError = {
  id: number;
  telegramId: string | null;
  sourceUrl: string | null;
  stage: string;
  message: string;
  createdAt: Date;
};

function configuredPrimaryOwnerId() {
  return (process.env.OWNER_ID || "").trim();
}

const store = {
  settings: { id: 1, ...DEFAULT_SETTINGS, updatedAt: new Date() } as MemoryBotSettings,
  users: new Map<string, MemoryBotUser>(),
  owners: new Map<string, MemoryBotOwner>(),
  jobs: new Map<string, MemoryBotJob>(),
  errors: [] as MemoryBotError[],
  processedUpdateIds: new Set<number>(),
  nextUserId: 1,
  nextErrorId: 1,
};

function cloneSetting() {
  return { ...store.settings };
}

export function resetBotMemoryStore() {
  store.settings = { id: 1, ...DEFAULT_SETTINGS, updatedAt: new Date() };
  store.users.clear();
  store.owners.clear();
  store.jobs.clear();
  store.errors = [];
  store.processedUpdateIds.clear();
  store.nextUserId = 1;
  store.nextErrorId = 1;
}

export async function ensureBotSettings() {
  ensurePrimaryOwner();
  return cloneSetting();
}

export async function ensurePrimaryOwner() {
  const ownerId = configuredPrimaryOwnerId();
  if (!ownerId) return;
  const existing = store.owners.get(ownerId);
  if (!existing) {
    store.owners.set(ownerId, { id: store.nextUserId++, telegramId: ownerId, role: "primary", addedAt: new Date(), addedByTelegramId: ownerId });
    return;
  }
  if (existing.role !== "primary") {
    store.owners.set(ownerId, { ...existing, role: "primary" });
  }
}

export async function getOwnerRole(telegramId: string) {
  return store.owners.get(String(telegramId))?.role;
}

export async function isOwner(telegramId: string) {
  return Boolean(store.owners.get(String(telegramId)));
}

export async function isPrimaryOwner(telegramId: string) {
  return store.owners.get(String(telegramId))?.role === "primary";
}

export async function touchAndAdmitUser(from: TelegramFrom): Promise<{ admission: Admission; isNew: boolean }> {
  const telegramId = String(from.id);
  const displayName = [from.first_name, from.last_name].filter(Boolean).join(" ").slice(0, 160) || "مستخدم";
  const existing = store.users.get(telegramId);
  if (existing) {
    if (existing.status === "blocked") return { admission: "blocked", isNew: false };
    store.users.set(telegramId, {
      ...existing,
      username: from.username || null,
      displayName,
      languageCode: from.language_code || null,
      lastSeenAt: new Date(),
      lastActivityAt: new Date(),
    });
    return { admission: "active", isNew: false };
  }

  const role = store.owners.get(telegramId)?.role;
  const total = Array.from(store.users.values()).filter(user => user.status === "active").length;
  if (!canAdmitNewUser(total, store.settings.maxUsers, role)) return { admission: "capacity", isNew: true };
  store.users.set(telegramId, {
    id: store.nextUserId++,
    telegramId,
    username: from.username || null,
    displayName,
    languageCode: from.language_code || null,
    status: "active",
    firstSeenAt: new Date(),
    lastSeenAt: new Date(),
    lastActivityAt: new Date(),
  });
  return { admission: "active", isNew: true };
}

export async function createMediaJob(telegramId: string, sourceUrl: string, platform: string) {
  const id = nanoid(18);
  store.jobs.set(id, {
    id,
    telegramId,
    sourceUrl,
    platform,
    status: "inspecting",
    choicesJson: null,
    selectedChoice: null,
    cancelRequested: false,
    expiresAt: new Date(Date.now() + 15 * 60 * 1000),
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  return id;
}

export async function getMediaJob(jobId: string) {
  return store.jobs.get(jobId);
}

export async function updateMediaJob(jobId: string, update: Partial<{
  status: "inspecting" | "ready" | "downloading" | "sent" | "cancelled" | "failed" | "expired";
  choicesJson: string;
  selectedChoice: string;
  cancelRequested: boolean;
}>) {
  const job = store.jobs.get(jobId);
  if (!job) return;
  store.jobs.set(jobId, { ...job, ...update, updatedAt: new Date() });
}

export async function deleteMediaJob(jobId: string) {
  store.jobs.delete(jobId);
}

export async function cancelMediaJob(jobId: string, telegramId: string) {
  const job = store.jobs.get(jobId);
  if (!job || job.telegramId !== telegramId || !["inspecting", "ready", "downloading"].includes(job.status)) return false;
  store.jobs.set(jobId, { ...job, cancelRequested: true, status: "cancelled", updatedAt: new Date() });
  return true;
}

export async function cancelLatestActiveJob(telegramId: string) {
  const active = Array.from(store.jobs.values())
    .filter(job => job.telegramId === telegramId && ["inspecting", "ready", "downloading"].includes(job.status))
    .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
  const latest = active[0];
  return latest && await cancelMediaJob(latest.id, telegramId) ? latest.id : undefined;
}

export async function claimTelegramUpdate(updateId: number) {
  if (store.processedUpdateIds.has(updateId)) return false;
  store.processedUpdateIds.add(updateId);
  return true;
}

export async function recordBotError(input: { telegramId?: string; sourceUrl?: string; stage: string; message: string }) {
  store.errors.push({
    id: store.nextErrorId++,
    telegramId: input.telegramId || null,
    sourceUrl: input.sourceUrl || null,
    stage: input.stage.slice(0, 64),
    message: input.message.slice(0, 3000),
    createdAt: new Date(),
  });
}

export async function botStats() {
  const dayStart = new Date(); dayStart.setUTCHours(0, 0, 0, 0);
  const inactiveBefore = new Date(Date.now() - store.settings.cleanupInactiveDays * 86_400_000);
  const all = Array.from(store.users.values());
  return {
    total: all.length,
    activeToday: all.filter(user => user.lastActivityAt >= dayStart).length,
    joinedToday: all.filter(user => user.firstSeenAt >= dayStart).length,
    blocked: all.filter(user => user.status === "blocked").length,
    inactive: all.filter(user => user.status === "active" && user.lastActivityAt < inactiveBefore).length,
    settings: cloneSetting(),
  };
}

export async function listTelegramUsers(kind: "recent" | "active" | "blocked" | "inactive", limit = 50) {
  const inactiveBefore = new Date(Date.now() - store.settings.cleanupInactiveDays * 86_400_000);
  const all = Array.from(store.users.values());
  const filtered = kind === "active" ? all.filter(user => user.status === "active")
    : kind === "blocked" ? all.filter(user => user.status === "blocked")
    : kind === "inactive" ? all.filter(user => user.status === "active" && user.lastActivityAt < inactiveBefore)
    : all;
  const sorted = filtered.sort((a, b) => kind === "recent"
    ? b.firstSeenAt.getTime() - a.firstSeenAt.getTime()
    : b.lastSeenAt.getTime() - a.lastSeenAt.getTime());
  return sorted.slice(0, limit);
}

export async function findTelegramUser(identifier: string) {
  const normalized = identifier.trim().replace(/^@/, "");
  if (/^\d+$/.test(normalized)) {
    return store.users.get(normalized);
  }
  let found: MemoryBotUser | undefined;
  store.users.forEach(user => {
    if (!found && user.username === normalized) found = user;
  });
  return found;
}

export async function setTelegramUserBlocked(identifier: string, blocked: boolean) {
  if (/^\d+$/.test(identifier.trim())) {
    const user = store.users.get(identifier.trim());
    if (!user) return undefined;
    store.users.set(user.telegramId, { ...user, status: blocked ? "blocked" : "active", lastActivityAt: new Date() });
    return user;
  }
  const user = await findTelegramUser(identifier);
  if (!user) return undefined;
  store.users.set(user.telegramId, { ...user, status: blocked ? "blocked" : "active", lastActivityAt: new Date() });
  return user;
}

export async function listOwners() {
  return Array.from(store.owners.values()).sort((a, b) => b.addedAt.getTime() - a.addedAt.getTime());
}

export async function addOwner(telegramId: string, addedByTelegramId: string) {
  const normalized = telegramId.trim();
  if (!/^\d+$/.test(normalized)) throw new Error("أدخل معرّف تلغرام رقمي صحيح.");
  if (store.owners.has(normalized)) return false;
  store.owners.set(normalized, {
    id: store.nextUserId++,
    telegramId: normalized,
    role: "owner",
    addedAt: new Date(),
    addedByTelegramId,
  });
  return true;
}

export async function removeOwner(telegramId: string) {
  const owner = store.owners.get(telegramId);
  if (owner?.role === "primary") throw new Error("لا يمكن حذف المالك الأساسي.");
  if (!owner) return false;
  store.owners.delete(telegramId);
  return true;
}

export async function updateMaxUsers(maxUsers: number) {
  if (!isValidMaxUsers(maxUsers)) throw new Error("الحد يجب أن يكون عدداً صحيحاً بين 1 و1,000,000.");
  store.settings = { ...store.settings, maxUsers, updatedAt: new Date() };
}

export async function updateCleanupInactiveDays(days: number) {
  if (!isValidCleanupDays(days)) throw new Error("مدة التنظيف يجب أن تكون بين 7 و365 يوماً.");
  store.settings = { ...store.settings, cleanupInactiveDays: days, updatedAt: new Date() };
}

export async function recentErrors(limit = 20) {
  return [...store.errors].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()).slice(0, limit);
}

export async function cleanupBotData() {
  const now = Date.now();
  const inactiveBefore = cleanupInactiveBefore(store.settings.cleanupInactiveDays, now);
  const ownerIds = new Set(store.owners.keys());
  const staleUsers = Array.from(store.users.values())
    .filter(user => user.status === "active" && user.lastActivityAt < inactiveBefore && !ownerIds.has(user.telegramId));
  for (const user of staleUsers) {
    store.users.delete(user.telegramId);
    store.jobs.forEach(job => {
      if (job.telegramId === user.telegramId) store.jobs.delete(job.id);
    });
    store.errors = store.errors.filter(error => error.telegramId !== user.telegramId);
  }
  store.jobs.forEach((job, id) => {
    if (job.expiresAt.getTime() < now) store.jobs.delete(id);
  });
  const errorBefore = Date.now() - 30 * 86_400_000;
  store.errors = store.errors.filter(error => error.createdAt.getTime() >= errorBefore);
  store.processedUpdateIds.clear();
  return { removedInactiveUsers: staleUsers.length };
}

export async function activeRecipients() {
  return Array.from(store.users.values())
    .filter(user => user.status === "active")
    .map(user => ({ telegramId: user.telegramId }));
}

export async function cleanupStaleJobs() {
  const now = Date.now();
  store.jobs.forEach((job, id) => {
    if (["inspecting", "ready", "downloading"].includes(job.status) || job.expiresAt.getTime() < now) {
      store.jobs.delete(id);
    }
  });
}