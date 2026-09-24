import { nanoid } from "nanoid";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { cleanupInactiveBefore, isValidCleanupDays, isValidUsageLimitCount, isValidUsageWindowHours } from "./policy";
import {
  addForcedSubscription as addForcedSubscriptionPg,
  addOwner as addOwnerPg,
  addSubscriptionPlan as addSubscriptionPlanPg,
  activeRecipientIds as activeRecipientIdsPg,
  claimUpdate as claimUpdatePg,
  ensurePrimaryOwnerWeb as ensurePrimaryOwnerPg,
  findSubscriptionPlanById as findSubscriptionPlanByIdPg,
  findUserByUsername as findUserByUsernamePg,
  getAccessRecord as getAccessRecordPg,
  getOwnerRole as getOwnerRolePg,
  getSettings as getSettingsPg,
  getUser as getUserPg,
  isSupabaseConfigured,
  listForcedSubscriptions as listForcedSubscriptionsPg,
  listOwners as listOwnersPg,
  listSubscriptionPlans as listSubscriptionPlansPg,
  listUsers as listUsersPg,
  pruneUsers as pruneUsersPg,
  removeForcedSubscription as removeForcedSubscriptionPg,
  removeOwner as removeOwnerPg,
  saveAccessRecord as saveAccessRecordPg,
  saveSettings as saveSettingsPg,
  setSubscriptionPlanActive as setSubscriptionPlanActivePg,
  setUserStatus as setUserStatusPg,
  stats as statsPg,
  touchUser as touchUserPg,
  trimClaims as trimClaimsPg,
} from "./supabase";
import type { ForcedSubscription, SubscriptionPlan } from "./types";
import type { TelegramFrom } from "./types";

const DEFAULT_SETTINGS = {
  maxUsers: 100,
  cleanupInactiveDays: 30,
  cleanupTempMinutes: 60,
  broadcastRatePerSecond: 20,
  notifyNewUsers: true,
  usageLimitEnabled: false,
  usageLimitCount: 5,
  usageLimitWindowHours: 24,
  paidModeEnabled: false,
};

export type Admission = "active" | "blocked" | "capacity";

export type MemoryBotSettings = {
  id: number;
  maxUsers: number;
  cleanupInactiveDays: number;
  cleanupTempMinutes: number;
  broadcastRatePerSecond: number;
  notifyNewUsers: boolean;
  usageLimitEnabled: boolean;
  usageLimitCount: number;
  usageLimitWindowHours: number;
  paidModeEnabled: boolean;
  updatedAt: Date;
};

export type UserAccessRecord = {
  subscriptionExpiresAt: number | null;
  subscriptionPlanId: string | null;
  downloadTimestamps: number[];
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
  subscriptions: new Map<string, ForcedSubscription>(),
  plans: new Map<string, SubscriptionPlan>(),
  access: new Map<string, UserAccessRecord>(),
  processedUpdateIds: new Set<number>(),
  nextUserId: 1,
  nextErrorId: 1,
};

function subscriptionsFile() {
  const dir = process.env.DATA_DIR?.trim() || path.join(process.cwd(), "data");
  return path.join(dir, "subscriptions.json");
}

function accessFile() {
  const dir = process.env.DATA_DIR?.trim() || path.join(process.cwd(), "data");
  return path.join(dir, "access.json");
}

let subscriptionsPersistenceReady: Promise<void> | undefined;
let subscriptionsWriteChain: Promise<void> = Promise.resolve();
let accessPersistenceReady: Promise<void> | undefined;
let accessWriteChain: Promise<void> = Promise.resolve();

async function loadSubscriptionsFromDisk() {
  try {
    const raw = await readFile(subscriptionsFile(), "utf8");
    const parsed = JSON.parse(raw) as ForcedSubscription[];
    if (Array.isArray(parsed)) {
      store.subscriptions.clear();
      parsed.forEach(subscription => store.subscriptions.set(subscription.id, { ...subscription, createdAt: new Date(subscription.createdAt) }));
    }
  } catch {
    // First boot or unwritable storage: start with an empty list.
    try {
      await mkdir(path.dirname(subscriptionsFile()), { recursive: true });
      await saveSubscriptionsToDisk();
    } catch { /* persistence is best-effort */ }
  }
}

function saveSubscriptionsToDisk() {
  subscriptionsWriteChain = subscriptionsWriteChain.then(async () => {
    const data = JSON.stringify(Array.from(store.subscriptions.values()), null, 2);
    try {
      await mkdir(path.dirname(subscriptionsFile()), { recursive: true });
      await writeFile(subscriptionsFile(), data, "utf8");
    } catch { /* persistence is best-effort */ }
  });
  return subscriptionsWriteChain.catch(() => undefined);
}

function ensureSubscriptionsLoaded() {
  if (!subscriptionsPersistenceReady) {
    subscriptionsPersistenceReady = loadSubscriptionsFromDisk();
  }
  return subscriptionsPersistenceReady;
}

type AccessFileShape = {
  plans: SubscriptionPlan[];
  users: Record<string, UserAccessRecord>;
};

async function loadAccessFromDisk() {
  try {
    const raw = await readFile(accessFile(), "utf8");
    const parsed = JSON.parse(raw) as Partial<AccessFileShape>;
    if (Array.isArray(parsed.plans)) {
      store.plans.clear();
      parsed.plans.forEach(plan => store.plans.set(plan.id, { ...plan, createdAt: new Date(plan.createdAt) }));
    }
    if (parsed.users && typeof parsed.users === "object") {
      store.access.clear();
      Object.entries(parsed.users).forEach(([telegramId, record]) => {
        store.access.set(telegramId, {
          subscriptionExpiresAt: record.subscriptionExpiresAt ?? null,
          subscriptionPlanId: record.subscriptionPlanId ?? null,
          downloadTimestamps: Array.isArray(record.downloadTimestamps) ? record.downloadTimestamps.filter(value => typeof value === "number") : [],
        });
      });
    }
  } catch {
    try {
      await mkdir(path.dirname(accessFile()), { recursive: true });
      await saveAccessToDisk();
    } catch { /* persistence is best-effort */ }
  }
}

function saveAccessToDisk() {
  accessWriteChain = accessWriteChain.then(async () => {
    const shape: AccessFileShape = {
      plans: Array.from(store.plans.values()),
      users: Object.fromEntries(store.access.entries()),
    };
    const data = JSON.stringify(shape, null, 2);
    try {
      await mkdir(path.dirname(accessFile()), { recursive: true });
      await writeFile(accessFile(), data, "utf8");
    } catch { /* persistence is best-effort */ }
  });
  return accessWriteChain.catch(() => undefined);
}

function ensureAccessLoaded() {
  if (!accessPersistenceReady) {
    accessPersistenceReady = loadAccessFromDisk();
  }
  return accessPersistenceReady;
}

function cloneSetting() {
  return { ...store.settings };
}

export function resetBotMemoryStore() {
  store.settings = { id: 1, ...DEFAULT_SETTINGS, updatedAt: new Date() };
  store.users.clear();
  store.owners.clear();
  store.jobs.clear();
  store.errors = [];
  store.subscriptions.clear();
  store.plans.clear();
  store.access.clear();
  store.processedUpdateIds.clear();
  store.nextUserId = 1;
  store.nextErrorId = 1;
  subscriptionsPersistenceReady = undefined;
  accessPersistenceReady = undefined;
}

async function ownerRole(telegramId: string): Promise<"primary" | "owner" | undefined> {
  if (isSupabaseConfigured()) return getOwnerRolePg(telegramId);
  return store.owners.get(String(telegramId))?.role;
}

export async function ensureBotSettings() {
  ensurePrimaryOwner();
  if (isSupabaseConfigured()) return getSettingsPg();
  return cloneSetting();
}

export async function ensurePrimaryOwner() {
  const ownerId = configuredPrimaryOwnerId();
  if (!ownerId) return;
  if (isSupabaseConfigured()) {
    await ensurePrimaryOwnerPg(ownerId);
    return;
  }
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
  return ownerRole(telegramId);
}

export async function isOwner(telegramId: string) {
  return Boolean(await ownerRole(telegramId));
}

export async function isPrimaryOwner(telegramId: string) {
  return (await ownerRole(telegramId)) === "primary";
}

export async function touchAndAdmitUser(from: TelegramFrom): Promise<{ admission: Admission; isNew: boolean }> {
  if (isSupabaseConfigured()) return touchUserPg(from);
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
  if (isSupabaseConfigured()) {
    const fresh = await claimUpdatePg(updateId);
    if (!fresh) return false;
    store.processedUpdateIds.add(updateId);
    return true;
  }
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
  if (isSupabaseConfigured()) {
    const settings = await getSettingsPg();
    const dayStart = new Date(); dayStart.setUTCHours(0, 0, 0, 0);
    const inactiveBefore = new Date(Date.now() - settings.cleanupInactiveDays * 86_400_000);
    return { ...(await statsPg(inactiveBefore, dayStart)), settings };
  }
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
  if (isSupabaseConfigured()) {
    const settings = await getSettingsPg();
    const inactiveBefore = new Date(Date.now() - settings.cleanupInactiveDays * 86_400_000);
    return listUsersPg(kind, limit, inactiveBefore);
  }
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

export async function getTelegramUser(telegramId: string) {
  if (isSupabaseConfigured()) return getUserPg(telegramId);
  return store.users.get(String(telegramId));
}

export async function findTelegramUser(identifier: string) {
  const normalized = identifier.trim().replace(/^@/, "");
  if (isSupabaseConfigured()) {
    if (/^\d+$/.test(normalized)) return getUserPg(normalized);
    return findUserByUsernamePg(normalized);
  }
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
  if (isSupabaseConfigured()) {
    const normalized = identifier.trim().replace(/^@/, "");
    if (/^\d+$/.test(normalized)) return setUserStatusPg(normalized, blocked);
    const user = await findUserByUsernamePg(normalized);
    return user ? setUserStatusPg(user.telegramId, blocked) : undefined;
  }
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
  if (isSupabaseConfigured()) return listOwnersPg();
  return Array.from(store.owners.values()).sort((a, b) => b.addedAt.getTime() - a.addedAt.getTime());
}

export async function addOwner(telegramId: string, addedByTelegramId: string) {
  const normalized = telegramId.trim();
  if (!/^\d+$/.test(normalized)) throw new Error("أدخل معرّف تلغرام رقمي صحيح.");
  if (isSupabaseConfigured()) return addOwnerPg(normalized, addedByTelegramId);
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
  if (isSupabaseConfigured()) {
    const result = await removeOwnerPg(telegramId);
    if (result === "primary") throw new Error("لا يمكن حذف المالك الأساسي.");
    return Boolean(result);
  }
  const owner = store.owners.get(telegramId);
  if (owner?.role === "primary") throw new Error("لا يمكن حذف المالك الأساسي.");
  if (!owner) return false;
  store.owners.delete(telegramId);
  return true;
}

export async function updateCleanupInactiveDays(days: number) {
  if (!isValidCleanupDays(days)) throw new Error("مدة التنظيف يجب أن تكون بين 7 و365 يوماً.");
  if (isSupabaseConfigured()) {
    const settings = await getSettingsPg();
    settings.cleanupInactiveDays = days;
    settings.updatedAt = new Date();
    await saveSettingsPg(settings);
    return;
  }
  store.settings = { ...store.settings, cleanupInactiveDays: days, updatedAt: new Date() };
}

export async function updateUsageLimit(input: { enabled?: boolean; count?: number; windowHours?: number }) {
  if (isSupabaseConfigured()) {
    const settings = await getSettingsPg();
    if (input.enabled !== undefined) settings.usageLimitEnabled = input.enabled;
    if (input.count !== undefined) {
      if (!isValidUsageLimitCount(input.count)) throw new Error("عدد التنزيلات يجب أن يكون رقماً بين 1 و1000.");
      settings.usageLimitCount = input.count;
    }
    if (input.windowHours !== undefined) {
      if (!isValidUsageWindowHours(input.windowHours)) throw new Error("نافذة الحد يجب أن تكون ساعات بين 1 و8760.");
      settings.usageLimitWindowHours = input.windowHours;
    }
    settings.updatedAt = new Date();
    await saveSettingsPg(settings);
    return;
  }
  const next = { ...store.settings, updatedAt: new Date() };
  if (input.enabled !== undefined) next.usageLimitEnabled = input.enabled;
  if (input.count !== undefined) {
    if (!isValidUsageLimitCount(input.count)) throw new Error("عدد التنزيلات يجب أن يكون رقماً بين 1 و1000.");
    next.usageLimitCount = input.count;
  }
  if (input.windowHours !== undefined) {
    if (!isValidUsageWindowHours(input.windowHours)) throw new Error("نافذة الحد يجب أن تكون ساعات بين 1 و8760.");
    next.usageLimitWindowHours = input.windowHours;
  }
  store.settings = next;
}

export async function updatePaidMode(enabled: boolean) {
  if (isSupabaseConfigured()) {
    const settings = await getSettingsPg();
    settings.paidModeEnabled = enabled;
    settings.updatedAt = new Date();
    await saveSettingsPg(settings);
    return;
  }
  store.settings = { ...store.settings, paidModeEnabled: enabled, updatedAt: new Date() };
}

export async function recentErrors(limit = 20) {
  return [...store.errors].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()).slice(0, limit);
}

export async function cleanupBotData() {
  const now = Date.now();
  if (isSupabaseConfigured()) {
    const settings = await getSettingsPg();
    const inactiveBefore = cleanupInactiveBefore(settings.cleanupInactiveDays, now);
    const ownerIds = (await listOwnersPg()).map(owner => owner.telegramId);
    const removedIds = await pruneUsersPg(inactiveBefore, ownerIds);
    const removed = new Set(removedIds);
    store.jobs.forEach((job, id) => {
      if (removed.has(job.telegramId)) store.jobs.delete(id);
    });
    store.errors = store.errors.filter(error => !removed.has(String(error.telegramId)));
    store.jobs.forEach((job, id) => {
      if (job.expiresAt.getTime() < now) store.jobs.delete(id);
    });
    store.errors = store.errors.filter(error => error.createdAt.getTime() >= now - 30 * 86_400_000);
    store.processedUpdateIds.clear();
    await trimClaimsPg(new Date(now - 7 * 86_400_000));
    return { removedInactiveUsers: removedIds.length };
  }
  const inactiveBefore = cleanupInactiveBefore(store.settings.cleanupInactiveDays, now);
  const ownerIds = new Set(store.owners.keys());
  const staleUsers = Array.from(store.users.values())
    .filter(user => user.status === "active" && user.lastActivityAt < inactiveBefore && !ownerIds.has(user.telegramId));
  for (const user of staleUsers) {
    store.users.delete(user.telegramId);
    store.access.delete(user.telegramId);
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
  if (isSupabaseConfigured()) {
    const ids = await activeRecipientIdsPg();
    return ids.map(telegramId => ({ telegramId }));
  }
  return Array.from(store.users.values())
    .filter(user => user.status === "active")
    .map(user => ({ telegramId: user.telegramId }));
}

export async function listForcedSubscriptions() {
  if (isSupabaseConfigured()) return listForcedSubscriptionsPg();
  await ensureSubscriptionsLoaded();
  return Array.from(store.subscriptions.values()).sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
}

export async function addForcedSubscription(input: Omit<ForcedSubscription, "id" | "createdAt">) {
  if (isSupabaseConfigured()) return addForcedSubscriptionPg(input);
  await ensureSubscriptionsLoaded();
  const normalized = input.target.trim();
  const existing = Array.from(store.subscriptions.values()).find(subscription => subscription.target === normalized);
  if (existing) return false;
  const subscription: ForcedSubscription = {
    ...input,
    target: normalized,
    id: nanoid(12),
    createdAt: new Date(),
  };
  store.subscriptions.set(subscription.id, subscription);
  await saveSubscriptionsToDisk();
  return true;
}

export async function removeForcedSubscription(identifier: string) {
  if (isSupabaseConfigured()) {
    const subscriptions = await listForcedSubscriptionsPg();
    const cleaned = identifier.trim().replace(/^https:\/\/t\.me\//, "").replace(/^@/, "");
    const subscription = subscriptions.find(candidate => candidate.id === identifier.trim() || candidate.target === cleaned || candidate.label === identifier.trim());
    if (!subscription) return false;
    return removeForcedSubscriptionPg(subscription.id);
  }
  await ensureSubscriptionsLoaded();
  const cleaned = identifier.trim().replace(/^https:\/\/t\.me\//, "").replace(/^@/, "");
  const subscription = Array.from(store.subscriptions.values())
    .find(candidate => candidate.id === identifier.trim() || candidate.target === cleaned || candidate.label === identifier.trim());
  if (!subscription) return false;
  store.subscriptions.delete(subscription.id);
  await saveSubscriptionsToDisk();
  return true;
}

export async function findForcedSubscription(target: string) {
  if (isSupabaseConfigured()) {
    const normalized = target.replace(/^@/, "");
    const subscriptions = await listForcedSubscriptionsPg();
    return subscriptions.find(subscription => subscription.target.replace(/^@/, "") === normalized);
  }
  await ensureSubscriptionsLoaded();
  const normalized = target.replace(/^@/, "");
  return Array.from(store.subscriptions.values()).find(subscription => subscription.target.replace(/^@/, "") === normalized);
}

export async function cleanupStaleJobs() {
  const now = Date.now();
  store.jobs.forEach((job, id) => {
    if (["inspecting", "ready", "downloading"].includes(job.status) || job.expiresAt.getTime() < now) {
      store.jobs.delete(id);
    }
  });
}

function accessRecord(telegramId: string) {
  const existing = store.access.get(telegramId);
  if (existing) return existing;
  const record: UserAccessRecord = { subscriptionExpiresAt: null, subscriptionPlanId: null, downloadTimestamps: [] };
  store.access.set(telegramId, record);
  return record;
}

async function persistAccess(telegramId: string, record: UserAccessRecord) {
  if (isSupabaseConfigured()) return saveAccessRecordPg(telegramId, record);
  await saveAccessToDisk();
}

export async function getUserAccess(telegramId: string): Promise<UserAccessRecord> {
  if (isSupabaseConfigured()) return getAccessRecordPg(String(telegramId));
  await ensureAccessLoaded();
  return accessRecord(String(telegramId));
}

export async function userDownloadsInWindow(telegramId: string, windowHours: number) {
  const record = await getUserAccess(telegramId);
  const since = Date.now() - windowHours * 3_600_000;
  return record.downloadTimestamps.filter(timestamp => timestamp >= since).length;
}

export async function recordUserDownload(telegramId: string, windowHours: number) {
  const record = await getUserAccess(telegramId);
  const since = Date.now() - windowHours * 3_600_000;
  record.downloadTimestamps.push(Date.now());
  record.downloadTimestamps = record.downloadTimestamps.filter(timestamp => timestamp >= since);
  await persistAccess(telegramId, record);
}

export async function setUserSubscription(telegramId: string, expiresAt: number, planId: string | null) {
  const record = await getUserAccess(telegramId);
  record.subscriptionExpiresAt = expiresAt;
  record.subscriptionPlanId = planId;
  await persistAccess(telegramId, record);
}

export async function listSubscriptionPlans() {
  if (isSupabaseConfigured()) return listSubscriptionPlansPg();
  await ensureAccessLoaded();
  return Array.from(store.plans.values()).sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
}

export async function addSubscriptionPlan(input: { name: string; durationDays: number; stars: number }) {
  const name = input.name.trim().slice(0, 60);
  if (!name) throw new Error("اكتب اسماً للحزمة.");
  if (isSupabaseConfigured()) return addSubscriptionPlanPg({ ...input, name });
  await ensureAccessLoaded();
  const plan: SubscriptionPlan = {
    id: nanoid(12),
    name,
    durationDays: input.durationDays,
    stars: input.stars,
    active: true,
    createdAt: new Date(),
  };
  store.plans.set(plan.id, plan);
  await saveAccessToDisk();
  return plan;
}

export async function findSubscriptionPlanById(id: string) {
  if (isSupabaseConfigured()) return findSubscriptionPlanByIdPg(id);
  await ensureAccessLoaded();
  return store.plans.get(id);
}

export async function setSubscriptionPlanActive(identifier: string, active: boolean) {
  if (isSupabaseConfigured()) {
    const cleaned = identifier.trim().replace(/^@/, "");
    const plans = await listSubscriptionPlansPg();
    const plan = plans.find(candidate => candidate.id === cleaned || candidate.name === cleaned || candidate.name.replace(/^@/, "") === cleaned);
    if (!plan) return false;
    return setSubscriptionPlanActivePg(plan.id, active);
  }
  await ensureAccessLoaded();
  const cleaned = identifier.trim().replace(/^@/, "");
  const plan = Array.from(store.plans.values())
    .find(candidate => candidate.id === cleaned || candidate.name === cleaned || candidate.name.replace(/^@/, "") === cleaned);
  if (!plan) return false;
  store.plans.set(plan.id, { ...plan, active });
  await saveAccessToDisk();
  return true;
}