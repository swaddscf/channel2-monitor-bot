var __defProp = Object.defineProperty;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __esm = (fn, res) => function __init() {
  return fn && (res = (0, fn[__getOwnPropNames(fn)[0]])(fn = 0)), res;
};
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};

// server/telegram/policy.ts
function isValidCleanupDays(value) {
  return Number.isInteger(value) && value >= 7 && value <= 365;
}
function cleanupInactiveBefore(days, now = Date.now()) {
  return new Date(now - days * 864e5);
}
function isValidTelegramUpdateId(value) {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}
var init_policy = __esm({
  "server/telegram/policy.ts"() {
    "use strict";
  }
});

// server/telegram/botDb.ts
var botDb_exports = {};
__export(botDb_exports, {
  activeRecipients: () => activeRecipients,
  addForcedSubscription: () => addForcedSubscription,
  addOwner: () => addOwner,
  botStats: () => botStats,
  cancelLatestActiveJob: () => cancelLatestActiveJob,
  cancelMediaJob: () => cancelMediaJob,
  claimTelegramUpdate: () => claimTelegramUpdate,
  cleanupBotData: () => cleanupBotData,
  cleanupStaleJobs: () => cleanupStaleJobs,
  createMediaJob: () => createMediaJob,
  deleteMediaJob: () => deleteMediaJob,
  ensureBotSettings: () => ensureBotSettings,
  ensurePrimaryOwner: () => ensurePrimaryOwner,
  findForcedSubscription: () => findForcedSubscription,
  findTelegramUser: () => findTelegramUser,
  getMediaJob: () => getMediaJob,
  getOwnerRole: () => getOwnerRole,
  getTelegramUser: () => getTelegramUser,
  isOwner: () => isOwner,
  isPrimaryOwner: () => isPrimaryOwner,
  listForcedSubscriptions: () => listForcedSubscriptions,
  listOwners: () => listOwners,
  listTelegramUsers: () => listTelegramUsers,
  recentErrors: () => recentErrors,
  recordBotError: () => recordBotError,
  removeForcedSubscription: () => removeForcedSubscription,
  removeOwner: () => removeOwner,
  resetBotMemoryStore: () => resetBotMemoryStore,
  setTelegramUserBlocked: () => setTelegramUserBlocked,
  touchAndAdmitUser: () => touchAndAdmitUser,
  updateCleanupInactiveDays: () => updateCleanupInactiveDays,
  updateMediaJob: () => updateMediaJob
});
import { nanoid } from "nanoid";
import { mkdir, readFile as readFile2, writeFile } from "node:fs/promises";
import path3 from "node:path";
function configuredPrimaryOwnerId() {
  return (process.env.OWNER_ID || "").trim();
}
function subscriptionsFile() {
  const dir = process.env.DATA_DIR?.trim() || path3.join(process.cwd(), "data");
  return path3.join(dir, "subscriptions.json");
}
async function loadSubscriptionsFromDisk() {
  try {
    const raw = await readFile2(subscriptionsFile(), "utf8");
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      store.subscriptions.clear();
      parsed.forEach((subscription) => store.subscriptions.set(subscription.id, { ...subscription, createdAt: new Date(subscription.createdAt) }));
    }
  } catch {
    try {
      await mkdir(path3.dirname(subscriptionsFile()), { recursive: true });
      await saveSubscriptionsToDisk();
    } catch {
    }
  }
}
function saveSubscriptionsToDisk() {
  subscriptionsWriteChain = subscriptionsWriteChain.then(async () => {
    const data = JSON.stringify(Array.from(store.subscriptions.values()), null, 2);
    try {
      await mkdir(path3.dirname(subscriptionsFile()), { recursive: true });
      await writeFile(subscriptionsFile(), data, "utf8");
    } catch {
    }
  });
  return subscriptionsWriteChain.catch(() => void 0);
}
function ensureSubscriptionsLoaded() {
  if (!subscriptionsPersistenceReady) {
    subscriptionsPersistenceReady = loadSubscriptionsFromDisk();
  }
  return subscriptionsPersistenceReady;
}
function cloneSetting() {
  return { ...store.settings };
}
function resetBotMemoryStore() {
  store.settings = { id: 1, ...DEFAULT_SETTINGS, updatedAt: /* @__PURE__ */ new Date() };
  store.users.clear();
  store.owners.clear();
  store.jobs.clear();
  store.errors = [];
  store.subscriptions.clear();
  store.processedUpdateIds.clear();
  store.nextUserId = 1;
  store.nextErrorId = 1;
  subscriptionsPersistenceReady = void 0;
}
async function ensureBotSettings() {
  ensurePrimaryOwner();
  return cloneSetting();
}
async function ensurePrimaryOwner() {
  const ownerId = configuredPrimaryOwnerId();
  if (!ownerId) return;
  const existing = store.owners.get(ownerId);
  if (!existing) {
    store.owners.set(ownerId, { id: store.nextUserId++, telegramId: ownerId, role: "primary", addedAt: /* @__PURE__ */ new Date(), addedByTelegramId: ownerId });
    return;
  }
  if (existing.role !== "primary") {
    store.owners.set(ownerId, { ...existing, role: "primary" });
  }
}
async function getOwnerRole(telegramId) {
  return store.owners.get(String(telegramId))?.role;
}
async function isOwner(telegramId) {
  return Boolean(store.owners.get(String(telegramId)));
}
async function isPrimaryOwner(telegramId) {
  return store.owners.get(String(telegramId))?.role === "primary";
}
async function touchAndAdmitUser(from) {
  const telegramId = String(from.id);
  const displayName = [from.first_name, from.last_name].filter(Boolean).join(" ").slice(0, 160) || "\u0645\u0633\u062A\u062E\u062F\u0645";
  const existing = store.users.get(telegramId);
  if (existing) {
    if (existing.status === "blocked") return { admission: "blocked", isNew: false };
    store.users.set(telegramId, {
      ...existing,
      username: from.username || null,
      displayName,
      languageCode: from.language_code || null,
      lastSeenAt: /* @__PURE__ */ new Date(),
      lastActivityAt: /* @__PURE__ */ new Date()
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
    firstSeenAt: /* @__PURE__ */ new Date(),
    lastSeenAt: /* @__PURE__ */ new Date(),
    lastActivityAt: /* @__PURE__ */ new Date()
  });
  return { admission: "active", isNew: true };
}
async function createMediaJob(telegramId, sourceUrl, platform) {
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
    expiresAt: new Date(Date.now() + 15 * 60 * 1e3),
    createdAt: /* @__PURE__ */ new Date(),
    updatedAt: /* @__PURE__ */ new Date()
  });
  return id;
}
async function getMediaJob(jobId) {
  return store.jobs.get(jobId);
}
async function updateMediaJob(jobId, update) {
  const job = store.jobs.get(jobId);
  if (!job) return;
  store.jobs.set(jobId, { ...job, ...update, updatedAt: /* @__PURE__ */ new Date() });
}
async function deleteMediaJob(jobId) {
  store.jobs.delete(jobId);
}
async function cancelMediaJob(jobId, telegramId) {
  const job = store.jobs.get(jobId);
  if (!job || job.telegramId !== telegramId || !["inspecting", "ready", "downloading"].includes(job.status)) return false;
  store.jobs.set(jobId, { ...job, cancelRequested: true, status: "cancelled", updatedAt: /* @__PURE__ */ new Date() });
  return true;
}
async function cancelLatestActiveJob(telegramId) {
  const active2 = Array.from(store.jobs.values()).filter((job) => job.telegramId === telegramId && ["inspecting", "ready", "downloading"].includes(job.status)).sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
  const latest = active2[0];
  return latest && await cancelMediaJob(latest.id, telegramId) ? latest.id : void 0;
}
async function claimTelegramUpdate(updateId) {
  if (store.processedUpdateIds.has(updateId)) return false;
  store.processedUpdateIds.add(updateId);
  return true;
}
async function recordBotError(input) {
  store.errors.push({
    id: store.nextErrorId++,
    telegramId: input.telegramId || null,
    sourceUrl: input.sourceUrl || null,
    stage: input.stage.slice(0, 64),
    message: input.message.slice(0, 3e3),
    createdAt: /* @__PURE__ */ new Date()
  });
}
async function botStats() {
  const dayStart = /* @__PURE__ */ new Date();
  dayStart.setUTCHours(0, 0, 0, 0);
  const inactiveBefore = new Date(Date.now() - store.settings.cleanupInactiveDays * 864e5);
  const all = Array.from(store.users.values());
  return {
    total: all.length,
    activeToday: all.filter((user) => user.lastActivityAt >= dayStart).length,
    joinedToday: all.filter((user) => user.firstSeenAt >= dayStart).length,
    blocked: all.filter((user) => user.status === "blocked").length,
    inactive: all.filter((user) => user.status === "active" && user.lastActivityAt < inactiveBefore).length,
    settings: cloneSetting()
  };
}
async function listTelegramUsers(kind, limit = 50) {
  const inactiveBefore = new Date(Date.now() - store.settings.cleanupInactiveDays * 864e5);
  const all = Array.from(store.users.values());
  const filtered = kind === "active" ? all.filter((user) => user.status === "active") : kind === "blocked" ? all.filter((user) => user.status === "blocked") : kind === "inactive" ? all.filter((user) => user.status === "active" && user.lastActivityAt < inactiveBefore) : all;
  const sorted = filtered.sort((a, b) => kind === "recent" ? b.firstSeenAt.getTime() - a.firstSeenAt.getTime() : b.lastSeenAt.getTime() - a.lastSeenAt.getTime());
  return sorted.slice(0, limit);
}
async function getTelegramUser(telegramId) {
  return store.users.get(String(telegramId));
}
async function findTelegramUser(identifier) {
  const normalized = identifier.trim().replace(/^@/, "");
  if (/^\d+$/.test(normalized)) {
    return store.users.get(normalized);
  }
  let found;
  store.users.forEach((user) => {
    if (!found && user.username === normalized) found = user;
  });
  return found;
}
async function setTelegramUserBlocked(identifier, blocked) {
  if (/^\d+$/.test(identifier.trim())) {
    const user2 = store.users.get(identifier.trim());
    if (!user2) return void 0;
    store.users.set(user2.telegramId, { ...user2, status: blocked ? "blocked" : "active", lastActivityAt: /* @__PURE__ */ new Date() });
    return user2;
  }
  const user = await findTelegramUser(identifier);
  if (!user) return void 0;
  store.users.set(user.telegramId, { ...user, status: blocked ? "blocked" : "active", lastActivityAt: /* @__PURE__ */ new Date() });
  return user;
}
async function listOwners() {
  return Array.from(store.owners.values()).sort((a, b) => b.addedAt.getTime() - a.addedAt.getTime());
}
async function addOwner(telegramId, addedByTelegramId) {
  const normalized = telegramId.trim();
  if (!/^\d+$/.test(normalized)) throw new Error("\u0623\u062F\u062E\u0644 \u0645\u0639\u0631\u0651\u0641 \u062A\u0644\u063A\u0631\u0627\u0645 \u0631\u0642\u0645\u064A \u0635\u062D\u064A\u062D.");
  if (store.owners.has(normalized)) return false;
  store.owners.set(normalized, {
    id: store.nextUserId++,
    telegramId: normalized,
    role: "owner",
    addedAt: /* @__PURE__ */ new Date(),
    addedByTelegramId
  });
  return true;
}
async function removeOwner(telegramId) {
  const owner = store.owners.get(telegramId);
  if (owner?.role === "primary") throw new Error("\u0644\u0627 \u064A\u0645\u0643\u0646 \u062D\u0630\u0641 \u0627\u0644\u0645\u0627\u0644\u0643 \u0627\u0644\u0623\u0633\u0627\u0633\u064A.");
  if (!owner) return false;
  store.owners.delete(telegramId);
  return true;
}
async function updateCleanupInactiveDays(days) {
  if (!isValidCleanupDays(days)) throw new Error("\u0645\u062F\u0629 \u0627\u0644\u062A\u0646\u0638\u064A\u0641 \u064A\u062C\u0628 \u0623\u0646 \u062A\u0643\u0648\u0646 \u0628\u064A\u0646 7 \u0648365 \u064A\u0648\u0645\u0627\u064B.");
  store.settings = { ...store.settings, cleanupInactiveDays: days, updatedAt: /* @__PURE__ */ new Date() };
}
async function recentErrors(limit = 20) {
  return [...store.errors].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()).slice(0, limit);
}
async function cleanupBotData() {
  const now = Date.now();
  const inactiveBefore = cleanupInactiveBefore(store.settings.cleanupInactiveDays, now);
  const ownerIds = new Set(store.owners.keys());
  const staleUsers = Array.from(store.users.values()).filter((user) => user.status === "active" && user.lastActivityAt < inactiveBefore && !ownerIds.has(user.telegramId));
  for (const user of staleUsers) {
    store.users.delete(user.telegramId);
    store.jobs.forEach((job) => {
      if (job.telegramId === user.telegramId) store.jobs.delete(job.id);
    });
    store.errors = store.errors.filter((error) => error.telegramId !== user.telegramId);
  }
  store.jobs.forEach((job, id) => {
    if (job.expiresAt.getTime() < now) store.jobs.delete(id);
  });
  const errorBefore = Date.now() - 30 * 864e5;
  store.errors = store.errors.filter((error) => error.createdAt.getTime() >= errorBefore);
  store.processedUpdateIds.clear();
  return { removedInactiveUsers: staleUsers.length };
}
async function activeRecipients() {
  return Array.from(store.users.values()).filter((user) => user.status === "active").map((user) => ({ telegramId: user.telegramId }));
}
async function listForcedSubscriptions() {
  await ensureSubscriptionsLoaded();
  return Array.from(store.subscriptions.values()).sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
}
async function addForcedSubscription(input) {
  await ensureSubscriptionsLoaded();
  const normalized = input.target.trim();
  const existing = Array.from(store.subscriptions.values()).find((subscription2) => subscription2.target === normalized);
  if (existing) return false;
  const subscription = {
    ...input,
    target: normalized,
    id: nanoid(12),
    createdAt: /* @__PURE__ */ new Date()
  };
  store.subscriptions.set(subscription.id, subscription);
  await saveSubscriptionsToDisk();
  return true;
}
async function removeForcedSubscription(identifier) {
  await ensureSubscriptionsLoaded();
  const cleaned = identifier.trim().replace(/^https:\/\/t\.me\//, "").replace(/^@/, "");
  const subscription = Array.from(store.subscriptions.values()).find((candidate) => candidate.id === identifier.trim() || candidate.target === cleaned || candidate.label === identifier.trim());
  if (!subscription) return false;
  store.subscriptions.delete(subscription.id);
  await saveSubscriptionsToDisk();
  return true;
}
async function findForcedSubscription(target) {
  await ensureSubscriptionsLoaded();
  const normalized = target.replace(/^@/, "");
  return Array.from(store.subscriptions.values()).find((subscription) => subscription.target.replace(/^@/, "") === normalized);
}
async function cleanupStaleJobs() {
  const now = Date.now();
  store.jobs.forEach((job, id) => {
    if (["inspecting", "ready", "downloading"].includes(job.status) || job.expiresAt.getTime() < now) {
      store.jobs.delete(id);
    }
  });
}
var DEFAULT_SETTINGS, store, subscriptionsPersistenceReady, subscriptionsWriteChain;
var init_botDb = __esm({
  "server/telegram/botDb.ts"() {
    "use strict";
    init_policy();
    DEFAULT_SETTINGS = {
      maxUsers: 100,
      cleanupInactiveDays: 30,
      cleanupTempMinutes: 60,
      broadcastRatePerSecond: 20,
      notifyNewUsers: true
    };
    store = {
      settings: { id: 1, ...DEFAULT_SETTINGS, updatedAt: /* @__PURE__ */ new Date() },
      users: /* @__PURE__ */ new Map(),
      owners: /* @__PURE__ */ new Map(),
      jobs: /* @__PURE__ */ new Map(),
      errors: [],
      subscriptions: /* @__PURE__ */ new Map(),
      processedUpdateIds: /* @__PURE__ */ new Set(),
      nextUserId: 1,
      nextErrorId: 1
    };
    subscriptionsWriteChain = Promise.resolve();
  }
});

// server/_core/index.ts
import "dotenv/config";
import express2 from "express";
import { createServer } from "http";
import net2 from "net";
import { createExpressMiddleware } from "@trpc/server/adapters/express";

// shared/const.ts
var COOKIE_NAME = "app_session_id";
var ONE_YEAR_MS = 1e3 * 60 * 60 * 24 * 365;
var AXIOS_TIMEOUT_MS = 3e4;
var UNAUTHED_ERR_MSG = "Please login (10001)";
var NOT_ADMIN_ERR_MSG = "You do not have required permission (10002)";
var OAUTH_STATE_COOKIE = "__Host-oauth_state";
var decodeOAuthState = (state) => {
  let decoded;
  try {
    decoded = atob(state);
  } catch {
    return { redirectUri: "" };
  }
  try {
    const parsed = JSON.parse(decoded);
    if (parsed && typeof parsed.redirectUri === "string") return parsed;
  } catch {
  }
  return { redirectUri: decoded };
};

// server/_core/oauth.ts
import { parse as parseCookieHeader2 } from "cookie";

// server/db.ts
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";

// drizzle/schema.ts
import { boolean, index, int, mysqlEnum, mysqlTable, text, timestamp, uniqueIndex, varchar } from "drizzle-orm/mysql-core";
var users = mysqlTable("users", {
  /**
   * Surrogate primary key. Auto-incremented numeric value managed by the database.
   * Use this for relations between tables.
   */
  id: int("id").autoincrement().primaryKey(),
  /** Manus OAuth identifier (openId) returned from the OAuth callback. Unique per user. */
  openId: varchar("openId", { length: 64 }).notNull().unique(),
  name: text("name"),
  email: varchar("email", { length: 320 }),
  loginMethod: varchar("loginMethod", { length: 64 }),
  role: mysqlEnum("role", ["user", "admin"]).default("user").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  lastSignedIn: timestamp("lastSignedIn").defaultNow().notNull()
});
var telegramUsers = mysqlTable("telegram_users", {
  id: int("id").autoincrement().primaryKey(),
  telegramId: varchar("telegram_id", { length: 32 }).notNull(),
  username: varchar("username", { length: 64 }),
  displayName: varchar("display_name", { length: 160 }).notNull(),
  languageCode: varchar("language_code", { length: 16 }),
  status: mysqlEnum("status", ["active", "blocked"]).notNull().default("active"),
  firstSeenAt: timestamp("first_seen_at").defaultNow().notNull(),
  lastSeenAt: timestamp("last_seen_at").defaultNow().notNull(),
  lastActivityAt: timestamp("last_activity_at").defaultNow().notNull()
}, (table) => [
  uniqueIndex("telegram_users_telegram_id_unique").on(table.telegramId),
  index("telegram_users_activity_idx").on(table.lastActivityAt),
  index("telegram_users_status_idx").on(table.status)
]);
var botOwners = mysqlTable("bot_owners", {
  id: int("id").autoincrement().primaryKey(),
  telegramId: varchar("telegram_id", { length: 32 }).notNull(),
  role: mysqlEnum("role", ["primary", "owner"]).notNull().default("owner"),
  addedAt: timestamp("added_at").defaultNow().notNull(),
  addedByTelegramId: varchar("added_by_telegram_id", { length: 32 })
}, (table) => [uniqueIndex("bot_owners_telegram_id_unique").on(table.telegramId)]);
var botSettings = mysqlTable("bot_settings", {
  id: int("id").primaryKey(),
  maxUsers: int("max_users").notNull().default(100),
  cleanupInactiveDays: int("cleanup_inactive_days").notNull().default(30),
  cleanupTempMinutes: int("cleanup_temp_minutes").notNull().default(60),
  broadcastRatePerSecond: int("broadcast_rate_per_second").notNull().default(20),
  notifyNewUsers: boolean("notify_new_users").notNull().default(true),
  updatedAt: timestamp("updated_at").defaultNow().onUpdateNow().notNull()
});
var botJobs = mysqlTable("bot_jobs", {
  id: varchar("id", { length: 24 }).primaryKey(),
  telegramId: varchar("telegram_id", { length: 32 }).notNull(),
  sourceUrl: varchar("source_url", { length: 2048 }).notNull(),
  platform: varchar("platform", { length: 24 }).notNull(),
  status: mysqlEnum("status", ["inspecting", "ready", "downloading", "sent", "cancelled", "failed", "expired"]).notNull().default("inspecting"),
  choicesJson: text("choices_json"),
  selectedChoice: varchar("selected_choice", { length: 16 }),
  cancelRequested: boolean("cancel_requested").notNull().default(false),
  expiresAt: timestamp("expires_at").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().onUpdateNow().notNull()
}, (table) => [
  index("bot_jobs_expiry_idx").on(table.expiresAt),
  index("bot_jobs_user_status_idx").on(table.telegramId, table.status)
]);
var botErrors = mysqlTable("bot_errors", {
  id: int("id").autoincrement().primaryKey(),
  telegramId: varchar("telegram_id", { length: 32 }),
  sourceUrl: varchar("source_url", { length: 2048 }),
  stage: varchar("stage", { length: 64 }).notNull(),
  message: text("message").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull()
}, (table) => [index("bot_errors_created_idx").on(table.createdAt)]);
var processedTelegramUpdates = mysqlTable("processed_telegram_updates", {
  updateId: int("update_id").primaryKey(),
  processedAt: timestamp("processed_at").defaultNow().notNull()
});

// server/_core/env.ts
var ENV = {
  appId: process.env.VITE_APP_ID ?? "",
  cookieSecret: process.env.JWT_SECRET ?? "",
  databaseUrl: process.env.DATABASE_URL ?? "",
  oAuthServerUrl: process.env.OAUTH_SERVER_URL ?? "",
  ownerOpenId: process.env.OWNER_OPEN_ID ?? "",
  isProduction: process.env.NODE_ENV === "production",
  forgeApiUrl: process.env.BUILT_IN_FORGE_API_URL ?? "",
  forgeApiKey: process.env.BUILT_IN_FORGE_API_KEY ?? ""
};

// server/db.ts
var _db = null;
async function getDb() {
  if (!_db && process.env.DATABASE_URL) {
    try {
      _db = drizzle(process.env.DATABASE_URL);
    } catch (error) {
      console.warn("[Database] Failed to connect:", error);
      _db = null;
    }
  }
  return _db;
}
async function upsertUser(user) {
  if (!user.openId) {
    throw new Error("User openId is required for upsert");
  }
  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot upsert user: database not available");
    return;
  }
  try {
    const values = {
      openId: user.openId
    };
    const updateSet = {};
    const textFields = ["name", "email", "loginMethod"];
    const assignNullable = (field) => {
      const value = user[field];
      if (value === void 0) return;
      const normalized = value ?? null;
      values[field] = normalized;
      updateSet[field] = normalized;
    };
    textFields.forEach(assignNullable);
    if (user.lastSignedIn !== void 0) {
      values.lastSignedIn = user.lastSignedIn;
      updateSet.lastSignedIn = user.lastSignedIn;
    }
    if (user.role !== void 0) {
      values.role = user.role;
      updateSet.role = user.role;
    } else if (user.openId === ENV.ownerOpenId) {
      values.role = "admin";
      updateSet.role = "admin";
    }
    if (!values.lastSignedIn) {
      values.lastSignedIn = /* @__PURE__ */ new Date();
    }
    if (Object.keys(updateSet).length === 0) {
      updateSet.lastSignedIn = /* @__PURE__ */ new Date();
    }
    await db.insert(users).values(values).onDuplicateKeyUpdate({
      set: updateSet
    });
  } catch (error) {
    console.error("[Database] Failed to upsert user:", error);
    throw error;
  }
}
async function getUserByOpenId(openId) {
  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot get user: database not available");
    return void 0;
  }
  const result = await db.select().from(users).where(eq(users.openId, openId)).limit(1);
  return result.length > 0 ? result[0] : void 0;
}

// server/_core/cookies.ts
function isSecureRequest(req) {
  if (req.protocol === "https") return true;
  const forwardedProto = req.headers["x-forwarded-proto"];
  if (!forwardedProto) return false;
  const protoList = Array.isArray(forwardedProto) ? forwardedProto : forwardedProto.split(",");
  return protoList.some((proto) => proto.trim().toLowerCase() === "https");
}
function getSessionCookieOptions(req) {
  return {
    httpOnly: true,
    path: "/",
    sameSite: "none",
    secure: isSecureRequest(req)
  };
}

// shared/_core/errors.ts
var HttpError = class extends Error {
  constructor(statusCode, message) {
    super(message);
    this.statusCode = statusCode;
    this.name = "HttpError";
  }
};
var ForbiddenError = (msg) => new HttpError(403, msg);

// server/_core/sdk.ts
import axios from "axios";
import { parse as parseCookieHeader } from "cookie";
import { SignJWT, jwtVerify } from "jose";
var isNonEmptyString = (value) => typeof value === "string" && value.length > 0;
var EXCHANGE_TOKEN_PATH = `/webdev.v1.WebDevAuthPublicService/ExchangeToken`;
var GET_USER_INFO_PATH = `/webdev.v1.WebDevAuthPublicService/GetUserInfo`;
var GET_USER_INFO_WITH_JWT_PATH = `/webdev.v1.WebDevAuthPublicService/GetUserInfoWithJwt`;
var OAuthService = class {
  constructor(client) {
    this.client = client;
    console.log("[OAuth] Initialized with baseURL:", ENV.oAuthServerUrl);
    if (!ENV.oAuthServerUrl) {
      console.error(
        "[OAuth] ERROR: OAUTH_SERVER_URL is not configured! Set OAUTH_SERVER_URL environment variable."
      );
    }
  }
  decodeState(state) {
    return decodeOAuthState(state).redirectUri;
  }
  async getTokenByCode(code, state) {
    const payload = {
      clientId: ENV.appId,
      grantType: "authorization_code",
      code,
      redirectUri: this.decodeState(state)
    };
    const { data } = await this.client.post(
      EXCHANGE_TOKEN_PATH,
      payload
    );
    return data;
  }
  async getUserInfoByToken(token2) {
    const { data } = await this.client.post(
      GET_USER_INFO_PATH,
      {
        accessToken: token2.accessToken
      }
    );
    return data;
  }
};
var createOAuthHttpClient = () => axios.create({
  baseURL: ENV.oAuthServerUrl,
  timeout: AXIOS_TIMEOUT_MS
});
var SDKServer = class {
  client;
  oauthService;
  constructor(client = createOAuthHttpClient()) {
    this.client = client;
    this.oauthService = new OAuthService(this.client);
  }
  deriveLoginMethod(platforms, fallback) {
    if (fallback && fallback.length > 0) return fallback;
    if (!Array.isArray(platforms) || platforms.length === 0) return null;
    const set = new Set(
      platforms.filter((p) => typeof p === "string")
    );
    if (set.has("REGISTERED_PLATFORM_EMAIL")) return "email";
    if (set.has("REGISTERED_PLATFORM_GOOGLE")) return "google";
    if (set.has("REGISTERED_PLATFORM_APPLE")) return "apple";
    if (set.has("REGISTERED_PLATFORM_MICROSOFT") || set.has("REGISTERED_PLATFORM_AZURE"))
      return "microsoft";
    if (set.has("REGISTERED_PLATFORM_GITHUB")) return "github";
    const first = Array.from(set)[0];
    return first ? first.toLowerCase() : null;
  }
  /**
   * Exchange OAuth authorization code for access token
   * @example
   * const tokenResponse = await sdk.exchangeCodeForToken(code, state);
   */
  async exchangeCodeForToken(code, state) {
    return this.oauthService.getTokenByCode(code, state);
  }
  /**
   * Get user information using access token
   * @example
   * const userInfo = await sdk.getUserInfo(tokenResponse.accessToken);
   */
  async getUserInfo(accessToken) {
    const data = await this.oauthService.getUserInfoByToken({
      accessToken
    });
    const loginMethod = this.deriveLoginMethod(
      data?.platforms,
      data?.platform ?? data.platform ?? null
    );
    return {
      ...data,
      platform: loginMethod,
      loginMethod
    };
  }
  parseCookies(cookieHeader) {
    if (!cookieHeader) {
      return /* @__PURE__ */ new Map();
    }
    const parsed = parseCookieHeader(cookieHeader);
    return new Map(Object.entries(parsed));
  }
  getSessionSecret() {
    const secret = ENV.cookieSecret;
    return new TextEncoder().encode(secret);
  }
  /**
   * Create a session token for a Manus user openId
   * @example
   * const sessionToken = await sdk.createSessionToken(userInfo.openId);
   */
  async createSessionToken(openId, options = {}) {
    return this.signSession(
      {
        openId,
        appId: ENV.appId,
        name: options.name || ""
      },
      options
    );
  }
  async signSession(payload, options = {}) {
    const issuedAt = Date.now();
    const expiresInMs = options.expiresInMs ?? ONE_YEAR_MS;
    const expirationSeconds = Math.floor((issuedAt + expiresInMs) / 1e3);
    const secretKey = this.getSessionSecret();
    return new SignJWT({
      openId: payload.openId,
      appId: payload.appId,
      name: payload.name
    }).setProtectedHeader({ alg: "HS256", typ: "JWT" }).setExpirationTime(expirationSeconds).sign(secretKey);
  }
  async verifySession(cookieValue) {
    if (!cookieValue) {
      console.warn("[Auth] Missing session cookie");
      return null;
    }
    try {
      const secretKey = this.getSessionSecret();
      const { payload } = await jwtVerify(cookieValue, secretKey, {
        algorithms: ["HS256"]
      });
      const { openId, appId, name } = payload;
      if (!isNonEmptyString(openId) || !isNonEmptyString(appId) || !isNonEmptyString(name)) {
        console.warn("[Auth] Session payload missing required fields");
        return null;
      }
      return {
        openId,
        appId,
        name
      };
    } catch (error) {
      console.warn("[Auth] Session verification failed", String(error));
      return null;
    }
  }
  async getUserInfoWithJwt(jwtToken) {
    const payload = {
      jwtToken,
      projectId: ENV.appId
    };
    const { data } = await this.client.post(
      GET_USER_INFO_WITH_JWT_PATH,
      payload
    );
    const loginMethod = this.deriveLoginMethod(
      data?.platforms,
      data?.platform ?? data.platform ?? null
    );
    return {
      ...data,
      platform: loginMethod,
      loginMethod
    };
  }
  async authenticateRequest(req) {
    const cookies = this.parseCookies(req.headers.cookie);
    let sessionToken = cookies.get(COOKIE_NAME);
    if (!sessionToken) {
      const authHeader = req.headers.authorization;
      if (typeof authHeader === "string" && authHeader.startsWith("Bearer ")) {
        sessionToken = authHeader.slice(7);
      }
    }
    const session = await this.verifySession(sessionToken);
    if (!session) {
      throw ForbiddenError("Invalid session cookie");
    }
    if (session.openId.startsWith(CRON_OPEN_ID_PREFIX)) {
      const userInfo = await this.getUserInfoWithJwt(sessionToken ?? "");
      const taskUid = userInfo.taskUid ?? null;
      if (!taskUid) {
        throw ForbiddenError("Cron session missing task_uid");
      }
      return buildCronUser(userInfo);
    }
    const sessionUserId = session.openId;
    const signedInAt = /* @__PURE__ */ new Date();
    let user = await getUserByOpenId(sessionUserId);
    if (!user) {
      try {
        const userInfo = await this.getUserInfoWithJwt(sessionToken ?? "");
        await upsertUser({
          openId: userInfo.openId,
          name: userInfo.name || null,
          email: userInfo.email ?? null,
          loginMethod: userInfo.loginMethod ?? userInfo.platform ?? null,
          lastSignedIn: signedInAt
        });
        user = await getUserByOpenId(userInfo.openId);
      } catch (error) {
        console.error("[Auth] Failed to sync user from OAuth:", error);
        throw ForbiddenError("Failed to sync user info");
      }
    }
    if (!user) {
      throw ForbiddenError("User not found");
    }
    await upsertUser({
      openId: user.openId,
      lastSignedIn: signedInAt
    });
    return user;
  }
};
var CRON_OPEN_ID_PREFIX = "cron_";
function buildCronUser(userInfo) {
  const now = /* @__PURE__ */ new Date();
  return {
    id: -1,
    openId: userInfo.openId,
    name: userInfo.name || "Manus Scheduled Task",
    email: null,
    loginMethod: null,
    role: "user",
    createdAt: now,
    updatedAt: now,
    lastSignedIn: now,
    taskUid: userInfo.taskUid ?? void 0,
    isCron: true
  };
}
var sdk = new SDKServer();

// server/_core/oauth.ts
function getQueryParam(req, key) {
  const value = req.query[key];
  return typeof value === "string" ? value : void 0;
}
function registerOAuthRoutes(app) {
  app.get("/api/oauth/callback", async (req, res) => {
    const code = getQueryParam(req, "code");
    const state = getQueryParam(req, "state");
    if (!code || !state) {
      res.status(400).json({ error: "code and state are required" });
      return;
    }
    const { nonce } = decodeOAuthState(state);
    const expectedNonce = parseCookieHeader2(req.headers.cookie ?? "")[OAUTH_STATE_COOKIE];
    if (!nonce || nonce !== expectedNonce) {
      res.status(403).json({ error: "invalid oauth state" });
      return;
    }
    res.clearCookie(OAUTH_STATE_COOKIE, { path: "/", secure: true, sameSite: "none" });
    try {
      const tokenResponse = await sdk.exchangeCodeForToken(code, state);
      const userInfo = await sdk.getUserInfo(tokenResponse.accessToken);
      if (!userInfo.openId) {
        res.status(400).json({ error: "openId missing from user info" });
        return;
      }
      await upsertUser({
        openId: userInfo.openId,
        name: userInfo.name || null,
        email: userInfo.email ?? null,
        loginMethod: userInfo.loginMethod ?? userInfo.platform ?? null,
        lastSignedIn: /* @__PURE__ */ new Date()
      });
      const sessionToken = await sdk.createSessionToken(userInfo.openId, {
        name: userInfo.name || "",
        expiresInMs: ONE_YEAR_MS
      });
      const cookieOptions = getSessionCookieOptions(req);
      res.cookie(COOKIE_NAME, sessionToken, { ...cookieOptions, maxAge: ONE_YEAR_MS });
      res.redirect(302, "/");
    } catch (error) {
      console.error("[OAuth] Callback failed", error);
      res.status(500).json({ error: "OAuth callback failed" });
    }
  });
}

// server/_core/storageProxy.ts
function registerStorageProxy(app) {
  app.get("/manus-storage/*", async (req, res) => {
    const key = req.params[0];
    if (!key) {
      res.status(400).send("Missing storage key");
      return;
    }
    if (!ENV.forgeApiUrl || !ENV.forgeApiKey) {
      res.status(500).send("Storage proxy not configured");
      return;
    }
    try {
      const forgeUrl = new URL(
        "v1/storage/presign/get",
        ENV.forgeApiUrl.replace(/\/+$/, "") + "/"
      );
      forgeUrl.searchParams.set("path", key);
      const forgeResp = await fetch(forgeUrl, {
        headers: { Authorization: `Bearer ${ENV.forgeApiKey}` }
      });
      if (!forgeResp.ok) {
        const body = await forgeResp.text().catch(() => "");
        console.error(`[StorageProxy] forge error: ${forgeResp.status} ${body}`);
        res.status(502).send("Storage backend error");
        return;
      }
      const { url } = await forgeResp.json();
      if (!url) {
        res.status(502).send("Empty signed URL from backend");
        return;
      }
      res.set("Cache-Control", "no-store");
      res.redirect(307, url);
    } catch (err) {
      console.error("[StorageProxy] failed:", err);
      res.status(502).send("Storage proxy error");
    }
  });
}

// server/_core/systemRouter.ts
import { z } from "zod";

// server/_core/notification.ts
import { TRPCError } from "@trpc/server";
var TITLE_MAX_LENGTH = 1200;
var CONTENT_MAX_LENGTH = 2e4;
var trimValue = (value) => value.trim();
var isNonEmptyString2 = (value) => typeof value === "string" && value.trim().length > 0;
var buildEndpointUrl = (baseUrl) => {
  const normalizedBase = baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
  return new URL(
    "webdevtoken.v1.WebDevService/SendNotification",
    normalizedBase
  ).toString();
};
var validatePayload = (input) => {
  if (!isNonEmptyString2(input.title)) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Notification title is required."
    });
  }
  if (!isNonEmptyString2(input.content)) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Notification content is required."
    });
  }
  const title = trimValue(input.title);
  const content = trimValue(input.content);
  if (title.length > TITLE_MAX_LENGTH) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: `Notification title must be at most ${TITLE_MAX_LENGTH} characters.`
    });
  }
  if (content.length > CONTENT_MAX_LENGTH) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: `Notification content must be at most ${CONTENT_MAX_LENGTH} characters.`
    });
  }
  return { title, content };
};
async function notifyOwner(payload) {
  const { title, content } = validatePayload(payload);
  if (!ENV.forgeApiUrl) {
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Notification service URL is not configured."
    });
  }
  if (!ENV.forgeApiKey) {
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Notification service API key is not configured."
    });
  }
  const endpoint = buildEndpointUrl(ENV.forgeApiUrl);
  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        accept: "application/json",
        authorization: `Bearer ${ENV.forgeApiKey}`,
        "content-type": "application/json",
        "connect-protocol-version": "1"
      },
      body: JSON.stringify({ title, content })
    });
    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      console.warn(
        `[Notification] Failed to notify owner (${response.status} ${response.statusText})${detail ? `: ${detail}` : ""}`
      );
      return false;
    }
    return true;
  } catch (error) {
    console.warn("[Notification] Error calling notification service:", error);
    return false;
  }
}

// server/_core/trpc.ts
import { initTRPC, TRPCError as TRPCError2 } from "@trpc/server";
import superjson from "superjson";
var t = initTRPC.context().create({
  transformer: superjson
});
var router = t.router;
var publicProcedure = t.procedure;
var requireUser = t.middleware(async (opts) => {
  const { ctx, next } = opts;
  if (!ctx.user) {
    throw new TRPCError2({ code: "UNAUTHORIZED", message: UNAUTHED_ERR_MSG });
  }
  return next({
    ctx: {
      ...ctx,
      user: ctx.user
    }
  });
});
var protectedProcedure = t.procedure.use(requireUser);
var adminProcedure = t.procedure.use(
  t.middleware(async (opts) => {
    const { ctx, next } = opts;
    if (!ctx.user || ctx.user.role !== "admin") {
      throw new TRPCError2({ code: "FORBIDDEN", message: NOT_ADMIN_ERR_MSG });
    }
    return next({
      ctx: {
        ...ctx,
        user: ctx.user
      }
    });
  })
);

// server/_core/systemRouter.ts
var systemRouter = router({
  health: publicProcedure.input(
    z.object({
      timestamp: z.number().min(0, "timestamp cannot be negative")
    })
  ).query(() => ({
    ok: true
  })),
  notifyOwner: adminProcedure.input(
    z.object({
      title: z.string().min(1, "title is required"),
      content: z.string().min(1, "content is required")
    })
  ).mutation(async ({ input }) => {
    const delivered = await notifyOwner(input);
    return {
      success: delivered
    };
  })
});

// server/telegram/secrets.ts
import { createHmac } from "node:crypto";

// server/telegram/validation.ts
import { timingSafeEqual } from "node:crypto";
var PLATFORM_HOSTS = {
  tiktok: ["tiktok.com"],
  instagram: ["instagram.com"],
  facebook: ["facebook.com", "fb.watch"],
  snapchat: ["snapchat.com"],
  pinterest: ["pinterest.com", "pin.it"],
  twitter: ["twitter.com", "x.com"]
};
var PublicLinkError = class extends Error {
  constructor(message) {
    super(message);
    this.name = "PublicLinkError";
  }
};
function belongsToHost(hostname, host) {
  return hostname === host || hostname.endsWith(`.${host}`);
}
function normalizeTikTokMediaUrl(input) {
  const url = new URL(input.toString());
  if (/^(?:www\.)?(?:tiktok\.com|vt\.tiktok\.com|vm\.tiktok\.com)$/i.test(url.hostname) && /^\/(@[^/]+\/)?photo\/\d+\/?$/i.test(url.pathname)) {
    url.pathname = url.pathname.replace(/\/photo\//i, "/video/");
  }
  return url;
}
function inspectSupportedUrl(rawUrl) {
  let url;
  try {
    url = new URL(rawUrl.trim());
  } catch {
    throw new PublicLinkError("\u0623\u0631\u0633\u0644 \u0631\u0627\u0628\u0637\u0627\u064B \u0635\u062D\u064A\u062D\u0627\u064B \u064A\u0628\u062F\u0623 \u0628\u0640 https:// \u0645\u0646 \u0645\u0646\u0635\u0629 \u0645\u062F\u0639\u0648\u0645\u0629.");
  }
  if (url.protocol !== "https:") {
    throw new PublicLinkError("\u064A\u064F\u0642\u0628\u0644 \u0641\u0642\u0637 \u0631\u0627\u0628\u0637 HTTPS \u0639\u0627\u0645 \u0645\u0646 \u0645\u0646\u0635\u0629 \u0645\u062F\u0639\u0648\u0645\u0629.");
  }
  const hostname = url.hostname.toLowerCase().replace(/^www\./, "");
  for (const [platform, hosts] of Object.entries(PLATFORM_HOSTS)) {
    if (hosts.some((host) => belongsToHost(hostname, host))) {
      if (platform === "pinterest") {
        const isShortPin = hostname === "pin.it" && url.pathname.length > 1;
        const isPinterestPin = hostname !== "pin.it" && /^\/pin\/[^/]+\/?$/i.test(url.pathname);
        if (!isShortPin && !isPinterestPin) {
          throw new PublicLinkError("\u064A\u062F\u0639\u0645 Pinterest \u0631\u0648\u0627\u0628\u0637 Pin \u0627\u0644\u0639\u0627\u0645\u0629 \u0641\u0642\u0637\u060C \u0645\u062B\u0644 https://pin.it/... \u0623\u0648 https://www.pinterest.com/pin/...");
        }
      }
      if (platform === "twitter") {
        const isStatus = /^\/[^/]+\/status\/\d+(?:\/photo\/\d+)?\/?$/i.test(url.pathname);
        const isShortStatus = /^\/i\/web\/status\/\d+\/?$/i.test(url.pathname);
        if (!isStatus && !isShortStatus) {
          throw new PublicLinkError("\u064A\u062F\u0639\u0645 Twitter/X \u0631\u0648\u0627\u0628\u0637 \u0627\u0644\u0645\u0646\u0634\u0648\u0631\u0627\u062A \u0627\u0644\u0639\u0627\u0645\u0629 \u0641\u0642\u0637\u060C \u0645\u062B\u0644 https://x.com/user/status/123. \u0623\u0631\u0633\u0644 \u0631\u0627\u0628\u0637 \u0627\u0644\u0645\u0646\u0634\u0648\u0631 \u0648\u0644\u064A\u0633 \u0635\u0641\u062D\u0629 \u0627\u0644\u062D\u0633\u0627\u0628.");
        }
      }
      if (platform === "snapchat") {
        const isSharedSnap = /^\/t\/[A-Za-z0-9_-]{4,80}\/?$/i.test(url.pathname);
        const isSpotlightOrStory = /^\/(?:@[^/]+\/)?(?:spotlight|highlight)\/[^/]+\/?$/i.test(url.pathname);
        if (!isSharedSnap && !isSpotlightOrStory) {
          throw new PublicLinkError("\u064A\u062F\u0639\u0645 Snapchat \u0631\u0648\u0627\u0628\u0637 Spotlight \u0648Story \u0627\u0644\u0639\u0627\u0645\u0629 \u0623\u0648 \u0631\u0627\u0628\u0637 \u0627\u0644\u0645\u0634\u0627\u0631\u0643\u0629 /t/ \u0641\u0642\u0637. \u0644\u0627 \u064A\u0645\u0643\u0646 \u062A\u0646\u0632\u064A\u0644 \u0627\u0644\u062D\u0633\u0627\u0628\u0627\u062A \u0623\u0648 \u0627\u0644\u0642\u0635\u0635 \u0627\u0644\u062E\u0627\u0635\u0629.");
        }
      }
      if (platform === "tiktok") url = normalizeTikTokMediaUrl(url);
      return { url, platform };
    }
  }
  throw new PublicLinkError("\u0647\u0630\u0627 \u0627\u0644\u0631\u0627\u0628\u0637 \u063A\u064A\u0631 \u0645\u062F\u0639\u0648\u0645. \u0623\u0631\u0633\u0644 \u0631\u0627\u0628\u0637\u0627\u064B \u0639\u0627\u0645\u0627\u064B \u0645\u0646 TikTok \u0623\u0648 Instagram \u0623\u0648 Facebook \u0623\u0648 Snapchat \u0623\u0648 Pinterest \u0623\u0648 Twitter/X.");
}
function detectStoryLink(rawUrl) {
  try {
    const url = new URL(rawUrl);
    const hostname = url.hostname.toLowerCase().replace(/^www\./, "");
    const path6 = url.pathname.toLowerCase();
    if (belongsToHost(hostname, "instagram.com")) return /^\/stories\//.test(path6);
    if (belongsToHost(hostname, "facebook.com")) return path6.includes("/stories/") || path6.startsWith("/stories");
    if (belongsToHost(hostname, "snapchat.com")) {
      return /^\/(?:@[^/]+\/)?(?:spotlight|highlight)\//.test(path6) || /^\/t\//.test(path6);
    }
    return false;
  } catch {
    return false;
  }
}
function isSafeWebhookSecret(value) {
  return Boolean(value && /^[A-Za-z0-9_-]{1,256}$/.test(value));
}
function matchesWebhookSecret(expected, supplied) {
  if (!isSafeWebhookSecret(expected) || typeof supplied !== "string") return false;
  const expectedValue = Buffer.from(expected);
  const suppliedValue = Buffer.from(supplied);
  return expectedValue.length === suppliedValue.length && timingSafeEqual(expectedValue, suppliedValue);
}
function parseSubscriptionTarget(rawInput) {
  const input = rawInput.trim();
  if (!input) throw new PublicLinkError("\u0623\u0631\u0633\u0644 \u0645\u0639\u0631\u0651\u0641 \u0627\u0644\u0642\u0646\u0627\u0629 \u0623\u0648 @username \u0623\u0648 \u0631\u0627\u0628\u0637 t.me.");
  let target;
  let inviteUrl;
  const tmeMatch = input.match(/^(?:https?:\/\/)?(?:www\.)?(?:t|telegram)\.me\/([^\s/?]+)/i);
  if (tmeMatch) {
    const rawName = tmeMatch[1].replace(/^@/, "");
    if (rawName.startsWith("+") || /^joinchat\//.test(rawName)) {
      throw new PublicLinkError("\u0631\u0648\u0627\u0628\u0637 \u0627\u0644\u062F\u0639\u0648\u0629 \u0627\u0644\u062E\u0627\u0635\u0629 (+...) \u0644\u0627 \u064A\u0645\u0643\u0646 \u0641\u062D\u0635 \u0627\u0644\u0627\u0634\u062A\u0631\u0627\u0643 \u0645\u0646\u0647\u0627. \u0623\u0631\u0633\u0644 @username \u0623\u0648 \u0627\u0644\u0645\u0639\u0631\u0651\u0641 \u0627\u0644\u0631\u0642\u0645\u064A \u0644\u0644\u0642\u0646\u0627\u0629 \u0628\u062F\u0644\u0627\u064B \u0645\u0646\u0647\u0627.");
    }
    target = rawName;
    inviteUrl = `https://t.me/${rawName}`;
  } else if (input.startsWith("@")) {
    target = input.slice(1);
    if (!/^[A-Za-z0-9_]{4,32}$/.test(target)) throw new PublicLinkError("\u0627\u0633\u0645 \u0627\u0644\u0645\u0633\u062A\u062E\u062F\u0645 \u063A\u064A\u0631 \u0635\u0627\u0644\u062D \u062F\u0627\u062E\u0644 Telegram.");
    inviteUrl = `https://t.me/${target}`;
  } else if (/^-?\d{6,}$/.test(input)) {
    target = input;
    inviteUrl = "";
  } else {
    if (!/^[A-Za-z0-9_]{4,32}$/.test(input)) throw new PublicLinkError("\u0627\u0633\u0645 \u0627\u0644\u0645\u0633\u062A\u062E\u062F\u0645 \u063A\u064A\u0631 \u0635\u0627\u0644\u062D \u062F\u0627\u062E\u0644 Telegram.");
    target = input;
    inviteUrl = `https://t.me/${input}`;
  }
  const kind = resolveSubscriptionKind(target);
  const label = inviteUrl ? `@${target}` : `ID: ${target}`;
  return { target, inviteUrl, label, kind };
}
function resolveSubscriptionKind(target) {
  if (/^-100\d+$/.test(target)) return "channel";
  if (/^-\d+$/.test(target)) return "group";
  if (/[bB]ot$/.test(target)) return "bot";
  return "channel";
}

// server/telegram/secrets.ts
function getWebhookSecret() {
  const configured = process.env.WEBHOOK_SECRET;
  if (isSafeWebhookSecret(configured)) return configured;
  const token2 = process.env.BOT_TOKEN;
  const signingKey = process.env.JWT_SECRET;
  if (!token2 || !signingKey) return void 0;
  return createHmac("sha256", signingKey).update(`telegram-webhook:${token2}`).digest("base64url");
}

// server/telegram/telegramApi.ts
import { readFile } from "node:fs/promises";
import dns from "node:dns";
import net from "node:net";
import path from "node:path";

// server/telegram/welcomeImage.ts
import { deflateSync } from "node:zlib";
var WIDTH = 800;
var HEIGHT = 450;
function hexColor(hex) {
  const value = hex.replace("#", "");
  return {
    r: parseInt(value.slice(0, 2), 16),
    g: parseInt(value.slice(2, 4), 16),
    b: parseInt(value.slice(4, 6), 16),
    a: 1
  };
}
function createCanvas() {
  const data = new Float64Array(WIDTH * HEIGHT * 4);
  return {
    put(x, y, color) {
      const px = Math.floor(x);
      const py = Math.floor(y);
      if (px < 0 || py < 0 || px >= WIDTH || py >= HEIGHT) return;
      const index2 = (py * WIDTH + px) * 4;
      const srcA = color.a;
      if (srcA <= 0) return;
      const dstA = data[index2 + 3];
      const outA = srcA + dstA * (1 - srcA);
      if (outA <= 0) return;
      data[index2] = (color.r * srcA + data[index2] * dstA * (1 - srcA)) / outA;
      data[index2 + 1] = (color.g * srcA + data[index2 + 1] * dstA * (1 - srcA)) / outA;
      data[index2 + 2] = (color.b * srcA + data[index2 + 2] * dstA * (1 - srcA)) / outA;
      data[index2 + 3] = outA;
    },
    pixels() {
      return data;
    },
    fillRect(x, y, w, h, color) {
      for (let py = Math.floor(y); py < Math.floor(y + h); py += 1) {
        for (let px = Math.floor(x); px < Math.floor(x + w); px += 1) {
          this.put(px, py, color);
        }
      }
    },
    fillCircle(cx, cy, radius, color) {
      for (let py = Math.floor(cy - radius - 1); py <= cy + radius + 1; py += 1) {
        for (let px = Math.floor(cx - radius - 1); px <= cx + radius + 1; px += 1) {
          const dx = px - cx;
          const dy = py - cy;
          const distance = Math.sqrt(dx * dx + dy * dy);
          const edge = radius - 0.5;
          if (distance <= edge) {
            this.put(px, py, color);
          } else if (distance < radius + 0.5) {
            this.put(px, py, { ...color, a: color.a * (radius + 0.5 - distance) });
          }
        }
      }
    },
    fillTriangle(a, b, c, color) {
      const minX = Math.max(0, Math.floor(Math.min(a.x, b.x, c.x)));
      const maxX = Math.min(WIDTH - 1, Math.ceil(Math.max(a.x, b.x, c.x)));
      const minY = Math.max(0, Math.floor(Math.min(a.y, b.y, c.y)));
      const maxY = Math.min(HEIGHT - 1, Math.ceil(Math.max(a.y, b.y, c.y)));
      const sign = (p1, p2, p3) => (p1.x - p3.x) * (p2.y - p3.y) - (p2.x - p3.x) * (p1.y - p3.y);
      for (let py = minY; py <= maxY; py += 1) {
        for (let px = minX; px <= maxX; px += 1) {
          const point = { x: px + 0.5, y: py + 0.5 };
          const d1 = sign(point, a, b);
          const d2 = sign(point, b, c);
          const d3 = sign(point, c, a);
          const hasNegative = d1 < 0 || d2 < 0 || d3 < 0;
          const hasPositive = d1 > 0 || d2 > 0 || d3 > 0;
          if (!(hasNegative && hasPositive)) this.put(px, py, color);
        }
      }
    }
  };
}
function lerpColor(from, to, t2) {
  return {
    r: from.r + (to.r - from.r) * t2,
    g: from.g + (to.g - from.g) * t2,
    b: from.b + (to.b - from.b) * t2,
    a: from.a + (to.a - from.a) * t2
  };
}
function drawDownloadIcon(canvas, centerX, centerY, size, color) {
  const shaftWidth = size * 0.18;
  const shaftTop = centerY - size * 0.42;
  const shaftBottom = centerY + size * 0.05;
  const headHeight = size * 0.3;
  const headHalf = size * 0.34;
  const trayY = centerY + size * 0.22;
  const trayHeight = size * 0.12;
  const trayHalf = size * 0.48;
  canvas.fillRect(centerX - shaftWidth / 2, shaftTop, shaftWidth, shaftBottom - shaftTop, color);
  canvas.fillTriangle(
    { x: centerX - headHalf, y: centerY },
    { x: centerX + headHalf, y: centerY },
    { x: centerX, y: centerY + headHeight },
    color
  );
  canvas.fillRect(centerX - trayHalf, trayY, trayHalf * 2, trayHeight, color);
  canvas.fillRect(centerX - trayHalf, trayY + trayHeight, trayHalf * 2, size * 0.05, color);
}
function crc32(buffer) {
  let crc = 4294967295;
  for (let index2 = 0; index2 < buffer.length; index2 += 1) {
    crc ^= buffer[index2];
    for (let bit = 0; bit < 8; bit += 1) {
      crc = crc >>> 1 ^ 3988292384 & -(crc & 1);
    }
  }
  return (crc ^ 4294967295) >>> 0;
}
function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const typeBuffer = Buffer.from(type, "ascii");
  const crcBuffer = Buffer.alloc(4);
  crcBuffer.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), 0);
  return Buffer.concat([length, typeBuffer, data, crcBuffer]);
}
function encodePng(width, height, pixels) {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  const raw = Buffer.alloc(height * (1 + width * 4));
  for (let y = 0; y < height; y += 1) {
    const rowStart = y * (1 + width * 4);
    raw[rowStart] = 0;
    for (let x = 0; x < width; x += 1) {
      const index2 = (y * width + x) * 4;
      const offset = rowStart + 1 + x * 4;
      raw[offset] = Math.max(0, Math.min(255, Math.round(pixels[index2])));
      raw[offset + 1] = Math.max(0, Math.min(255, Math.round(pixels[index2 + 1])));
      raw[offset + 2] = Math.max(0, Math.min(255, Math.round(pixels[index2 + 2])));
      raw[offset + 3] = Math.max(0, Math.min(255, Math.round(pixels[index2 + 3] * 255)));
    }
  }
  const idat = deflateSync(raw, { level: 9 });
  return Buffer.concat([
    signature,
    chunk("IHDR", ihdr),
    chunk("IDAT", idat),
    chunk("IEND", Buffer.alloc(0))
  ]);
}
function renderWelcomeBanner() {
  const canvas = createCanvas();
  const topLeft = hexColor("#7C3AED");
  const bottomRight = hexColor("#EC4899");
  const gradientFlashes = [hexColor("#6366F1"), hexColor("#F43F5E")];
  for (let y = 0; y < HEIGHT; y += 1) {
    for (let x = 0; x < WIDTH; x += 1) {
      const t2 = (x / WIDTH + y / HEIGHT) / 2;
      canvas.put(x, y, lerpColor(topLeft, bottomRight, t2));
    }
  }
  const accent = hexColor("#A78BFA");
  const whiteSoft = { r: 255, g: 255, b: 255, a: 0.07 };
  const whiteSofter = { r: 255, g: 255, b: 255, a: 0.05 };
  const flashes = [
    [gradientFlashes[0], 60, 320, 340],
    [gradientFlashes[1], 720, 90, 260],
    [accent, 640, 400, 190]
  ];
  for (const [color, cx, cy, radius] of flashes) {
    const highlight = { ...color, a: 0.1 };
    canvas.fillCircle(cx, cy, radius, highlight);
    canvas.fillCircle(cx, cy, radius * 0.7, { ...color, a: 0.07 });
  }
  for (let index2 = 0; index2 < 26; index2 += 1) {
    const px = (index2 * 137 + 61) % WIDTH;
    const py = (index2 * 89 + 23) % HEIGHT;
    const radius = 4 + index2 * 31 % 14;
    canvas.fillCircle(px, py, radius, index2 % 2 === 0 ? whiteSoft : whiteSofter);
  }
  const shadow = { r: 0, g: 0, b: 0, a: 0.18 };
  const iconColor = { r: 255, g: 255, b: 255, a: 0.96 };
  drawDownloadIcon(canvas, WIDTH / 2 - 8, HEIGHT / 2 - 8, 150, shadow);
  drawDownloadIcon(canvas, WIDTH / 2, HEIGHT / 2, 150, iconColor);
  return encodePng(WIDTH, HEIGHT, canvas.pixels());
}

// server/telegram/telegramApi.ts
var API_ROOT = "https://api.telegram.org";
dns.setDefaultResultOrder("ipv4first");
net.setDefaultAutoSelectFamily(false);
var TelegramApiError = class extends Error {
  constructor(message) {
    super(message);
    this.name = "TelegramApiError";
  }
};
function token() {
  const value = process.env.BOT_TOKEN;
  if (!value) throw new TelegramApiError("\u0644\u0645 \u064A\u062A\u0645 \u0625\u0639\u062F\u0627\u062F BOT_TOKEN \u0628\u0639\u062F.");
  return value;
}
async function telegramRequest(method, body, headers, timeoutMs = 2e4) {
  const response = await fetch(`${API_ROOT}/bot${token()}/${method}`, {
    method: "POST",
    headers,
    body,
    signal: AbortSignal.timeout(timeoutMs)
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok || !payload?.ok) {
    throw new TelegramApiError(payload?.description || `\u0641\u0634\u0644 Telegram API \u0641\u064A ${method}.`);
  }
  return payload.result;
}
async function sendMessage(chatId, text2, options = {}) {
  return telegramRequest(
    "sendMessage",
    JSON.stringify({
      chat_id: chatId,
      text: text2,
      parse_mode: "HTML",
      disable_web_page_preview: options.disablePreview ?? true,
      reply_markup: options.replyMarkup
    }),
    { "content-type": "application/json" }
  );
}
async function sendChatAction(chatId, action) {
  return telegramRequest(
    "sendChatAction",
    JSON.stringify({ chat_id: chatId, action }),
    { "content-type": "application/json" }
  );
}
async function answerCallbackQuery(callbackQueryId, text2) {
  return telegramRequest(
    "answerCallbackQuery",
    JSON.stringify({ callback_query_id: callbackQueryId, text: text2, show_alert: false }),
    { "content-type": "application/json" }
  );
}
async function sendDownloadedMedia(chatId, choice, localPath, caption) {
  const file = await readFile(localPath);
  const form = new FormData();
  form.set("chat_id", chatId);
  form.set("caption", caption);
  form.set("parse_mode", "HTML");
  const field = choice === "image" ? "photo" : choice === "audio" ? "audio" : "video";
  const method = choice === "image" ? "sendPhoto" : choice === "audio" ? "sendAudio" : "sendVideo";
  form.set(field, new Blob([file]), path.basename(localPath));
  return telegramRequest(method, form);
}
async function getChatMember(chatId, userId) {
  return telegramRequest(
    "getChatMember",
    JSON.stringify({ chat_id: chatId, user_id: userId }),
    { "content-type": "application/json" }
  );
}
async function sendPhoto(chatId, photo, caption = "") {
  const form = new FormData();
  form.set("chat_id", chatId);
  if (caption) {
    form.set("caption", caption);
    form.set("parse_mode", "HTML");
  }
  if ("url" in photo) {
    form.set("photo", photo.url);
  } else {
    form.set("photo", new Blob([photo.buffer]), "welcome.png");
  }
  return telegramRequest("sendPhoto", form);
}
async function sendWelcomePhoto(chatId) {
  if ((process.env.WELCOME_DISABLE_PHOTO || "").trim() === "1") return false;
  const customUrl = process.env.WELCOME_PHOTO_URL?.trim();
  if (customUrl) {
    await sendPhoto(chatId, { url: customUrl });
    return true;
  }
  await sendPhoto(chatId, { buffer: renderWelcomeBanner() });
  return true;
}
async function sendMediaGroup(chatId, files) {
  const CHUNK_SIZE = 10;
  let sent = 0;
  for (let start = 0; start < files.length; start += CHUNK_SIZE) {
    const chunk2 = files.slice(start, start + CHUNK_SIZE);
    const form = new FormData();
    form.set("chat_id", chatId);
    const media = chunk2.map((file, index2) => {
      const input = { type: "photo", media: `attach://file${index2}` };
      if (index2 === 0 && file.caption) {
        input.caption = file.caption;
        input.parse_mode = "HTML";
      }
      return input;
    });
    form.set("media", JSON.stringify(media));
    for (let index2 = 0; index2 < chunk2.length; index2 += 1) {
      const file = await readFile(chunk2[index2].path);
      form.set(`file${index2}`, new Blob([file]), path.basename(chunk2[index2].path));
    }
    await telegramRequest("sendMediaGroup", form);
    sent += chunk2.length;
  }
  return sent;
}
async function getWebhookInfo() {
  return telegramRequest(
    "getWebhookInfo",
    JSON.stringify({}),
    { "content-type": "application/json" }
  );
}
async function setWebhook(webhookUrl, secretToken) {
  return telegramRequest(
    "setWebhook",
    JSON.stringify({
      url: webhookUrl,
      secret_token: secretToken,
      allowed_updates: ["message", "callback_query"],
      max_connections: 10
    })
  );
}
async function deleteWebhook() {
  return telegramRequest(
    "deleteWebhook",
    JSON.stringify({ drop_pending_updates: false }),
    { "content-type": "application/json" }
  );
}
async function getUpdates(offset, timeoutSeconds = 30) {
  return telegramRequest(
    "getUpdates",
    JSON.stringify({
      offset,
      timeout: timeoutSeconds,
      allowed_updates: ["message", "callback_query"]
    }),
    { "content-type": "application/json" },
    (timeoutSeconds + 10) * 1e3
  );
}

// server/telegram/status.ts
async function getTelegramIntegrationStatus() {
  const webhookUrl = process.env.WEBHOOK_URL;
  const webhookSecret = getWebhookSecret();
  const base = {
    tokenConfigured: Boolean(process.env.BOT_TOKEN),
    ownerConfigured: Boolean(process.env.OWNER_ID && /^\d+$/.test(process.env.OWNER_ID)),
    webhookSecretConfigured: Boolean(webhookSecret),
    webhookSecretMode: process.env.WEBHOOK_SECRET ? "configured" : webhookSecret ? "derived" : "missing",
    webhookUrlConfigured: Boolean(webhookUrl && webhookUrl.startsWith("https://")),
    webhookUrlValid: Boolean(webhookUrl && /^https:\/\/.+\/api\/telegram\/webhook$/.test(webhookUrl)),
    webhookPath: "/api/telegram/webhook",
    webhookUrlMode: webhookUrl ? "configured" : "activation-derived"
  };
  if (!base.tokenConfigured) return { ...base, webhookActive: false, pendingUpdates: 0 };
  try {
    const info = await getWebhookInfo();
    return { ...base, webhookActive: Boolean(info.url), pendingUpdates: info.pending_update_count || 0 };
  } catch {
    return { ...base, webhookActive: false, pendingUpdates: 0 };
  }
}

// server/routers.ts
var appRouter = router({
  // if you need to use socket.io, read and register route in server/_core/index.ts, all api should start with '/api/' so that the gateway can route correctly
  system: systemRouter,
  auth: router({
    me: publicProcedure.query((opts) => opts.ctx.user),
    logout: publicProcedure.mutation(({ ctx }) => {
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
      return {
        success: true
      };
    })
  }),
  telegram: router({
    status: publicProcedure.query(async () => getTelegramIntegrationStatus())
  })
  // TODO: add feature routers here, e.g.
  // todo: router({
  //   list: protectedProcedure.query(({ ctx }) =>
  //     db.getUserTodos(ctx.user.id)
  //   ),
  // }),
});

// server/_core/context.ts
async function createContext(opts) {
  let user = null;
  try {
    user = await sdk.authenticateRequest(opts.req);
  } catch (error) {
    user = null;
  }
  return {
    req: opts.req,
    res: opts.res,
    user
  };
}

// server/_core/serveStatic.ts
import express from "express";
import fs from "fs";
import path2 from "path";
function serveStatic(app) {
  const distPath = process.env.NODE_ENV === "development" ? path2.resolve(import.meta.dirname, "../..", "dist", "public") : path2.resolve(import.meta.dirname, "public");
  if (!fs.existsSync(distPath)) {
    console.error(
      `Could not find the build directory: ${distPath}, make sure to build the client first`
    );
  }
  app.use(express.static(distPath));
  app.use("*", (_req, res) => {
    res.sendFile(path2.resolve(distPath, "index.html"));
  });
}

// server/telegram/botService.ts
init_botDb();

// server/telegram/downloader.ts
import { spawn as spawn2 } from "node:child_process";
import { mkdtemp, readdir, rm, stat, writeFile as writeFile2 } from "node:fs/promises";
import os from "node:os";
import path5 from "node:path";

// server/telegram/tiktokProfile.ts
import { spawn } from "node:child_process";
import path4 from "node:path";
var PROFILE_CACHE_TTL_MS = 6 * 60 * 60 * 1e3;
var profileCache = /* @__PURE__ */ new Map();
var pythonAvailable;
var TIKTOK_COUNTRY_NAMES = {
  AF: "\u0623\u0641\u063A\u0627\u0646\u0633\u062A\u0627\u0646",
  AQ: "\u0623\u0646\u062A\u0627\u0631\u0643\u062A\u064A\u0643\u0627",
  AZ: "\u0623\u0630\u0631\u0628\u064A\u062C\u0627\u0646",
  AL: "\u0623\u0644\u0628\u0627\u0646\u064A\u0627",
  AM: "\u0623\u0631\u0645\u064A\u0646\u064A\u0627",
  AS: "\u0633\u0627\u0645\u0648\u0627 \u0627\u0644\u0623\u0645\u0631\u064A\u0643\u064A\u0629",
  AU: "\u0623\u0633\u062A\u0631\u0627\u0644\u064A\u0627",
  AT: "\u0627\u0644\u0646\u0645\u0633\u0627",
  AR: "\u0627\u0644\u0623\u0631\u062C\u0646\u062A\u064A\u0646",
  AE: "\u0627\u0644\u0625\u0645\u0627\u0631\u0627\u062A",
  IQ: "\u0627\u0644\u0639\u0631\u0627\u0642",
  IR: "\u0625\u064A\u0631\u0627\u0646",
  IT: "\u0625\u064A\u0637\u0627\u0644\u064A\u0627",
  EG: "\u0645\u0635\u0631",
  DZ: "\u0627\u0644\u062C\u0632\u0627\u0626\u0631",
  MA: "\u0627\u0644\u0645\u063A\u0631\u0628",
  SA: "\u0627\u0644\u0633\u0639\u0648\u062F\u064A\u0629",
  KW: "\u0627\u0644\u0643\u0648\u064A\u062A",
  QA: "\u0642\u0637\u0631",
  BH: "\u0627\u0644\u0628\u062D\u0631\u064A\u0646",
  OM: "\u0639\u064F\u0645\u0627\u0646",
  JO: "\u0627\u0644\u0623\u0631\u062F\u0646",
  LB: "\u0644\u0628\u0646\u0627\u0646",
  SY: "\u0633\u0648\u0631\u064A\u0627",
  YE: "\u0627\u0644\u064A\u0645\u0646",
  LY: "\u0644\u064A\u0628\u064A\u0627",
  TN: "\u062A\u0648\u0646\u0633",
  SD: "\u0627\u0644\u0633\u0648\u062F\u0627\u0646",
  US: "\u0627\u0644\u0648\u0644\u0627\u064A\u0627\u062A \u0627\u0644\u0645\u062A\u062D\u062F\u0629",
  GB: "\u0627\u0644\u0645\u0645\u0644\u0643\u0629 \u0627\u0644\u0645\u062A\u062D\u062F\u0629",
  DE: "\u0623\u0644\u0645\u0627\u0646\u064A\u0627",
  FR: "\u0641\u0631\u0646\u0633\u0627",
  ES: "\u0625\u0633\u0628\u0627\u0646\u064A\u0627",
  PT: "\u0627\u0644\u0628\u0631\u062A\u063A\u0627\u0644",
  RU: "\u0631\u0648\u0633\u064A\u0627",
  TR: "\u062A\u0631\u0643\u064A\u0627",
  IN: "\u0627\u0644\u0647\u0646\u062F",
  PK: "\u0628\u0627\u0643\u0633\u062A\u0627\u0646",
  BD: "\u0628\u0646\u063A\u0644\u0627\u062F\u064A\u0634",
  ID: "\u0625\u0646\u062F\u0648\u0646\u064A\u0633\u064A\u0627",
  MY: "\u0645\u0627\u0644\u064A\u0632\u064A\u0627",
  SG: "\u0633\u0646\u063A\u0627\u0641\u0648\u0631\u0629",
  TH: "\u062A\u0627\u064A\u0644\u0627\u0646\u062F",
  VN: "\u0641\u064A\u062A\u0646\u0627\u0645",
  PH: "\u0627\u0644\u0641\u0644\u0628\u064A\u0646",
  JP: "\u0627\u0644\u064A\u0627\u0628\u0627\u0646",
  KR: "\u0643\u0648\u0631\u064A\u0627 \u0627\u0644\u062C\u0646\u0648\u0628\u064A\u0629",
  CN: "\u0627\u0644\u0635\u064A\u0646",
  CA: "\u0643\u0646\u062F\u0627",
  MX: "\u0627\u0644\u0645\u0643\u0633\u064A\u0643",
  BR: "\u0627\u0644\u0628\u0631\u0627\u0632\u064A\u0644",
  ARG: "\u0627\u0644\u0623\u0631\u062C\u0646\u062A\u064A\u0646",
  CL: "\u062A\u0634\u064A\u0644\u064A",
  CO: "\u0643\u0648\u0644\u0648\u0645\u0628\u064A\u0627",
  PE: "\u0628\u064A\u0631\u0648",
  VE: "\u0641\u0646\u0632\u0648\u064A\u0644\u0627",
  UA: "\u0623\u0648\u0643\u0631\u0627\u0646\u064A\u0627",
  PL: "\u0628\u0648\u0644\u0646\u062F\u0627",
  NL: "\u0647\u0648\u0644\u0646\u062F\u0627",
  BE: "\u0628\u0644\u062C\u064A\u0643\u0627",
  CH: "\u0633\u0648\u064A\u0633\u0631\u0627",
  SE: "\u0627\u0644\u0633\u0648\u064A\u062F",
  NO: "\u0627\u0644\u0646\u0631\u0648\u064A\u062C",
  DK: "\u0627\u0644\u062F\u0646\u0645\u0627\u0631\u0643",
  FI: "\u0641\u0646\u0644\u0646\u062F\u0627",
  GR: "\u0627\u0644\u064A\u0648\u0646\u0627\u0646",
  RO: "\u0631\u0648\u0645\u0627\u0646\u064A\u0627",
  BG: "\u0628\u0644\u063A\u0627\u0631\u064A\u0627",
  HU: "\u0627\u0644\u0645\u062C\u0631",
  CZ: "\u0627\u0644\u062A\u0634\u064A\u0643",
  SK: "\u0633\u0644\u0648\u0641\u0627\u0643\u064A\u0627",
  HR: "\u0643\u0631\u0648\u0627\u062A\u064A\u0627",
  RS: "\u0635\u0631\u0628\u064A\u0627",
  GE: "\u062C\u0648\u0631\u062C\u064A\u0627",
  NG: "\u0646\u064A\u062C\u064A\u0631\u064A\u0627",
  ZA: "\u062C\u0646\u0648\u0628 \u0623\u0641\u0631\u064A\u0642\u064A\u0627",
  ET: "\u0625\u062B\u064A\u0648\u0628\u064A\u0627",
  GH: "\u063A\u0627\u0646\u0627",
  KE: "\u0643\u064A\u0646\u064A\u0627",
  UG: "\u0623\u0648\u063A\u0646\u062F\u0627",
  TZ: "\u062A\u0646\u0632\u0627\u0646\u064A\u0627",
  CU: "\u0643\u0648\u0628\u0627",
  PR: "\u0628\u0648\u0631\u062A\u0648\u0631\u064A\u0643\u0648",
  NZ: "\u0646\u064A\u0648\u0632\u064A\u0644\u0646\u062F\u0627",
  IE: "\u0623\u064A\u0631\u0644\u0646\u062F\u0627",
  IS: "\u0622\u064A\u0633\u0644\u0646\u062F\u0627",
  IL: "\u0625\u0633\u0631\u0627\u0626\u064A\u0644",
  PS: "\u0641\u0644\u0633\u0637\u064A\u0646"
};
function countryLabel(code) {
  if (!code) return void 0;
  const normalized = String(code).trim().toUpperCase();
  return TIKTOK_COUNTRY_NAMES[normalized] || normalized;
}
function formatCount(value) {
  if (value === void 0 || value === null || Number.isNaN(value) || !Number.isFinite(value)) return void 0;
  const safe = Math.max(0, Math.floor(value));
  if (safe >= 1e6) {
    const compact = (safe / 1e6).toFixed(safe >= 1e8 ? 0 : 1).replace(/\.0$/, "");
    return `${compact} \u0645\u0644\u064A\u0648\u0646`;
  }
  if (safe >= 1e3) return `${(safe / 1e3).toFixed(safe >= 1e5 ? 0 : 1).replace(/\.0$/, "")} \u0623\u0644\u0641`;
  return String(safe);
}
function pickString(value, ...keys) {
  for (const key of keys) {
    const candidate = typeof value === "object" && value !== null ? value[key] : void 0;
    if (typeof candidate === "string" && candidate.trim()) return candidate.trim();
  }
  return void 0;
}
function pickNumber(value, ...keys) {
  for (const key of keys) {
    const candidate = typeof value === "object" && value !== null ? value[key] : void 0;
    if (typeof candidate === "number" && Number.isFinite(candidate)) return Math.floor(candidate);
    if (typeof candidate === "string" && /^\d[\d,]*$/.test(candidate.replace(/,/g, ""))) {
      const parsed = Number(candidate.replace(/,/g, ""));
      if (Number.isFinite(parsed)) return parsed;
    }
  }
  return void 0;
}
function pickBoolean(value, ...keys) {
  for (const key of keys) {
    const candidate = typeof value === "object" && value !== null ? value[key] : void 0;
    if (typeof candidate === "boolean") return candidate;
  }
  return void 0;
}
function parseTikTokUniversal(data) {
  const scope = typeof data === "object" && data !== null && data.__DEFAULT_SCOPE__ ? data.__DEFAULT_SCOPE__ : data;
  if (!scope || typeof scope !== "object") return void 0;
  const userDetail = scope["webapp.user-detail"];
  const userInfo = userDetail?.userInfo ?? void 0;
  const user = userInfo?.user ?? void 0;
  const stats = userInfo?.stats ?? void 0;
  const videoDetail = scope["webapp.video-detail"];
  const itemInfo = videoDetail?.itemInfo ?? void 0;
  const item = itemInfo?.itemStruct ?? void 0;
  const author = item?.author ?? void 0;
  const itemStats = item?.stats ?? void 0;
  const source = user ?? author ?? void 0;
  const counters = stats ?? itemStats ?? void 0;
  if (!source && !counters) return void 0;
  const usernameValue = pickString(source, "uniqueId", "unique_id", "author");
  const username = usernameValue ? usernameValue.replace(/^@/, "") : void 0;
  const nickname = pickString(source, "nickname", "channel", "uploader");
  const followers = pickNumber(source, "followerCount", "followers", "fanCount") ?? pickNumber(counters, "followerCount", "followers", "fanCount");
  const following = pickNumber(source, "followingCount", "following", "following_count") ?? pickNumber(counters, "followingCount", "following", "following_count");
  const posts = pickNumber(source, "videoCount", "video_count", "video_count_show", "awemeCount") ?? pickNumber(counters, "videoCount", "video_count", "video_count_show", "awemeCount");
  const hearts = pickNumber(source, "heartCount", "heart", "heart_count", "diggCount") ?? pickNumber(counters, "heartCount", "heart", "heart_count", "diggCount");
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
    profileUrl: username ? `https://www.tiktok.com/@${username}` : void 0
  };
}
function parseSigiState(data) {
  const root = typeof data === "object" && data !== null ? data : void 0;
  const userModule = root?.UserModule;
  if (!userModule) return void 0;
  const users2 = userModule.users ?? void 0;
  const firstUser = users2 ? Object.values(users2)[0] : void 0;
  if (!firstUser) return void 0;
  const statsMap = userModule.stats ?? void 0;
  const username = pickString(firstUser, "uniqueId", "unique_id")?.replace(/^@/, "") || void 0;
  const profileStats = username && statsMap ? statsMap[username] : void 0;
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
    profileUrl: username ? `https://www.tiktok.com/@${username}` : void 0
  };
}
function extractTikTokProfile(html) {
  if (!html) return void 0;
  const scriptPattern = /<script[^>]*\bid=["']__UNIVERSAL_DATA_FOR_REHYDRATION__["'][^>]*>([\s\S]*?)<\/script>/i;
  const universalMatch = scriptPattern.exec(html);
  if (universalMatch) {
    const raw = universalMatch[1].trim();
    try {
      if (raw) return parseTikTokUniversal(JSON.parse(raw));
    } catch {
    }
  }
  if (html.length < 2e3) return void 0;
  const sigiPattern = /<script[^>]*\bid=["']SIGI_STATE["'][^>]*>([\s\S]*?)<\/script>/i;
  const sigiMatch = sigiPattern.exec(html);
  if (sigiMatch) {
    try {
      const parsed = parseSigiState(JSON.parse(sigiMatch[1].trim()));
      if (parsed) return parsed;
    } catch {
    }
  }
  const statsMatch = html.match(/"stats"\s*:\s*\{\s*"followerCount"\s*:\s*(\d[\d,]*)["\s,}]/i);
  const userMatch = html.match(/"nickname"\s*:\s*"([^"\\]*(?:\\.[^"\\]*)*)"[^}]*?"uniqueId"\s*:\s*"([^"\\]+)"/i);
  if (statsMatch || userMatch) {
    const followers = statsMatch ? Number(statsMatch[1].replace(/,/g, "")) : void 0;
    const regionMatch = html.match(/"region"\s*:\s*"([A-Za-z]{2})"/i);
    const nickMatch = html.match(/"nickname"\s*:\s*"((?:[^"\\]|\\.)*)"/i);
    const uniqueMatch = html.match(/"uniqueId"\s*:\s*"([^"\\]+)"/i);
    const verifiedMatch = html.match(/"verified"\s*:\s*true/i);
    const account = {
      nickname: nickMatch ? nickMatch[1].replace(/\\"/g, '"') : void 0,
      username: (uniqueMatch?.[1] || "").replace(/^@/, "") || void 0,
      followers,
      region: regionMatch?.[1],
      verified: Boolean(verifiedMatch),
      profileUrl: uniqueMatch ? `https://www.tiktok.com/@${uniqueMatch[1].replace(/^@/, "")}` : void 0
    };
    if (account.nickname || account.username || account.followers !== void 0 || account.region) return account;
  }
  return void 0;
}
function runWithTimeout(command, args, timeoutMs) {
  return new Promise((resolve) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
    }, timeoutMs);
    child.stdout.on("data", (chunk2) => {
      stdout += String(chunk2);
    });
    child.stderr.on("data", (chunk2) => {
      stderr += String(chunk2);
    });
    child.on("error", () => {
      clearTimeout(timer);
      resolve({ code: -1, stdout, stderr });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr });
    });
  });
}
function isPythonAvailable() {
  if (!pythonAvailable) {
    pythonAvailable = runWithTimeout("python3", ["-c", "import sys"], 4e3).then((result) => result.code === 0);
  }
  return pythonAvailable;
}
async function fetchViaPython(url) {
  if (!await isPythonAvailable()) return void 0;
  const scriptPath = path4.resolve(process.cwd(), "scripts", "tiktok_profile.py");
  const result = await runWithTimeout("python3", [scriptPath, url], 15e3);
  if (result.code !== 0 || !result.stdout) return void 0;
  const trimmed = result.stdout.trim();
  if (!trimmed || trimmed === "{}" || trimmed === "NO_DATA") return void 0;
  return trimmed;
}
async function fetchViaNode(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12e3);
  try {
    const response = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
        "Referer": "https://www.tiktok.com/"
      },
      redirect: "follow",
      signal: controller.signal
    });
    if (!response.ok) return void 0;
    return await response.text();
  } catch {
    return void 0;
  } finally {
    clearTimeout(timer);
  }
}
async function fetchTikTokAuthorBasics(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 9e3);
  try {
    const response = await fetch(`https://www.tikwm.com/api/?url=${encodeURIComponent(url)}&hd=0`, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; TelegramMediaDownloader/1.0)" },
      signal: controller.signal
    });
    if (!response.ok) return void 0;
    const payload = await response.json().catch(() => null);
    const data = payload?.data;
    if (!data) return void 0;
    const author = data.author ?? void 0;
    if (!author) {
      const region = typeof data.region === "string" ? data.region : void 0;
      const title = typeof data.title === "string" ? data.title : void 0;
      if (region || title) return { region, signature: title };
      return void 0;
    }
    const usernameValue = pickString(author, "unique_id", "uniqueId", "author");
    const username = usernameValue ? usernameValue.replace(/^@/, "") : void 0;
    return {
      nickname: pickString(author, "nickname", "name"),
      username,
      region: typeof data.region === "string" ? data.region : void 0,
      avatarUrl: pickString(author, "avatar"),
      profileUrl: username ? `https://www.tiktok.com/@${username}` : void 0
    };
  } catch {
    return void 0;
  } finally {
    clearTimeout(timer);
  }
}
function tiktokUsernameFromUrl(rawUrl) {
  try {
    const match = new URL(rawUrl).pathname.match(/^\/@([A-Za-z0-9_.-]+)/);
    return match ? match[1] : void 0;
  } catch {
    return void 0;
  }
}
function mergeAccounts(...sources) {
  const merged = {};
  for (const source of sources) {
    if (!source) continue;
    if (merged.nickname === void 0 && source.nickname) merged.nickname = source.nickname;
    if (merged.username === void 0 && source.username) merged.username = source.username;
    if (merged.followers === void 0 && source.followers !== void 0) merged.followers = source.followers;
    if (merged.following === void 0 && source.following !== void 0) merged.following = source.following;
    if (merged.posts === void 0 && source.posts !== void 0) merged.posts = source.posts;
    if (merged.hearts === void 0 && source.hearts !== void 0) merged.hearts = source.hearts;
    if (merged.region === void 0 && source.region) merged.region = source.region;
    if (merged.verified === void 0 && source.verified !== void 0) merged.verified = source.verified;
    if (merged.signature === void 0 && source.signature) merged.signature = source.signature;
    if (merged.avatarUrl === void 0 && source.avatarUrl) merged.avatarUrl = source.avatarUrl;
    if (merged.profileUrl === void 0 && source.profileUrl) merged.profileUrl = source.profileUrl;
  }
  return Object.keys(merged).length ? merged : void 0;
}
async function loadTikTokAccount(rawUrl, fallback) {
  const usernameFromUrl = tiktokUsernameFromUrl(rawUrl);
  const username = usernameFromUrl || fallback?.username;
  const cacheKey = username || rawUrl;
  const cached = profileCache.get(cacheKey);
  if (cached && Date.now() - cached.at < PROFILE_CACHE_TTL_MS) return cached.account;
  let account;
  if (username) {
    const profileUrl = `https://www.tiktok.com/@${encodeURIComponent(username)}`;
    const rawScope = await fetchViaPython(profileUrl);
    if (rawScope) {
      try {
        account = parseTikTokUniversal(JSON.parse(rawScope));
      } catch {
        account = void 0;
      }
    }
    if (!account) {
      const html = await fetchViaNode(profileUrl);
      account = html ? extractTikTokProfile(html) : void 0;
    }
  }
  if (!account || !account.region || !account.nickname) {
    const basics = await fetchTikTokAuthorBasics(rawUrl);
    account = mergeAccounts(account, basics);
  }
  const merged = mergeAccounts(
    account,
    fallback?.nickname ? { nickname: fallback.nickname } : void 0,
    fallback?.username ? { username: fallback.username, profileUrl: `https://www.tiktok.com/@${fallback.username.replace(/^@/, "")}` } : void 0,
    fallback?.region ? { region: fallback.region } : void 0
  );
  profileCache.set(cacheKey, { at: Date.now(), account: merged });
  return merged;
}

// server/telegram/downloader.ts
var INSPECT_TIMEOUT_MS = 7e4;
var DOWNLOAD_TIMEOUT_MS = 15e4;
var MAX_MEDIA_BYTES = 45 * 1024 * 1024;
var activeProcesses = /* @__PURE__ */ new Map();
var cancelledJobs = /* @__PURE__ */ new Set();
var imageExtensions = ["jpg", "jpeg", "png", "webp", "gif", "avif"];
var TIKTOK_IMPERSONATION_ARGS = ["--impersonate", "Chrome-136"];
var TWITTER_REQUEST_ARGS = ["--impersonate", "Chrome-136"];
var SNAPCHAT_REQUEST_ARGS = ["--impersonate", "Chrome-136"];
var DownloaderError = class extends Error {
  constructor(message) {
    super(message);
    this.name = "DownloaderError";
  }
};
function tiktokImpersonationArgs(platform) {
  return platform === "tiktok" ? [...TIKTOK_IMPERSONATION_ARGS] : [];
}
function twitterRequestArgs(platform) {
  return platform === "twitter" ? [...TWITTER_REQUEST_ARGS] : [];
}
function snapchatRequestArgs(platform) {
  return platform === "snapchat" ? [...SNAPCHAT_REQUEST_ARGS] : [];
}
function isTikTokRetryablePageError(message) {
  return /\[TikTok\].*Unexpected response from webpage request|Unexpected response from webpage request/i.test(message);
}
function runYtDlp(args, timeoutMs, jobId) {
  return new Promise((resolve, reject) => {
    const child = spawn2("yt-dlp", args, { stdio: ["ignore", "pipe", "pipe"] });
    if (jobId) activeProcesses.set(jobId, child);
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new DownloaderError("\u0627\u0646\u062A\u0647\u062A \u0645\u0647\u0644\u0629 \u0645\u0639\u0627\u0644\u062C\u0629 \u0627\u0644\u0631\u0627\u0628\u0637. \u062D\u0627\u0648\u0644 \u0645\u0631\u0629 \u0623\u062E\u0631\u0649 \u0644\u0627\u062D\u0642\u0627\u064B."));
    }, timeoutMs);
    child.stdout.on("data", (chunk2) => {
      stdout += String(chunk2);
    });
    child.stderr.on("data", (chunk2) => {
      stderr += String(chunk2);
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      if (jobId) activeProcesses.delete(jobId);
      reject(new DownloaderError(`\u062A\u0639\u0630\u0631 \u062A\u0634\u063A\u064A\u0644 \u0645\u062D\u0631\u0643 \u0627\u0644\u062A\u0646\u0632\u064A\u0644: ${error.message}`));
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (jobId) activeProcesses.delete(jobId);
      if (jobId && cancelledJobs.delete(jobId)) return reject(new DownloaderError("\u062A\u0645 \u0625\u0644\u063A\u0627\u0621 \u0627\u0644\u0639\u0645\u0644\u064A\u0629 \u0628\u0646\u062C\u0627\u062D."));
      if (code === 0) return resolve({ stdout, stderr });
      const compact = stderr.split("\n").filter(Boolean).slice(-1)[0] || "\u0631\u0627\u0628\u0637 \u063A\u064A\u0631 \u0645\u062A\u0627\u062D \u0623\u0648 \u063A\u064A\u0631 \u0639\u0627\u0645.";
      const normalized = compact.toLowerCase();
      if (/(private|login|sign in|cookies|not available|members only|age-restricted)/.test(normalized)) {
        return reject(new DownloaderError("\u0644\u0627 \u064A\u0645\u0643\u0646 \u0627\u0644\u0648\u0635\u0648\u0644 \u0625\u0644\u0649 \u0647\u0630\u0627 \u0627\u0644\u0645\u062D\u062A\u0648\u0649 \u0644\u0623\u0646\u0647 \u062E\u0627\u0635 \u0623\u0648 \u0645\u062D\u0645\u064A \u0623\u0648 \u064A\u062A\u0637\u0644\u0628 \u062A\u0633\u062C\u064A\u0644 \u062F\u062E\u0648\u0644. \u0623\u0631\u0633\u0644 \u0631\u0627\u0628\u0637\u0627\u064B \u0639\u0627\u0645\u0627\u064B \u0641\u0642\u0637."));
      }
      reject(new DownloaderError(compact.slice(0, 350)));
    });
  });
}
async function runYtDlpWithRetry(args, timeoutMs, jobId) {
  let lastError;
  for (const delay2 of [0, 800, 1600]) {
    if (delay2) await new Promise((resolve) => setTimeout(resolve, delay2));
    try {
      return await runYtDlp(args, timeoutMs, jobId);
    } catch (error) {
      if (error instanceof DownloaderError && /تم إلغاء العملية|خاص أو محمي|تسجيل دخول/.test(error.message)) throw error;
      lastError = error;
    }
  }
  throw lastError;
}
function abortYtDlp(jobId) {
  const child = activeProcesses.get(jobId);
  if (!child) return false;
  cancelledJobs.add(jobId);
  child.kill("SIGTERM");
  const forcedKillTimer = setTimeout(() => child.kill("SIGKILL"), 3e3);
  forcedKillTimer.unref();
  return true;
}
function cleanTitle(value) {
  const title = typeof value === "string" ? value.trim() : "\u0645\u062D\u062A\u0648\u0649 \u0639\u0627\u0645";
  return title.slice(0, 120) || "\u0645\u062D\u062A\u0648\u0649 \u0639\u0627\u0645";
}
function isImageRecord(item) {
  const ext = String(item.ext || "").toLowerCase();
  const mime = String(item.mime_type || item.mime || "").toLowerCase();
  const url = String(item.url || item.image_url || item.display_url || item.original_url || "").toLowerCase();
  return imageExtensions.includes(ext) || mime.startsWith("image/") || /\.(jpe?g|png|webp|gif|avif)(?:$|[?&])/i.test(url);
}
function candidateFrom(item, original) {
  const width = typeof item.width === "number" ? item.width : 0;
  const preferredKeys = ["original_url", "image_url", "display_url", "url"];
  return preferredKeys.map((key) => typeof item[key] === "string" ? item[key] : "").filter((url) => typeof url === "string" && url.startsWith("https://")).map((url) => ({ url, width, original }));
}
function imageUrlsFromMetadata(metadata) {
  const originals = [];
  const thumbnails = [];
  const collect = (item, fromThumbnail = false) => {
    const vcodec = String(item.vcodec || "");
    if (isImageRecord(item) && (!vcodec || vcodec === "none")) {
      (fromThumbnail ? thumbnails : originals).push(...candidateFrom(item, !fromThumbnail));
    }
    const formats = Array.isArray(item.formats) ? item.formats : [];
    formats.forEach((format) => {
      if (format && typeof format === "object") collect(format, false);
    });
    const nestedKeys = ["entries", "images", "carousel_media", "carouselMedia", "media"];
    nestedKeys.forEach((key) => {
      const items = Array.isArray(item[key]) ? item[key] : [];
      items.forEach((entry) => {
        if (entry && typeof entry === "object") collect(entry, false);
      });
    });
    const itemThumbnails = Array.isArray(item.thumbnails) ? item.thumbnails : [];
    itemThumbnails.forEach((thumbnail) => {
      if (thumbnail && typeof thumbnail === "object") collect(thumbnail, true);
    });
  };
  collect(metadata);
  const ordered = [...originals, ...thumbnails].sort((a, b) => Number(b.original) - Number(a.original) || b.width - a.width);
  return Array.from(new Map(ordered.map((candidate) => [candidate.url, candidate])).values()).map((candidate) => candidate.url);
}
function imageUrlFromMetadata(metadata) {
  return imageUrlsFromMetadata(metadata)[0];
}
function decodeHtmlAttribute(value) {
  return value.replace(/&amp;/g, "&").replace(/&#x2F;/gi, "/").replace(/&quot;/g, '"');
}
function extractFacebookOpenGraphImage(html) {
  if (/facebook\.com\/login|name=["']login["']/i.test(html)) return void 0;
  const patterns = [
    /<meta[^>]+property=["']og:image(?::secure_url)?["'][^>]+content=["']([^"']+)["'][^>]*>/i,
    /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image(?::secure_url)?["'][^>]*>/i
  ];
  const raw = patterns.map((pattern) => html.match(pattern)?.[1]).find(Boolean);
  const imageUrl = raw ? decodeHtmlAttribute(raw) : "";
  return /^https:\/\/scontent[^/]*\.fbcdn\.net\//i.test(imageUrl) ? imageUrl : void 0;
}
async function loadPublicFacebookOpenGraphImage(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12e3);
  try {
    const response = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; TelegramMediaDownloader/1.0)" },
      redirect: "follow",
      signal: controller.signal
    });
    if (!response.ok || /\/login\/?/i.test(response.url)) return void 0;
    return extractFacebookOpenGraphImage(await response.text());
  } catch {
    return void 0;
  } finally {
    clearTimeout(timeout);
  }
}
function extractTwitterOpenGraphImage(html) {
  if (/sensitive content|only available in the x app|log in|sign up/i.test(html)) return void 0;
  const patterns = [
    /<meta[^>]+(?:property|name)=["'](?:og:image|twitter:image)(?::secure_url)?["'][^>]+content=["']([^"']+)["'][^>]*>/i,
    /<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["'](?:og:image|twitter:image)(?::secure_url)?["'][^>]*>/i
  ];
  const raw = patterns.map((pattern) => html.match(pattern)?.[1]).find(Boolean);
  const imageUrl = raw ? decodeHtmlAttribute(raw) : "";
  return /^https:\/\/pbs\.twimg\.com\//i.test(imageUrl) ? imageUrl : void 0;
}
async function loadPublicTwitterOpenGraphImage(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12e3);
  try {
    const response = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; TelegramMediaDownloader/1.0)" },
      redirect: "follow",
      signal: controller.signal
    });
    if (!response.ok || /\/i\/(?:jf\/)?(?:onboarding|login)/i.test(response.url)) return void 0;
    return extractTwitterOpenGraphImage(await response.text());
  } catch {
    return void 0;
  } finally {
    clearTimeout(timeout);
  }
}
async function resolveTikTokPublicUrl(url) {
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
          signal: AbortSignal.timeout(1e4)
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
async function loadMetadata(rawUrl, jobId) {
  let { url, platform } = inspectSupportedUrl(rawUrl);
  if (platform === "tiktok") url = await resolveTikTokPublicUrl(url);
  let stdout;
  try {
    ({ stdout } = await runYtDlpWithRetry([
      ...tiktokImpersonationArgs(platform),
      ...twitterRequestArgs(platform),
      ...snapchatRequestArgs(platform),
      "--dump-single-json",
      "--no-playlist",
      "--skip-download",
      "--ignore-no-formats-error",
      url.toString()
    ], INSPECT_TIMEOUT_MS, jobId));
  } catch (error) {
    if (platform === "facebook") {
      const imageUrl = await loadPublicFacebookOpenGraphImage(url);
      if (imageUrl) return { title: "\u0635\u0648\u0631\u0629 Facebook \u0639\u0627\u0645\u0629", image_url: imageUrl, mime_type: "image/jpeg" };
      throw new DownloaderError("\u0644\u0645 \u064A\u0645\u0646\u062D Facebook \u0627\u0644\u062E\u0627\u062F\u0645 \u0648\u0635\u0648\u0644\u0627\u064B \u0639\u0627\u0645\u0627\u064B \u0644\u0647\u0630\u0647 \u0627\u0644\u0635\u0648\u0631\u0629\u061B \u0623\u0639\u0627\u062F \u0627\u0644\u0645\u0635\u062F\u0631 \u0637\u0644\u0628 \u062A\u0633\u062C\u064A\u0644 \u0627\u0644\u062F\u062E\u0648\u0644 \u0623\u0648 \u062D\u0645\u0627\u064A\u0629 \u0627\u0644\u0645\u0646\u0635\u0629. \u0623\u0631\u0633\u0644 \u0631\u0627\u0628\u0637 \u0645\u0646\u0634\u0648\u0631 \u0639\u0627\u0645 \u0645\u0646 \u0635\u0641\u062D\u0629 \u0639\u0627\u0645\u0629 \u0623\u0648 \u0631\u0627\u0628\u0637 \u0635\u0648\u0631\u0629 \u0642\u0627\u0628\u0644 \u0644\u0644\u0645\u0634\u0627\u0631\u0643\u0629.");
    }
    if (platform === "tiktok" && error instanceof DownloaderError && isTikTokRetryablePageError(error.message)) {
      throw new DownloaderError("\u062A\u0639\u0630\u0631 \u0627\u0644\u0648\u0635\u0648\u0644 \u0625\u0644\u0649 \u0635\u0641\u062D\u0629 TikTok \u0645\u0624\u0642\u062A\u0627\u064B \u0628\u0633\u0628\u0628 \u062D\u0645\u0627\u064A\u0629 \u0627\u0644\u0645\u0635\u062F\u0631. \u0623\u0639\u062F \u0625\u0631\u0633\u0627\u0644 \u0627\u0644\u0631\u0627\u0628\u0637 \u0628\u0639\u062F \u0642\u0644\u064A\u0644\u061B \u064A\u062D\u0627\u0648\u0644 \u0627\u0644\u0628\u0648\u062A \u062A\u0644\u0642\u0627\u0626\u064A\u0627\u064B \u0645\u062A\u0635\u0641\u062D\u0627\u064B \u0645\u062A\u0648\u0627\u0641\u0642\u0627\u064B \u0648\u0625\u0639\u0627\u062F\u0629 \u0627\u0644\u0645\u062D\u0627\u0648\u0644\u0629.");
    }
    if (platform === "twitter" && error instanceof DownloaderError) {
      const message = error.message.toLowerCase();
      if (/private|login|sign in|protected|not found|suspended|unavailable/.test(message)) {
        throw new DownloaderError("\u0644\u0627 \u064A\u0645\u0643\u0646 \u062A\u0646\u0632\u064A\u0644 \u0647\u0630\u0627 \u0627\u0644\u0645\u0646\u0634\u0648\u0631 \u0645\u0646 Twitter/X \u0644\u0623\u0646\u0647 \u062E\u0627\u0635 \u0623\u0648 \u0645\u062D\u0630\u0648\u0641 \u0623\u0648 \u064A\u062A\u0637\u0644\u0628 \u062A\u0633\u062C\u064A\u0644 \u0627\u0644\u062F\u062E\u0648\u0644. \u0623\u0631\u0633\u0644 \u0631\u0627\u0628\u0637 \u0645\u0646\u0634\u0648\u0631 \u0639\u0627\u0645 \u0645\u062A\u0627\u062D \u0644\u0644\u062C\u0645\u064A\u0639.");
      }
      throw new DownloaderError("\u062A\u0639\u0630\u0631 \u0627\u0644\u0648\u0635\u0648\u0644 \u0625\u0644\u0649 \u0645\u0646\u0634\u0648\u0631 Twitter/X \u062D\u0627\u0644\u064A\u0627\u064B. \u0642\u062F \u062A\u0643\u0648\u0646 \u0627\u0644\u0645\u0646\u0635\u0629 \u062D\u062C\u0628\u062A \u0637\u0644\u0628\u0627\u062A \u0627\u0644\u062E\u0627\u062F\u0645 \u0645\u0624\u0642\u062A\u0627\u064B\u061B \u062C\u0631\u0651\u0628 \u0627\u0644\u0631\u0627\u0628\u0637 \u0627\u0644\u0639\u0627\u0645 \u0645\u0631\u0629 \u0623\u062E\u0631\u0649 \u0644\u0627\u062D\u0642\u0627\u064B.");
    }
    if (platform === "snapchat" && error instanceof DownloaderError) {
      const message = error.message.toLowerCase();
      if (/private|login|sign in|protected|not found|unavailable|no video formats/.test(message)) {
        throw new DownloaderError("\u0644\u0627 \u064A\u0645\u0643\u0646 \u062A\u0646\u0632\u064A\u0644 \u0647\u0630\u0627 Snapchat \u0644\u0623\u0646\u0647 \u062E\u0627\u0635 \u0623\u0648 \u0645\u0646\u062A\u0647\u064D \u0623\u0648 \u0644\u0627 \u064A\u062A\u064A\u062D \u0641\u064A\u062F\u064A\u0648 \u0639\u0627\u0645\u0627\u064B. \u0623\u0631\u0633\u0644 \u0631\u0627\u0628\u0637 Spotlight \u0623\u0648 Story \u0639\u0627\u0645 \u0645\u0627 \u0632\u0627\u0644 \u0645\u062A\u0627\u062D\u0627\u064B.");
      }
      throw new DownloaderError("\u062A\u0639\u0630\u0631 \u0627\u0644\u0648\u0635\u0648\u0644 \u0625\u0644\u0649 \u0641\u064A\u062F\u064A\u0648 Snapchat \u062D\u0627\u0644\u064A\u0627\u064B. \u0642\u062F \u062A\u0643\u0648\u0646 \u0627\u0644\u0645\u0646\u0635\u0629 \u062D\u062C\u0628\u062A \u0637\u0644\u0628\u0627\u062A \u0627\u0644\u062E\u0627\u062F\u0645 \u0645\u0624\u0642\u062A\u0627\u064B\u061B \u062C\u0631\u0651\u0628 \u0631\u0627\u0628\u0637\u0627\u064B \u0639\u0627\u0645\u0627\u064B \u0622\u062E\u0631 \u0644\u0627\u062D\u0642\u0627\u064B.");
    }
    throw error;
  }
  try {
    return JSON.parse(stdout);
  } catch {
    throw new DownloaderError("\u062A\u0639\u0630\u0631 \u0641\u062D\u0635 \u0627\u0644\u0631\u0627\u0628\u0637. \u062A\u0623\u0643\u062F \u0623\u0646 \u0627\u0644\u0645\u0646\u0634\u0648\u0631 \u0623\u0648 \u0627\u0644\u0642\u0635\u0629 \u0639\u0627\u0645\u0629 \u0648\u0645\u062A\u0627\u062D\u0629.");
  }
}
async function inspectMediaLink(rawUrl, jobId) {
  const { platform } = inspectSupportedUrl(rawUrl);
  const isStory = detectStoryLink(rawUrl);
  const accountPromise = platform === "tiktok" ? loadTikTokAccount(rawUrl).catch(() => void 0) : Promise.resolve(void 0);
  const [metadata, account, story] = await Promise.all([
    loadMetadata(rawUrl, jobId),
    accountPromise,
    Promise.resolve(isStory)
  ]);
  const formats = Array.isArray(metadata.formats) ? metadata.formats : [];
  const directExtension = String(metadata.ext || "").toLowerCase();
  const directIsImage = imageExtensions.includes(directExtension);
  const directVideoCodec = String(metadata.vcodec || "");
  const directAudioCodec = String(metadata.acodec || "");
  const hasVideo = formats.some((format) => format.vcodec && format.vcodec !== "none") || Boolean(metadata.url) && !directIsImage && Boolean(directVideoCodec) && directVideoCodec !== "none";
  const hasAudio = formats.some((format) => format.acodec && format.acodec !== "none") || hasVideo && Boolean(directAudioCodec) && directAudioCodec !== "none";
  const hasImageFormat = directIsImage || formats.some((format) => {
    const ext = String(format.ext || "").toLowerCase();
    return imageExtensions.includes(ext) && (!format.vcodec || format.vcodec === "none");
  });
  const sourceImageUrls = imageUrlsFromMetadata(metadata);
  const hasImage = hasImageFormat || Boolean(sourceImageUrls.length);
  const choices = [];
  if (hasVideo) choices.push(story ? "story" : "video");
  if (hasAudio) choices.push("audio");
  if (hasImage) choices.push("image");
  if (!choices.length && platform === "twitter") {
    const imageUrl = await loadPublicTwitterOpenGraphImage(new URL(rawUrl));
    if (imageUrl) {
      return { platform, title: "\u0635\u0648\u0631\u0629 Twitter/X \u0639\u0627\u0645\u0629", choices: ["image"], thumbnail: imageUrl };
    }
    throw new DownloaderError("\u0644\u0645 \u064A\u062A\u064A\u062D X \u0648\u0633\u0627\u0626\u0637 \u0639\u0627\u0645\u0629 \u0642\u0627\u0628\u0644\u0629 \u0644\u0644\u0625\u0631\u0633\u0627\u0644 \u0644\u0647\u0630\u0627 \u0627\u0644\u0645\u0646\u0634\u0648\u0631. \u0642\u062F \u064A\u0643\u0648\u0646 \u062D\u0633\u0627\u0633\u0627\u064B \u0648\u0645\u062A\u0627\u062D\u0627\u064B \u0639\u0628\u0631 \u062A\u0637\u0628\u064A\u0642 X \u0641\u0642\u0637 \u0623\u0648 \u0645\u062D\u0645\u064A\u0627\u064B \u0628\u062A\u0633\u062C\u064A\u0644 \u0627\u0644\u062F\u062E\u0648\u0644.");
  }
  if (!choices.length) throw new DownloaderError("\u0644\u0645 \u064A\u0624\u0643\u062F \u0627\u0644\u0645\u0635\u062F\u0631 \u0648\u062C\u0648\u062F \u0641\u064A\u062F\u064A\u0648 \u0623\u0648 \u0635\u0648\u062A \u0623\u0648 \u0635\u0648\u0631\u0629 \u0639\u0627\u0645\u0629 \u0642\u0627\u0628\u0644\u0629 \u0644\u0644\u0625\u0631\u0633\u0627\u0644. \u0642\u062F \u064A\u0643\u0648\u0646 \u0627\u0644\u0645\u0646\u0634\u0648\u0631 \u062E\u0627\u0635\u0627\u064B \u0623\u0648 \u0642\u0635\u0629 \u0645\u0646\u062A\u0647\u064A\u0629 \u0623\u0648 \u0623\u0644\u0628\u0648\u0645\u0627\u064B \u0644\u0627 \u064A\u062A\u064A\u062D \u0627\u0644\u0645\u0635\u062F\u0631 \u0627\u0633\u062A\u062E\u0631\u0627\u062C \u0648\u0633\u0627\u0626\u0637\u0647.");
  const enrichedAccount = mergeAccounts(
    account,
    typeof metadata.channel === "string" && metadata.channel.trim() ? { nickname: metadata.channel.trim() } : void 0,
    typeof metadata.uploader === "string" && metadata.uploader.trim() ? { username: metadata.uploader.trim().replace(/^@/, "") } : void 0
  );
  const result = {
    platform,
    title: cleanTitle(metadata.title),
    choices,
    durationSeconds: typeof metadata.duration === "number" ? metadata.duration : void 0,
    thumbnail: sourceImageUrls[0]
  };
  if (sourceImageUrls.length > 1) result.imageCount = sourceImageUrls.length;
  if (enrichedAccount) result.account = enrichedAccount;
  return result;
}
async function downloadMedia(rawUrl, choice, jobId) {
  let { url, platform } = inspectSupportedUrl(rawUrl);
  if (platform === "tiktok") url = await resolveTikTokPublicUrl(url);
  const workdir = await mkdtemp(path5.join(os.tmpdir(), `telegram-media-${jobId}-`));
  const output = path5.join(workdir, "media.%(ext)s");
  if (choice === "image") {
    try {
      const metadata = await loadMetadata(url.toString(), jobId);
      const imageUrl = imageUrlFromMetadata(metadata);
      if (!imageUrl) throw new DownloaderError("\u0644\u0645 \u064A\u0624\u0643\u062F \u0627\u0644\u0645\u0635\u062F\u0631 \u0631\u0627\u0628\u0637 \u0635\u0648\u0631\u0629 \u0623\u0635\u0644\u064A\u0629 \u0642\u0627\u0628\u0644\u0629 \u0644\u0644\u0625\u0631\u0633\u0627\u0644. \u062A\u062D\u0642\u0642 \u0623\u0646 \u0627\u0644\u0645\u0646\u0634\u0648\u0631 \u0639\u0627\u0645 \u0648\u0644\u064A\u0633 \u0642\u0635\u0629 \u0645\u0646\u062A\u0647\u064A\u0629 \u0623\u0648 \u0623\u0644\u0628\u0648\u0645\u0627\u064B \u0645\u062D\u0645\u064A\u0627\u064B.");
      const response = await fetch(imageUrl);
      if (!response.ok) throw new DownloaderError("\u0631\u0641\u0636 \u0627\u0644\u0645\u0635\u062F\u0631 \u062C\u0644\u0628 \u0627\u0644\u0635\u0648\u0631\u0629 \u0627\u0644\u0639\u0627\u0645\u0629 \u062D\u0627\u0644\u064A\u0627\u064B. \u062C\u0631\u0651\u0628 \u0627\u0644\u0631\u0627\u0628\u0637 \u0645\u0631\u0629 \u0623\u062E\u0631\u0649 \u0644\u0627\u062D\u0642\u0627\u064B \u0623\u0648 \u0623\u0631\u0633\u0644 \u0631\u0627\u0628\u0637 \u0627\u0644\u0645\u0646\u0634\u0648\u0631 \u0627\u0644\u0639\u0627\u0645 \u0627\u0644\u0623\u0635\u0644\u064A.");
      const contentLength = Number(response.headers.get("content-length") || 0);
      if (contentLength > MAX_MEDIA_BYTES) throw new DownloaderError("\u062D\u062C\u0645 \u0627\u0644\u0635\u0648\u0631\u0629 \u0623\u0643\u0628\u0631 \u0645\u0646 \u0627\u0644\u062D\u062F \u0627\u0644\u0622\u0645\u0646 \u0644\u0644\u0625\u0631\u0633\u0627\u0644 \u0639\u0628\u0631 \u0627\u0644\u0628\u0648\u062A.");
      const contentType = response.headers.get("content-type") || "image/jpeg";
      if (!contentType.startsWith("image/")) throw new DownloaderError("\u0627\u0644\u0645\u0635\u062F\u0631 \u0644\u0645 \u064A\u064F\u0631\u062C\u0639 \u0645\u0644\u0641 \u0635\u0648\u0631\u0629 \u0635\u0627\u0644\u062D\u0627\u064B.");
      const bytes = Buffer.from(await response.arrayBuffer());
      if (bytes.byteLength > MAX_MEDIA_BYTES) throw new DownloaderError("\u062D\u062C\u0645 \u0627\u0644\u0635\u0648\u0631\u0629 \u0623\u0643\u0628\u0631 \u0645\u0646 \u0627\u0644\u062D\u062F \u0627\u0644\u0622\u0645\u0646 \u0644\u0644\u0625\u0631\u0633\u0627\u0644 \u0639\u0628\u0631 \u0627\u0644\u0628\u0648\u062A.");
      const extension = contentType.includes("png") ? "png" : contentType.includes("webp") ? "webp" : "jpg";
      const filePath = path5.join(workdir, `media.${extension}`);
      await writeFile2(filePath, bytes);
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
    const files = (await readdir(workdir)).filter((file) => !file.endsWith(".part") && !file.endsWith(".ytdl")).map((file) => path5.join(workdir, file));
    if (!files.length) throw new DownloaderError("\u0627\u0643\u062A\u0645\u0644 \u0627\u0644\u0637\u0644\u0628 \u062F\u0648\u0646 \u0645\u0644\u0641 \u0642\u0627\u0628\u0644 \u0644\u0644\u0625\u0631\u0633\u0627\u0644.");
    const candidate = files[0];
    const fileInfo = await stat(candidate);
    if (fileInfo.size > MAX_MEDIA_BYTES) {
      throw new DownloaderError("\u062D\u062C\u0645 \u0627\u0644\u0645\u0644\u0641 \u0623\u0643\u0628\u0631 \u0645\u0646 \u0627\u0644\u062D\u062F \u0627\u0644\u0622\u0645\u0646 \u0644\u0644\u0625\u0631\u0633\u0627\u0644 \u0639\u0628\u0631 \u0627\u0644\u0628\u0648\u062A. \u062C\u0631\u0651\u0628 \u0631\u0627\u0628\u0637\u0627\u064B \u0623\u0642\u0635\u0631 \u0623\u0648 \u062C\u0648\u062F\u0629 \u0623\u0642\u0644.");
    }
    return { workdir, filePath: candidate, bytes: fileInfo.size };
  } catch (error) {
    await rm(workdir, { recursive: true, force: true });
    throw error;
  }
}
async function purgeDownloadedMedia(workdir) {
  await rm(workdir, { recursive: true, force: true });
}
async function writeRemoteImage(url, destination) {
  const response = await fetch(url);
  if (!response.ok) throw new DownloaderError("\u0631\u0641\u0636 \u0627\u0644\u0645\u0635\u062F\u0631 \u062C\u0644\u0628 \u0625\u062D\u062F\u0649 \u0627\u0644\u0635\u0648\u0631 \u062D\u0627\u0644\u064A\u0627\u064B. \u062C\u0631\u0651\u0628 \u0627\u0644\u0631\u0627\u0628\u0637 \u0645\u0631\u0629 \u0623\u062E\u0631\u0649 \u0644\u0627\u062D\u0642\u0627\u064B.");
  const contentType = response.headers.get("content-type") || "image/jpeg";
  if (!contentType.startsWith("image/")) throw new DownloaderError("\u0623\u062D\u062F \u0627\u0644\u0645\u0644\u0641\u0627\u062A \u0627\u0644\u062A\u064A \u0623\u0631\u062C\u0639\u0647\u0627 \u0627\u0644\u0645\u0635\u062F\u0631 \u0644\u064A\u0633 \u0635\u0648\u0631\u0629 \u0635\u0627\u0644\u062D\u0629.");
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.byteLength > MAX_MEDIA_BYTES) throw new DownloaderError("\u062D\u062C\u0645 \u0625\u062D\u062F\u0649 \u0627\u0644\u0635\u0648\u0631 \u0623\u0643\u0628\u0631 \u0645\u0646 \u0627\u0644\u062D\u062F \u0627\u0644\u0622\u0645\u0646 \u0644\u0644\u0625\u0631\u0633\u0627\u0644 \u0639\u0628\u0631 \u0627\u0644\u0628\u0648\u062A.");
  await writeFile2(destination, bytes);
  return bytes.byteLength;
}
function extensionForUrl(url) {
  return /\.png(?:$|[?#])/i.test(url) ? "png" : /\.webp(?:$|[?#])/i.test(url) ? "webp" : /\.gif(?:$|[?#])/i.test(url) ? "gif" : "jpg";
}
async function downloadAllImages(rawUrl, jobId) {
  const workdir = await mkdtemp(path5.join(os.tmpdir(), `telegram-gallery-${jobId}-`));
  try {
    const metadata = await loadMetadata(rawUrl, jobId);
    const urls = Array.from(new Set(imageUrlsFromMetadata(metadata)));
    if (!urls.length) throw new DownloaderError("\u0644\u0645 \u064A\u0624\u0643\u062F \u0627\u0644\u0645\u0635\u062F\u0631 \u0631\u0648\u0627\u0628\u0637 \u0635\u0648\u0631 \u0642\u0627\u0628\u0644\u0629 \u0644\u0644\u0625\u0631\u0633\u0627\u0644. \u062A\u062D\u0642\u0642 \u0623\u0646 \u0627\u0644\u0645\u0634\u0627\u0631\u0643\u0629 \u0639\u0627\u0645\u0629 \u0648\u0645\u062A\u0627\u062D\u0629.");
    const files = [];
    let totalBytes = 0;
    for (let index2 = 0; index2 < urls.length; index2 += 1) {
      const filePath = path5.join(workdir, `media-${index2 + 1}.${extensionForUrl(urls[index2])}`);
      const bytes = await writeRemoteImage(urls[index2], filePath);
      totalBytes += bytes;
      files.push({ path: filePath });
    }
    return { workdir, files, bytes: totalBytes };
  } catch (error) {
    await rm(workdir, { recursive: true, force: true });
    throw error;
  }
}

// server/telegram/downloadQueue.ts
var DownloadQueueError = class extends Error {
  constructor(message) {
    super(message);
    this.name = "DownloadQueueError";
  }
};
var pending = [];
var active = 0;
var startedTotal = 0;
var completedTotal = 0;
function configNumber(name, fallback, min, max) {
  const raw = Number(process.env[name]);
  if (!Number.isFinite(raw)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(raw)));
}
function maxConcurrent() {
  return configNumber("DOWNLOAD_MAX_CONCURRENT", 2, 1, 64);
}
function maxWaiting() {
  return configNumber("DOWNLOAD_MAX_WAITING", 1e3, 10, 5e4);
}
function pumpQueue() {
  while (active < maxConcurrent() && pending.length) {
    const task = pending.shift();
    active += 1;
    startedTotal += 1;
    task.run().then(task.resolve, task.reject).finally(() => {
      active -= 1;
      completedTotal += 1;
      pumpQueue();
    });
  }
}
function scheduleDownload(run) {
  if (pending.length >= maxWaiting()) {
    throw new DownloadQueueError("\u0627\u0644\u0628\u0648\u062A \u064A\u0639\u0627\u0644\u062C \u062D\u0627\u0644\u064A\u0627\u064B \u0639\u062F\u062F\u0627\u064B \u0643\u0628\u064A\u0631\u0627\u064B \u0645\u0646 \u0627\u0644\u062A\u0646\u0632\u064A\u0644\u0627\u062A. \u0623\u0639\u062F \u0627\u0644\u0645\u062D\u0627\u0648\u0644\u0629 \u0628\u0639\u062F \u0644\u062D\u0638\u0627\u062A.");
  }
  const position = active + pending.length + 1;
  const completion = new Promise((resolve, reject) => {
    pending.push({ run, resolve, reject });
    pumpQueue();
  });
  return { position, completion };
}
function getDownloadQueueStats() {
  return {
    active,
    waiting: pending.length,
    maxConcurrent: maxConcurrent(),
    maxWaiting: maxWaiting(),
    started: startedTotal,
    completed: completedTotal
  };
}

// server/telegram/botService.ts
init_policy();

// server/telegram/messages.ts
function escapeHtml(value) {
  return value.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" })[char] || char);
}
function languageLabel(code) {
  if (!code) return void 0;
  const normalized = code.toLowerCase();
  const labels = {
    ar: "\u0627\u0644\u0639\u0631\u0628\u064A\u0629",
    en: "\u0627\u0644\u0625\u0646\u062C\u0644\u064A\u0632\u064A\u0629",
    fr: "\u0627\u0644\u0641\u0631\u0646\u0633\u064A\u0629",
    es: "\u0627\u0644\u0625\u0633\u0628\u0627\u0646\u064A\u0629",
    de: "\u0627\u0644\u0623\u0644\u0645\u0627\u0646\u064A\u0629",
    ru: "\u0627\u0644\u0631\u0648\u0633\u064A\u0629",
    tr: "\u0627\u0644\u062A\u0631\u0643\u064A\u0629",
    fa: "\u0627\u0644\u0641\u0627\u0631\u0633\u064A\u0629",
    ur: "\u0627\u0644\u0623\u0631\u062F\u064A\u0629",
    hi: "\u0627\u0644\u0647\u0646\u062F\u064A\u0629",
    id: "\u0627\u0644\u0625\u0646\u062F\u0648\u0646\u064A\u0633\u064A\u0629",
    pt: "\u0627\u0644\u0628\u0631\u062A\u063A\u0627\u0644\u064A\u0629",
    it: "\u0627\u0644\u0625\u064A\u0637\u0627\u0644\u064A\u0629",
    nl: "\u0627\u0644\u0647\u0648\u0644\u0646\u062F\u064A\u0629",
    zh: "\u0627\u0644\u0635\u064A\u0646\u064A\u0629",
    ja: "\u0627\u0644\u064A\u0627\u0628\u0627\u0646\u064A\u0629",
    ko: "\u0627\u0644\u0643\u0648\u0631\u064A\u0629",
    pl: "\u0627\u0644\u0628\u0648\u0644\u0646\u062F\u064A\u0629",
    uk: "\u0627\u0644\u0623\u0648\u0643\u0631\u0627\u0646\u064A\u0629",
    vi: "\u0627\u0644\u0641\u064A\u062A\u0646\u0627\u0645\u064A\u0629"
  };
  return labels[normalized] || normalized;
}
function userCard(info) {
  if (!info) return "";
  const lines = ["\u{1F9FE} <b>\u0628\u064A\u0627\u0646\u0627\u062A \u0645\u0644\u0641\u0643</b>"];
  if (info.username) lines.push(`\u0627\u0644\u0645\u0639\u0631\u0641: @${escapeHtml(info.username)}`);
  const language = languageLabel(info.language);
  if (language) lines.push(`\u0627\u0644\u0644\u063A\u0629: ${escapeHtml(language)}`);
  if (info.firstSeen) lines.push(`\u0623\u0648\u0644 \u0627\u0633\u062A\u062E\u062F\u0627\u0645: ${info.firstSeen.toLocaleDateString("ar-EG", { day: "numeric", month: "long", year: "numeric" })}`);
  return `

${lines.join("\n")}`;
}
function welcomeText(name, info) {
  return `\u2726 <b>\u0623\u0647\u0644\u0627\u064B \u0628\u0643 \u064A\u0627 ${escapeHtml(name)}</b> \u{1F3AC}

\u0623\u0646\u0627 \u0628\u0648\u062A \u062A\u062D\u0645\u064A\u0644 \u0627\u0644\u0648\u0633\u0627\u0626\u0637 \u0627\u0644\u0639\u0627\u0645\u0629. \u0623\u0631\u0633\u0644 \u0631\u0627\u0628\u0637\u0627\u064B \u0648\u0627\u062D\u062F\u0627\u064B \u0648\u0633\u0623\u0639\u0631\u0636 \u0644\u0643 \u0645\u0627 \u064A\u0645\u0643\u0646 \u062A\u0646\u0632\u064A\u0644\u0647 \u0645\u0646: <b>\u0641\u064A\u062F\u064A\u0648</b> \u2022 <b>\u0635\u0648\u062A</b> \u2022 <b>\u0627\u0644\u0635\u0648\u0631 \u0643\u0627\u0645\u0644\u0629</b> \u2022 <b>\u0633\u062A\u0648\u0631\u064A</b>.
${userCard(info)}

<b>\u0627\u0644\u0645\u0646\u0635\u0627\u062A \u0627\u0644\u0645\u062F\u0639\u0648\u0645\u0629</b>
TikTok \u2022 Instagram \u2022 Facebook \u2022 Snapchat \u2022 Pinterest \u2022 Twitter/X

<b>\u0639\u0644\u0649 TikTok \u0623\u0639\u0631\u0636 \u0644\u0643 \u0623\u064A\u0636\u0627\u064B \u0628\u0637\u0627\u0642\u0629 \u0627\u0644\u062D\u0633\u0627\u0628</b>
\u0627\u0644\u0627\u0633\u0645\u060C \u0627\u0633\u0645 \u0627\u0644\u0645\u0633\u062A\u062E\u062F\u0645\u060C \u0627\u0644\u0645\u062A\u0627\u0628\u0639\u064A\u0646\u060C \u0627\u0644\u0645\u0646\u0634\u0648\u0631\u0627\u062A\u060C \u0648\u0627\u0644\u062F\u0648\u0644\u0629 \u2014 \u0645\u0646 \u0627\u0644\u0628\u064A\u0627\u0646\u0627\u062A \u0627\u0644\u0639\u0627\u0645\u0629 \u0644\u0644\u062D\u0633\u0627\u0628\u060C \u0645\u0639 \u0639\u062F\u062F \u0635\u0648\u0631 \u0627\u0644\u0645\u0634\u0627\u0631\u0643\u0629 \u0625\u0630\u0627 \u0643\u0627\u0646\u062A \u0645\u062A\u0639\u062F\u062F\u0629.

<b>\u0628\u062B\u0644\u0627\u062B \u062E\u0637\u0648\u0627\u062A</b>
\u2460 \u0627\u0646\u0633\u062E \u0631\u0627\u0628\u0637 \u0627\u0644\u0645\u0646\u0634\u0648\u0631 \u0623\u0648 \u0627\u0644\u0641\u064A\u062F\u064A\u0648 \u0623\u0648 \u0627\u0644\u0642\u0635\u0629 \u0627\u0644\u0639\u0627\u0645\u0629.
\u2461 \u0623\u0631\u0633\u0644\u0647 \u0647\u0646\u0627 \u0643\u0645\u0627 \u0647\u0648\u060C \u0645\u0646 \u062F\u0648\u0646 \u0625\u0636\u0627\u0641\u0629 \u0646\u0635 \u0622\u062E\u0631.
\u2462 \u0627\u0646\u0642\u0631 \u0646\u0648\u0639 \u0627\u0644\u0645\u0644\u0641 \u0627\u0644\u0630\u064A \u062A\u0631\u064A\u062F \u062A\u0646\u0632\u064A\u0644\u0647 \u0639\u0646\u062F\u0645\u0627 \u064A\u0624\u0643\u062F \u0627\u0644\u0645\u0635\u062F\u0631 \u062A\u0648\u0641\u0631\u0647.

\u0644\u0627 \u0623\u0642\u0628\u0644 \u0627\u0644\u062D\u0633\u0627\u0628\u0627\u062A \u0627\u0644\u062E\u0627\u0635\u0629 \u0623\u0648 \u0627\u0644\u0645\u062D\u062A\u0648\u0649 \u0627\u0644\u0645\u062D\u0645\u064A. \u0627\u0633\u062A\u062E\u062F\u0645 \u0627\u0644\u0631\u0648\u0627\u0628\u0637 \u0627\u0644\u0639\u0627\u0645\u0629 \u0627\u0644\u062A\u064A \u062A\u0645\u0644\u0643 \u062D\u0642 \u062A\u0646\u0632\u064A\u0644\u0647\u0627 \u0641\u0642\u0637.`;
}
var HELP_TEXT = `\u2754 <b>\u0643\u064A\u0641 \u0623\u0633\u062A\u062E\u062F\u0645 \u0627\u0644\u0628\u0648\u062A\u061F</b>

\u0623\u0631\u0633\u0644 \u0631\u0627\u0628\u0637\u0627\u064B \u0639\u0627\u0645\u0627\u064B \u0648\u0627\u062D\u062F\u0627\u064B \u0641\u0642\u0637. \u064A\u062F\u0639\u0645 \u0627\u0644\u0628\u0648\u062A TikTok \u0648Instagram \u0648Facebook \u0648Snapchat \u0648Pinterest \u0648Twitter/X. \u0641\u064A Twitter/X \u0627\u0633\u062A\u062E\u062F\u0645 \u0631\u0627\u0628\u0637 \u0627\u0644\u0645\u0646\u0634\u0648\u0631 \u0628\u0635\u064A\u063A\u0629 <code>https://x.com/\u0627\u0633\u0645_\u0627\u0644\u0645\u0633\u062A\u062E\u062F\u0645/status/123</code>\u060C \u0648\u0644\u064A\u0633 \u0631\u0627\u0628\u0637 \u0627\u0644\u062D\u0633\u0627\u0628.

\u0628\u0639\u062F \u0627\u0644\u0641\u062D\u0635 \u062A\u0638\u0647\u0631 \u0627\u0644\u0623\u0632\u0631\u0627\u0631 \u0627\u0644\u0645\u0646\u0627\u0633\u0628\u0629: \u0641\u064A\u062F\u064A\u0648 \u0623\u0648 \u0635\u0648\u062A \u0623\u0648 \u0635\u0648\u0631\u0629 \u0623\u0635\u0644\u064A\u0629 \u0623\u0648 \u0633\u062A\u0648\u0631\u064A. \u0627\u0644\u0645\u0634\u0627\u0631\u0643\u0627\u062A \u0627\u0644\u0645\u062A\u0639\u062F\u062F\u0629 \u0627\u0644\u0635\u0648\u0631 \u062A\u0639\u0631\u0636 \u0639\u062F\u062F \u0627\u0644\u0635\u0648\u0631 \u0648\u0632\u0631 <b>\u062A\u0646\u0632\u064A\u0644 \u0627\u0644\u0635\u0648\u0631 \u0643\u0627\u0645\u0644\u0629</b>.

\u0639\u0644\u0649 \u0631\u0648\u0627\u0628\u0637 TikTok \u064A\u064F\u0639\u0631\u0636 \u0623\u064A\u0636\u0627\u064B \u0643\u0634\u0641 \u062D\u0633\u0627\u0628 \u0627\u0644\u0646\u0627\u0634\u0631 \u0639\u0646\u062F \u062A\u0648\u0641\u0631 \u0627\u0644\u0628\u064A\u0627\u0646\u0627\u062A.

\u0627\u0633\u062A\u062E\u062F\u0645 \u0632\u0631 <b>\u0625\u0644\u063A\u0627\u0621 \u0627\u0644\u0639\u0645\u0644\u064A\u0629</b> \u0644\u0625\u064A\u0642\u0627\u0641 \u0627\u0644\u0641\u062D\u0635 \u0623\u0648 \u0627\u0644\u062A\u0646\u0632\u064A\u0644 \u0627\u0644\u062D\u0627\u0644\u064A. \u0644\u0644\u0628\u0644\u0627\u063A\u0627\u062A\u060C \u0627\u0636\u063A\u0637 <b>\u0625\u0631\u0633\u0627\u0644 \u0628\u0644\u0627\u063A</b>.`;
var REPORT_TEXT = `\u0644\u0625\u0631\u0633\u0627\u0644 \u0628\u0644\u0627\u063A\u060C \u0627\u0643\u062A\u0628 \u0627\u0644\u0631\u0633\u0627\u0644\u0629 \u0628\u0647\u0630\u0627 \u0627\u0644\u0634\u0643\u0644:
<code>/report \u0627\u0644\u0631\u0627\u0628\u0637 \u0623\u0648 \u0627\u0644\u0645\u0639\u0631\u0651\u0641 | \u0627\u0644\u0633\u0628\u0628</code>

\u0645\u062B\u0627\u0644: <code>/report https://example.com/post | \u0627\u0644\u0631\u0627\u0628\u0637 \u0644\u0627 \u064A\u0639\u0645\u0644</code>`;
function buttonIcon(envVar) {
  if (process.env.USE_CUSTOM_BUTTON_EMOJI !== "1") return void 0;
  const value = process.env[envVar]?.trim();
  return value ? { icon_custom_emoji_id: value } : void 0;
}
function replyButton(text2, style, iconEnv) {
  const button = { text: text2 };
  if (style) button.style = style;
  Object.assign(button, buttonIcon(iconEnv || ""));
  return button;
}
function inlineButton(text2, callbackData, style, iconEnv) {
  const button = { text: text2, callback_data: callbackData, style };
  Object.assign(button, buttonIcon(iconEnv || ""));
  return button;
}
var USER_KEYBOARD = {
  keyboard: [
    [replyButton("\u{1F680} \u062A\u0634\u063A\u064A\u0644 \u0627\u0644\u0628\u0648\u062A", "success")],
    [replyButton("\u2754 \u0637\u0631\u064A\u0642\u0629 \u0627\u0644\u0627\u0633\u062A\u062E\u062F\u0627\u0645", "primary"), replyButton("\u{1F4E9} \u0625\u0631\u0633\u0627\u0644 \u0628\u0644\u0627\u063A", "primary")],
    [replyButton("\u{1F6D1} \u0625\u0644\u063A\u0627\u0621 \u0627\u0644\u0639\u0645\u0644\u064A\u0629", "danger")]
  ],
  resize_keyboard: true,
  is_persistent: true
};
var OWNER_FOOTER = [
  [replyButton("\u21A9\uFE0F \u0631\u062C\u0648\u0639", "primary"), replyButton("\u{1F3E0} \u0627\u0644\u0631\u0626\u064A\u0633\u064A\u0629", "primary")]
];
var OWNER_KEYBOARD = {
  keyboard: [
    [replyButton("\u{1F680} \u062A\u0634\u063A\u064A\u0644 \u0627\u0644\u0628\u0648\u062A", "success")],
    [replyButton("\u{1F4CA} \u0627\u0644\u0625\u062D\u0635\u0627\u0621\u0627\u062A", "success"), replyButton("\u{1F465} \u0625\u062F\u0627\u0631\u0629 \u0627\u0644\u0645\u0633\u062A\u062E\u062F\u0645\u064A\u0646", "primary")],
    [replyButton("\u{1F512} \u0627\u0644\u0627\u0634\u062A\u0631\u0627\u0643 \u0627\u0644\u0625\u062C\u0628\u0627\u0631\u064A", "primary"), replyButton("\u2699\uFE0F \u0627\u0644\u0625\u0639\u062F\u0627\u062F\u0627\u062A", "primary")],
    [replyButton("\u{1F9F9} \u062A\u0646\u0638\u064A\u0641 \u0627\u0644\u0628\u064A\u0627\u0646\u0627\u062A", "danger"), replyButton("\u{1F4E3} \u0625\u0631\u0633\u0627\u0644 \u0644\u0644\u062C\u0645\u064A\u0639", "primary")],
    [replyButton("\u{1F4CB} \u0623\u062E\u0637\u0627\u0621 \u062D\u062F\u064A\u062B\u0629", "primary"), replyButton("\u{1F6D1} \u0625\u0644\u063A\u0627\u0621 \u0627\u0644\u0639\u0645\u0644\u064A\u0629", "danger")]
  ],
  resize_keyboard: true,
  is_persistent: true
};
var OWNER_USERS_KEYBOARD = {
  keyboard: [
    [replyButton("\u{1F465} \u0622\u062E\u0631 \u0627\u0644\u0645\u0633\u062A\u062E\u062F\u0645\u064A\u0646", "primary"), replyButton("\u2705 \u0627\u0644\u0646\u0634\u0637\u0648\u0646", "primary")],
    [replyButton("\u{1F319} \u063A\u064A\u0631 \u0627\u0644\u0646\u0634\u0637\u064A\u0646", "primary"), replyButton("\u{1F6AB} \u0627\u0644\u0645\u062D\u0638\u0648\u0631\u0648\u0646", "primary")],
    [replyButton("\u{1F6AB} \u062D\u0638\u0631 \u0645\u0633\u062A\u062E\u062F\u0645", "danger"), replyButton("\u2705 \u0641\u0643 \u0627\u0644\u062D\u0638\u0631", "success")],
    ...OWNER_FOOTER
  ],
  resize_keyboard: true,
  is_persistent: true
};
var OWNER_SETTINGS_KEYBOARD = {
  keyboard: [
    [replyButton("\u23F1\uFE0F \u0645\u062F\u0629 \u0627\u0644\u062A\u0646\u0638\u064A\u0641", "primary")],
    ...OWNER_FOOTER
  ],
  resize_keyboard: true,
  is_persistent: true
};
var OWNER_CLEANUP_KEYBOARD = {
  keyboard: [
    [replyButton("\u{1F9F9} \u062A\u0646\u0638\u064A\u0641 \u0627\u0644\u0622\u0646", "danger"), replyButton("\u23F1\uFE0F \u0645\u062F\u0629 \u0627\u0644\u062A\u0646\u0638\u064A\u0641", "primary")],
    ...OWNER_FOOTER
  ],
  resize_keyboard: true,
  is_persistent: true
};
var OWNER_SUBSCRIPTIONS_KEYBOARD = {
  keyboard: [
    [replyButton("\u2795 \u0625\u0636\u0627\u0641\u0629 \u0642\u0646\u0627\u0629/\u0628\u0648\u062A", "success"), replyButton("\u2796 \u0625\u0632\u0627\u0644\u0629 \u0642\u0646\u0627\u0629/\u0628\u0648\u062A", "danger")],
    [replyButton("\u{1F4CB} \u0642\u0627\u0626\u0645\u0629 \u0627\u0644\u0627\u0634\u062A\u0631\u0627\u0643", "primary")],
    ...OWNER_FOOTER
  ],
  resize_keyboard: true,
  is_persistent: true
};
function subscriptionGateText(missing) {
  const items = missing.map((subscription, index2) => {
    const kindLabel = subscription.kind === "group" ? "\u0645\u062C\u0645\u0648\u0639\u0629" : subscription.kind === "bot" ? "\u0628\u0648\u062A" : "\u0642\u0646\u0627\u0629";
    const link = subscription.inviteUrl ? ` <a href="${escapeHtml(subscription.inviteUrl)}">@${escapeHtml(subscription.label.replace(/^@/, ""))}</a>` : ` <code>${escapeHtml(subscription.label)}</code>`;
    return `${index2 + 1}. (${kindLabel})${link}`;
  }).join("\n");
  return `\u{1F512} <b>\u0627\u0634\u062A\u0631\u0627\u0643 \u0625\u062C\u0628\u0627\u0631\u064A</b>

\u0644\u0644\u062D\u0635\u0648\u0644 \u0639\u0644\u0649 \u062E\u062F\u0645\u0629 \u0627\u0644\u062A\u0646\u0632\u064A\u0644 \u064A\u062C\u0628 \u0627\u0644\u0627\u0634\u062A\u0631\u0627\u0643 \u0623\u0648\u0644\u0627\u064B \u0641\u064A:

${items}

\u0627\u0636\u063A\u0637 \u0632\u0631 \u0627\u0644\u0627\u0634\u062A\u0631\u0627\u0643 \u062B\u0645 \u0632\u0631 <b>\xAB\u062A\u062D\u0642\u0642\u062A \u0645\u0646 \u0627\u0644\u0627\u0634\u062A\u0631\u0627\u0643\xBB</b>.`;
}
function subscriptionGateKeyboard(missing) {
  const joinRows = missing.filter((subscription) => Boolean(subscription.inviteUrl)).map((subscription) => [{ text: `\u{1F517} \u0627\u0634\u062A\u0631\u0643 \u0627\u0644\u0622\u0646 \xB7 ${subscription.label}`, url: subscription.inviteUrl }]);
  return {
    inline_keyboard: [
      ...joinRows,
      [inlineButton("\u2705 \u062A\u062D\u0642\u0642\u062A \u0645\u0646 \u0627\u0644\u0627\u0634\u062A\u0631\u0627\u0643", "sub_check", "primary")]
    ]
  };
}
function inspectionText(result) {
  const duration = result.durationSeconds ? `
\u0627\u0644\u0645\u062F\u0629 \u0627\u0644\u062A\u0642\u0631\u064A\u0628\u064A\u0629: <b>${Math.round(result.durationSeconds)} \u062B\u0627\u0646\u064A\u0629</b>` : "";
  const imagesCount = result.imageCount && result.imageCount > 1 ? `
\u{1F5BC} \u0639\u062F\u062F \u0627\u0644\u0635\u0648\u0631 \u0627\u0644\u0645\u062A\u0627\u062D\u0629: <b>${result.imageCount}</b>` : "";
  const platformLabels = {
    tiktok: "TikTok",
    instagram: "Instagram",
    facebook: "Facebook",
    snapchat: "Snapchat",
    pinterest: "Pinterest",
    twitter: "Twitter/X"
  };
  let accountBlock = "";
  const account = result.account;
  if (account) {
    const lines = [];
    if (account.nickname || account.username) lines.push(`\u{1F464} <b>${escapeHtml(account.nickname || account.username)}</b>`);
    if (account.username) {
      const verifiedMark = account.verified ? " \u2705 \u0645\u0648\u062B\u0642" : "";
      lines.push(`\u0645\u0639\u0631\u0651\u0641: <code>@${escapeHtml(account.username)}</code>${verifiedMark}`);
    } else if (account.verified) {
      lines.push("\u2705 \u062D\u0633\u0627\u0628 \u0645\u0648\u062B\u0642");
    }
    const stats = [];
    if (account.followers !== void 0) stats.push(`\u{1F465} <b>${formatCount(account.followers)}</b> \u0645\u062A\u0627\u0628\u0639`);
    if (account.posts !== void 0) stats.push(`\u{1F4F9} <b>${formatCount(account.posts)}</b> \u0645\u0646\u0634\u0648\u0631`);
    if (account.hearts !== void 0) stats.push(`\u2764\uFE0F <b>${formatCount(account.hearts)}</b> \u0625\u0639\u062C\u0627\u0628`);
    if (stats.length) lines.push(stats.join(" \u2022 "));
    const region = countryLabel(account.region);
    if (region) lines.push(`\u{1F4CD} \u0627\u0644\u062F\u0648\u0644\u0629: <b>${escapeHtml(region)}</b>`);
    if (account.signature) lines.push(`\u270D\uFE0F ${escapeHtml(account.signature.slice(0, 150))}`);
    if (account.profileUrl) lines.push(`\u{1F517} <code>${escapeHtml(account.profileUrl)}</code>`);
    accountBlock = `

${lines.join("\n")}`;
  }
  return `\u2726 <b>\u062A\u0645 \u0641\u062D\u0635 \u0627\u0644\u0631\u0627\u0628\u0637</b>

\u0627\u0644\u0645\u0646\u0635\u0629: <b>${platformLabels[result.platform]}</b>
\u0627\u0644\u0639\u0646\u0648\u0627\u0646: <b>${escapeHtml(result.title)}</b>${duration}${imagesCount}${accountBlock}

\u0627\u062E\u062A\u0631 \u0646\u0648\u0639 \u0627\u0644\u0645\u0644\u0641 \u0627\u0644\u0645\u0646\u0627\u0633\u0628. \u0644\u0627 \u064A\u064F\u0639\u0631\u0636 \u0625\u0644\u0627 \u0645\u0627 \u0623\u0643\u062F\u0647 \u0627\u0644\u0641\u062D\u0635 \u0645\u0646 \u0647\u0630\u0627 \u0627\u0644\u0631\u0627\u0628\u0637 \u0627\u0644\u0639\u0627\u0645.`;
}
var MEDIA_BUTTONS = {
  video: { text: "\u{1F3AC} \u062A\u0646\u0632\u064A\u0644 \u0641\u064A\u062F\u064A\u0648", style: "primary", iconEnv: "BUTTON_CUSTOM_EMOJI_DOWNLOAD" },
  audio: { text: "\u{1F3B5} \u062A\u0646\u0632\u064A\u0644 \u0635\u0648\u062A", style: "success", iconEnv: "BUTTON_CUSTOM_EMOJI_AUDIO" },
  image: { text: "\u{1F5BC} \u062A\u0646\u0632\u064A\u0644 \u0635\u0648\u0631\u0629 \u0623\u0635\u0644\u064A\u0629", style: "primary", iconEnv: "BUTTON_CUSTOM_EMOJI_IMAGE" },
  story: { text: "\u{1F4D6} \u062A\u0646\u0632\u064A\u0644 \u0627\u0644\u0633\u062A\u0648\u0631\u064A", style: "success", iconEnv: "BUTTON_CUSTOM_EMOJI_STORY" }
};
function mediaChoiceKeyboard(jobId, choices, imageCount) {
  const rows = choices.map((choice) => [inlineButton(MEDIA_BUTTONS[choice].text, `dl:${jobId}:${choice}`, MEDIA_BUTTONS[choice].style, MEDIA_BUTTONS[choice].iconEnv)]);
  if (imageCount && imageCount > 1 && choices.includes("image")) {
    rows.push([inlineButton(`\u{1F5BC} \u062A\u0646\u0632\u064A\u0644 \u0627\u0644\u0635\u0648\u0631 \u0643\u0627\u0645\u0644\u0629 (${imageCount})`, `dl:${jobId}:images`, "success", "BUTTON_CUSTOM_EMOJI_IMAGE")]);
  }
  rows.push([inlineButton("\u2716\uFE0F \u0625\u0644\u063A\u0627\u0621 \u0627\u0644\u0639\u0645\u0644\u064A\u0629", `cancel:${jobId}`, "danger", "BUTTON_CUSTOM_EMOJI_CANCEL")]);
  return { inline_keyboard: rows };
}
function retryTikTokKeyboard(jobId) {
  return {
    inline_keyboard: [[inlineButton("\u{1F504} \u0625\u0639\u0627\u062F\u0629 \u0645\u062D\u0627\u0648\u0644\u0629 TikTok", `retry_tiktok:${jobId}`, "primary")]]
  };
}

// server/telegram/botService.ts
var recentRequests = /* @__PURE__ */ new Map();
var pendingAdminInputs = /* @__PURE__ */ new Map();
var pendingReports = /* @__PURE__ */ new Map();
var ownerPageStacks = /* @__PURE__ */ new Map();
var primaryOwnerEnsured = false;
var legacyOwnerLabels = {
  "\u2705 \u0627\u0644\u062D\u0627\u0636\u0631\u0648\u0646": "\u2705 \u0627\u0644\u0646\u0634\u0637\u0648\u0646",
  "\u{1F512} \u062D\u0638\u0631 \u0645\u0633\u062A\u062E\u062F\u0645": "\u{1F6AB} \u062D\u0638\u0631 \u0645\u0633\u062A\u062E\u062F\u0645",
  "\u{1F513} \u0641\u0643 \u0627\u0644\u062D\u0638\u0631": "\u2705 \u0641\u0643 \u0627\u0644\u062D\u0638\u0631",
  "\u{1F4E3} \u0631\u0633\u0627\u0644\u0629 \u062C\u0645\u0627\u0639\u064A\u0629": "\u{1F4E3} \u0625\u0631\u0633\u0627\u0644 \u0644\u0644\u062C\u0645\u064A\u0639",
  "\u2699\uFE0F \u062D\u062F \u0627\u0644\u0645\u0633\u062A\u062E\u062F\u0645\u064A\u0646": "\u2699\uFE0F \u0633\u0639\u0629 \u0627\u0644\u0628\u0648\u062A",
  "\u{1F5D3} \u0625\u0639\u062F\u0627\u062F \u0627\u0644\u062A\u0646\u0638\u064A\u0641": "\u23F1\uFE0F \u0645\u062F\u0629 \u0627\u0644\u062A\u0646\u0638\u064A\u0641",
  "\u{1F9F9} \u062A\u0646\u0638\u064A\u0641 \u0627\u0644\u0628\u064A\u0627\u0646\u0627\u062A": "\u{1F9F9} \u062A\u0646\u0638\u064A\u0641 \u0627\u0644\u0628\u064A\u0627\u0646\u0627\u062A",
  "\u{1F4CB} \u0633\u062C\u0644\u0627\u062A \u0627\u0644\u0623\u062E\u0637\u0627\u0621": "\u{1F4CB} \u0623\u062E\u0637\u0627\u0621 \u062D\u062F\u064A\u062B\u0629"
};
var ownerControlLabels = /* @__PURE__ */ new Set([
  "\u{1F4CA} \u0627\u0644\u0625\u062D\u0635\u0627\u0621\u0627\u062A",
  "\u{1F465} \u0625\u062F\u0627\u0631\u0629 \u0627\u0644\u0645\u0633\u062A\u062E\u062F\u0645\u064A\u0646",
  "\u{1F465} \u0622\u062E\u0631 \u0627\u0644\u0645\u0633\u062A\u062E\u062F\u0645\u064A\u0646",
  "\u2705 \u0627\u0644\u0646\u0634\u0637\u0648\u0646",
  "\u{1F319} \u063A\u064A\u0631 \u0627\u0644\u0646\u0634\u0637\u064A\u0646",
  "\u{1F6AB} \u0627\u0644\u0645\u062D\u0638\u0648\u0631\u0648\u0646",
  "\u{1F6AB} \u062D\u0638\u0631 \u0645\u0633\u062A\u062E\u062F\u0645",
  "\u2705 \u0641\u0643 \u0627\u0644\u062D\u0638\u0631",
  "\u{1F512} \u0627\u0644\u0627\u0634\u062A\u0631\u0627\u0643 \u0627\u0644\u0625\u062C\u0628\u0627\u0631\u064A",
  "\u2795 \u0625\u0636\u0627\u0641\u0629 \u0642\u0646\u0627\u0629/\u0628\u0648\u062A",
  "\u2796 \u0625\u0632\u0627\u0644\u0629 \u0642\u0646\u0627\u0629/\u0628\u0648\u062A",
  "\u{1F4CB} \u0642\u0627\u0626\u0645\u0629 \u0627\u0644\u0627\u0634\u062A\u0631\u0627\u0643",
  "\u2699\uFE0F \u0627\u0644\u0625\u0639\u062F\u0627\u062F\u0627\u062A",
  "\u23F1\uFE0F \u0645\u062F\u0629 \u0627\u0644\u062A\u0646\u0638\u064A\u0641",
  "\u{1F9F9} \u062A\u0646\u0638\u064A\u0641 \u0627\u0644\u0628\u064A\u0627\u0646\u0627\u062A",
  "\u{1F9F9} \u062A\u0646\u0638\u064A\u0641 \u0627\u0644\u0622\u0646",
  "\u{1F4E3} \u0625\u0631\u0633\u0627\u0644 \u0644\u0644\u062C\u0645\u064A\u0639",
  "\u{1F4CB} \u0623\u062E\u0637\u0627\u0621 \u062D\u062F\u064A\u062B\u0629",
  "\u21A9\uFE0F \u0631\u062C\u0648\u0639",
  "\u{1F3E0} \u0627\u0644\u0631\u0626\u064A\u0633\u064A\u0629",
  "\u{1F6D1} \u0625\u0644\u063A\u0627\u0621 \u0627\u0644\u0639\u0645\u0644\u064A\u0629",
  "\u21A9\uFE0F \u0625\u0644\u063A\u0627\u0621 \u0627\u0644\u0625\u062F\u062E\u0627\u0644",
  "/admin"
]);
function allowRequest(telegramId) {
  const now = Date.now();
  const entries = (recentRequests.get(telegramId) || []).filter((value) => now - value < 6e4);
  if (entries.length >= 5) return false;
  entries.push(now);
  recentRequests.set(telegramId, entries);
  return true;
}
var recentCallbacks = /* @__PURE__ */ new Map();
function allowCallback(telegramId, limit = 15) {
  const now = Date.now();
  const entries = (recentCallbacks.get(telegramId) || []).filter((value) => now - value < 6e4);
  if (entries.length >= limit) return false;
  entries.push(now);
  recentCallbacks.set(telegramId, entries);
  return true;
}
function userName(message) {
  return message.from?.first_name || "\u0635\u062F\u064A\u0642\u0646\u0627";
}
function keyboardFor(primary) {
  return primary ? OWNER_KEYBOARD : USER_KEYBOARD;
}
function mediaLabel(choice) {
  return choice === "video" ? "\u0641\u064A\u062F\u064A\u0648" : choice === "audio" ? "\u0635\u0648\u062A" : choice === "image" ? "\u0635\u0648\u0631\u0629" : choice === "story" ? "\u0642\u0635\u0629" : "\u0648\u0633\u064A\u0637 \u063A\u064A\u0631 \u0645\u062D\u062F\u062F";
}
function errorText(error) {
  return error instanceof Error ? error.message : String(error);
}
function isTikTokExtractorError(message) {
  return /\[TikTok\].*Unexpected response from webpage request|Unexpected response from webpage request/i.test(message);
}
function userFacingMediaError(error) {
  const message = errorText(error);
  if (isTikTokExtractorError(message)) {
    return "\u062A\u0639\u0630\u0631 \u0627\u0644\u0648\u0635\u0648\u0644 \u0625\u0644\u0649 \u0635\u0641\u062D\u0629 TikTok \u0645\u0624\u0642\u062A\u0627\u064B \u0628\u0633\u0628\u0628 \u062D\u0645\u0627\u064A\u0629 \u0627\u0644\u0645\u0635\u062F\u0631. \u0623\u0639\u062F \u0625\u0631\u0633\u0627\u0644 \u0627\u0644\u0631\u0627\u0628\u0637 \u0628\u0639\u062F \u0642\u0644\u064A\u0644\u061B \u0633\u064A\u062D\u0627\u0648\u0644 \u0627\u0644\u0628\u0648\u062A \u0645\u062A\u0635\u0641\u062D\u0627\u064B \u0645\u062A\u0648\u0627\u0641\u0642\u0627\u064B \u062A\u0644\u0642\u0627\u0626\u064A\u0627\u064B.";
  }
  if (error instanceof PublicLinkError || error instanceof DownloaderError) return message;
  return "\u062A\u0639\u0630\u0631 \u0641\u062D\u0635 \u0627\u0644\u0631\u0627\u0628\u0637 \u0627\u0644\u0622\u0646. \u062C\u0631\u0651\u0628 \u0631\u0627\u0628\u0637\u0627\u064B \u0639\u0627\u0645\u0627\u064B \u0622\u062E\u0631 \u0644\u0627\u062D\u0642\u0627\u064B.";
}
function ownerFacingMediaError(error) {
  const message = errorText(error);
  if (isTikTokExtractorError(message)) {
    return "\u0631\u0641\u0636 TikTok \u0637\u0644\u0628 \u0627\u0644\u0635\u0641\u062D\u0629 \u0645\u0624\u0642\u062A\u0627\u064B. \u0644\u0645 \u064A\u064F\u0639\u0631\u0636 \u062E\u0637\u0623 \u0627\u0644\u0645\u062D\u0631\u0643 \u0627\u0644\u062E\u0627\u0645 \u0644\u0644\u0645\u0633\u062A\u062E\u062F\u0645\u061B \u0631\u0627\u062C\u0639 \u062A\u0648\u0641\u0631 \u0627\u0644\u0645\u0635\u062F\u0631 \u062B\u0645 \u0623\u0639\u062F \u0627\u0644\u0645\u062D\u0627\u0648\u0644\u0629.";
  }
  return message.slice(0, 1e3);
}
function isRetryableTikTokFailure(error, platform) {
  if (platform !== "tiktok") return false;
  const message = errorText(error);
  return /TikTok.*(حماية المصدر|رفض|تعذر الوصول)|\[TikTok\].*Unexpected response from webpage request|Unexpected response from webpage request/i.test(message);
}
function beginAdminInput(telegramId, action) {
  pendingAdminInputs.set(telegramId, { action, expiresAt: Date.now() + 10 * 6e4 });
}
function ownerStack(telegramId) {
  let stack = ownerPageStacks.get(telegramId);
  if (!stack) {
    stack = ["main"];
    ownerPageStacks.set(telegramId, stack);
  }
  return stack;
}
function ownerKeyboardFor(telegramId) {
  const current = ownerStack(telegramId)[ownerStack(telegramId).length - 1];
  if (current === "users") return OWNER_USERS_KEYBOARD;
  if (current === "settings") return OWNER_SETTINGS_KEYBOARD;
  if (current === "subscriptions") return OWNER_SUBSCRIPTIONS_KEYBOARD;
  if (current === "cleanup") return OWNER_CLEANUP_KEYBOARD;
  return OWNER_KEYBOARD;
}
function normalizeOwnerLabel(text2) {
  return legacyOwnerLabels[text2] || text2;
}
function isOwnerControlLabel(text2) {
  return ownerControlLabels.has(normalizeOwnerLabel(text2));
}
async function ensureBotPrimaryOwner() {
  if (primaryOwnerEnsured) return;
  await ensurePrimaryOwner();
  primaryOwnerEnsured = true;
}
async function notifyOwners(text2, options = {}) {
  const { listOwners: listOwners2 } = await Promise.resolve().then(() => (init_botDb(), botDb_exports));
  const configuredPrimary = (process.env.OWNER_ID || "").trim();
  const owners = await listOwners2().catch(() => []);
  const recipients = Array.from(new Set([...owners.map((owner) => owner.telegramId), configuredPrimary].filter(Boolean)));
  await Promise.allSettled(recipients.map((ownerId) => sendMessage(ownerId, text2, options)));
}
function buildReportNotification(message, report) {
  const sender = message.from;
  const telegramId = String(sender.id);
  const displayName = userName(message);
  const username = sender.username?.replace(/^@/, "").trim();
  const profileUrl = username ? `https://t.me/${encodeURIComponent(username)}` : `tg://user?id=${encodeURIComponent(telegramId)}`;
  const identity = username ? `\u0627\u0644\u0627\u0633\u0645: <a href="${profileUrl}">${escapeHtml(displayName)}</a>
\u0627\u0644\u0645\u0639\u0631\u0641: @${escapeHtml(username)}` : `\u0627\u0644\u0627\u0633\u0645: <a href="${profileUrl}">${escapeHtml(displayName)}</a>
\u0627\u0644\u0645\u0639\u0631\u0651\u0641: <code>${telegramId}</code>`;
  return {
    text: `\u{1F4E9} <b>\u0628\u0644\u0627\u063A \u062C\u062F\u064A\u062F</b>
${identity}
\u0627\u0644\u0645\u0639\u0631\u0651\u0641 \u0627\u0644\u0631\u0642\u0645\u064A: <code>${telegramId}</code>

<b>\u0627\u0644\u062A\u0641\u0627\u0635\u064A\u0644</b>
${escapeHtml(report.slice(0, 2500))}`,
    replyMarkup: {
      inline_keyboard: [[{ text: "\u{1F464} \u0641\u062A\u062D \u0645\u0644\u0641 \u0627\u0644\u0645\u0633\u062A\u062E\u062F\u0645", url: profileUrl }]]
    }
  };
}
async function notifyError(input) {
  const message = ownerFacingMediaError(input.error);
  await recordBotError({ telegramId: input.telegramId, sourceUrl: input.sourceUrl, stage: input.stage, message });
  await notifyOwners(`\u26A0\uFE0F <b>\u062E\u0637\u0623 \u0641\u064A \u0627\u0644\u0628\u0648\u062A</b>
\u0627\u0644\u0645\u0631\u062D\u0644\u0629: <b>${escapeHtml(input.stage)}</b>
\u0627\u0644\u0646\u0648\u0639: <b>${mediaLabel(input.mediaChoice)}</b>
\u0627\u0644\u0645\u0633\u062A\u062E\u062F\u0645: <code>${escapeHtml(input.telegramId || "\u063A\u064A\u0631 \u0645\u0639\u0631\u0648\u0641")}</code>
\u0627\u0644\u0631\u0627\u0628\u0637: <code>${escapeHtml(input.sourceUrl || "\u063A\u064A\u0631 \u0645\u062A\u0627\u062D")}</code>
\u0627\u0644\u062E\u0637\u0623: <code>${escapeHtml(message)}</code>`);
}
async function admitMessage(message) {
  if (!message.from || message.chat.type !== "private") return { admitted: false, primary: false };
  await ensureBotPrimaryOwner();
  const admission = await touchAndAdmitUser(message.from);
  const telegramId = String(message.from.id);
  if (admission.admission === "blocked") {
    await sendMessage(String(message.chat.id), "\u0639\u0630\u0631\u0627\u064B\u060C \u0644\u0627 \u064A\u0645\u0643\u0646\u0643 \u0627\u0633\u062A\u062E\u062F\u0627\u0645 \u0647\u0630\u0627 \u0627\u0644\u0628\u0648\u062A \u062D\u0627\u0644\u064A\u0627\u064B.");
    return { admitted: false, primary: false };
  }
  const primary = await isPrimaryOwner(telegramId);
  if (admission.isNew) {
    await notifyOwners(`\u{1F464} <b>\u0645\u0633\u062A\u062E\u062F\u0645 \u062C\u062F\u064A\u062F</b>
\u0627\u0644\u0627\u0633\u0645: <b>${escapeHtml(userName(message))}</b>
\u0627\u0644\u0645\u0639\u0631\u0651\u0641: <code>${telegramId}</code>${message.from.username ? `
\u0627\u0644\u0645\u0639\u0631\u0641: @${escapeHtml(message.from.username)}` : ""}`);
  }
  return { admitted: true, primary };
}
async function checkForcedSubscriptions(telegramId) {
  const subscriptions = await listForcedSubscriptions();
  if (!subscriptions.length) return [];
  const missing = [];
  for (const subscription of subscriptions) {
    if (subscription.kind === "bot") continue;
    let member = false;
    try {
      const chatMember = await getChatMember(subscription.target, telegramId);
      member = ["creator", "administrator", "member"].includes(chatMember.status || "");
    } catch {
      member = false;
    }
    if (!member) missing.push(subscription);
  }
  return missing;
}
async function inspectIncomingLink(message, rawUrl, primary) {
  const telegramId = String(message.from.id);
  const chatId = String(message.chat.id);
  if (!allowRequest(telegramId)) {
    await sendMessage(chatId, "\u23F3 \u0644\u062F\u064A\u0643 \u0637\u0644\u0628\u0627\u062A \u0643\u062B\u064A\u0631\u0629 \u062E\u0644\u0627\u0644 \u0627\u0644\u062F\u0642\u064A\u0642\u0629. \u0627\u0646\u062A\u0638\u0631 \u0642\u0644\u064A\u0644\u0627\u064B \u062B\u0645 \u0623\u0631\u0633\u0644 \u0631\u0627\u0628\u0637\u0627\u064B \u062C\u062F\u064A\u062F\u0627\u064B.", { replyMarkup: keyboardFor(primary) });
    return;
  }
  const { platform } = inspectSupportedUrl(rawUrl);
  const jobId = await createMediaJob(telegramId, rawUrl, platform);
  await sendChatAction(chatId, "typing").catch(() => void 0);
  await sendMessage(chatId, "\u231B <b>\u062C\u0627\u0631\u064D \u0641\u062D\u0635 \u0627\u0644\u0631\u0627\u0628\u0637\u2026</b> \u0633\u062A\u0638\u0647\u0631 \u062E\u064A\u0627\u0631\u0627\u062A \u0627\u0644\u062A\u0646\u0632\u064A\u0644 \u0627\u0644\u0645\u062A\u0627\u062D\u0629 \u062A\u0644\u0642\u0627\u0626\u064A\u0627\u064B. \u064A\u0645\u0643\u0646\u0643 \u0627\u0644\u0636\u063A\u0637 \u0639\u0644\u0649 \xAB\u0625\u0644\u063A\u0627\u0621 \u0627\u0644\u0639\u0645\u0644\u064A\u0629\xBB \u0641\u064A \u0623\u064A \u0648\u0642\u062A.", { replyMarkup: keyboardFor(primary) });
  try {
    const result = await inspectMediaLink(rawUrl, jobId);
    const job = await getMediaJob(jobId);
    if (!job || job.cancelRequested) return;
    await updateMediaJob(jobId, { status: "ready", choicesJson: JSON.stringify(result.choices) });
    await sendMessage(chatId, inspectionText(result), { replyMarkup: mediaChoiceKeyboard(jobId, result.choices, result.imageCount) });
  } catch (error) {
    if (error instanceof DownloaderError && error.message === "\u062A\u0645 \u0625\u0644\u063A\u0627\u0621 \u0627\u0644\u0639\u0645\u0644\u064A\u0629 \u0628\u0646\u062C\u0627\u062D.") return;
    const retryableTikTok = isRetryableTikTokFailure(error, platform);
    if (retryableTikTok) await updateMediaJob(jobId, { status: "failed" });
    else await deleteMediaJob(jobId);
    const messageText = userFacingMediaError(error);
    const retryMarkup = retryableTikTok ? retryTikTokKeyboard(jobId) : keyboardFor(primary);
    const retryHint = retryableTikTok ? "\n\n\u064A\u0645\u0643\u0646\u0643 \u0627\u0644\u0636\u063A\u0637 \u0639\u0644\u0649 \xAB\u0625\u0639\u0627\u062F\u0629 \u0645\u062D\u0627\u0648\u0644\u0629 TikTok\xBB \u0644\u0625\u0639\u0627\u062F\u0629 \u0627\u0644\u0641\u062D\u0635 \u062A\u0644\u0642\u0627\u0626\u064A\u0627\u064B." : "";
    await sendMessage(chatId, `\u062A\u0639\u0630\u0631 \u0625\u0643\u0645\u0627\u0644 \u0627\u0644\u0641\u062D\u0635.
<b>${escapeHtml(messageText)}</b>${retryHint}`, { replyMarkup: retryMarkup });
    await notifyError({ telegramId, sourceUrl: rawUrl, stage: "\u0641\u062D\u0635 \u0627\u0644\u0631\u0627\u0628\u0637", error });
  }
}
function formatStats(stats) {
  return `\u{1F4CA} <b>\u0625\u062D\u0635\u0627\u0621\u0627\u062A \u0633\u0631\u064A\u0639\u0629</b>

\u0627\u0644\u0645\u0633\u062A\u062E\u062F\u0645\u0648\u0646: <b>${stats.total}</b>
\u0627\u0644\u0646\u0634\u0637\u0648\u0646 \u0627\u0644\u064A\u0648\u0645: <b>${stats.activeToday}</b>
\u0627\u0644\u062C\u062F\u062F \u0627\u0644\u064A\u0648\u0645: <b>${stats.joinedToday}</b>
\u0627\u0644\u0645\u062D\u0638\u0648\u0631\u0648\u0646: <b>${stats.blocked}</b>
\u063A\u064A\u0631 \u0627\u0644\u0646\u0634\u0637\u064A\u0646: <b>${stats.inactive}</b>
\u0627\u0644\u062A\u0646\u0638\u064A\u0641 \u0628\u0639\u062F: <b>${stats.settings.cleanupInactiveDays} \u064A\u0648\u0645\u0627\u064B</b>`;
}
async function sendAdminPanel(chatId, telegramId) {
  ownerStack(telegramId).length = 0;
  ownerStack(telegramId).push("main");
  await sendMessage(chatId, "\u{1F451} <b>\u0644\u0648\u062D\u0629 \u0627\u0644\u0645\u0627\u0644\u0643 \u0627\u0644\u0623\u0633\u0627\u0633\u064A\u0629</b>\n\u0627\u062E\u062A\u0631 \u0648\u0638\u064A\u0641\u0629 \u0645\u0646 \u0627\u0644\u0623\u0632\u0631\u0627\u0631. \u0639\u0646\u062F \u0627\u0644\u062D\u0627\u062C\u0629 \u0644\u0631\u0642\u0645 \u0623\u0648 \u0646\u0635 \u0633\u0623\u0637\u0644\u0628\u0647 \u0645\u0646\u0643 \u0641\u064A \u0631\u0633\u0627\u0644\u0629 \u0645\u0646\u0641\u0635\u0644\u0629.", { replyMarkup: OWNER_KEYBOARD });
}
async function sendUserList(chatId, title, users2, replyMarkup) {
  if (!users2.length) return sendMessage(chatId, `\u0644\u0627 \u062A\u0648\u062C\u062F \u0646\u062A\u0627\u0626\u062C \u0641\u064A \u0642\u0627\u0626\u0645\u0629 \xAB${title}\xBB.`, { replyMarkup });
  const lines = users2.map((user, index2) => `${index2 + 1}. <b>${escapeHtml(user.displayName)}</b>${user.username ? ` (@${escapeHtml(user.username)})` : ""}
<code>${user.telegramId}</code> \u2014 ${user.status === "blocked" ? "\u0645\u062D\u0638\u0648\u0631" : "\u0646\u0634\u0637"}`);
  return sendMessage(chatId, `\u{1F465} <b>${title}</b>

${lines.join("\n")}`, { replyMarkup });
}
function pendingInputPrompt(action) {
  const prompts = {
    ban: "\u0623\u0631\u0633\u0644 \u0627\u0644\u0622\u0646 \u0631\u0642\u0645 \u0627\u0644\u0645\u0633\u062A\u062E\u062F\u0645 \u0623\u0648 @username \u0644\u062D\u0638\u0631\u0647.",
    unban: "\u0623\u0631\u0633\u0644 \u0627\u0644\u0622\u0646 \u0631\u0642\u0645 \u0627\u0644\u0645\u0633\u062A\u062E\u062F\u0645 \u0623\u0648 @username \u0644\u0641\u0643 \u0627\u0644\u062D\u0638\u0631.",
    cleanup: "\u0623\u0631\u0633\u0644 \u0639\u062F\u062F \u0627\u0644\u0623\u064A\u0627\u0645 \u0642\u0628\u0644 \u062A\u0646\u0638\u064A\u0641 \u063A\u064A\u0631 \u0627\u0644\u0646\u0634\u0637\u064A\u0646\u060C \u0645\u0646 7 \u0625\u0644\u0649 365.",
    broadcast: "\u0623\u0631\u0633\u0644 \u0627\u0644\u0622\u0646 \u0646\u0635 \u0627\u0644\u0631\u0633\u0627\u0644\u0629. \u0633\u062A\u0635\u0644 \u0644\u0644\u0645\u0633\u062A\u062E\u062F\u0645\u064A\u0646 \u0627\u0644\u0646\u0634\u0637\u064A\u0646 \u0641\u0642\u0637.",
    addChannel: "\u0623\u0631\u0633\u0644 \u0645\u0639\u0631\u0641 \u0627\u0644\u0642\u0646\u0627\u0629 \u0623\u0648 \u0627\u0644\u0645\u062C\u0645\u0648\u0639\u0629 \u0623\u0648 \u0627\u0644\u0628\u0648\u062A:\n- @username\n- \u0623\u0648 \u0631\u0642\u0645 \u0627\u0644\u0642\u0646\u0627\u0629\n- \u0623\u0648 \u0631\u0627\u0628\u0637 t.me/username",
    removeChannel: "\u0623\u0631\u0633\u0644 \u0645\u0639\u0631\u0641 \u0627\u0644\u0642\u0646\u0627\u0629 \u0623\u0648 @username \u0623\u0648 \u0645\u0639\u0631\u0651\u0641\u0647\u0627 \u0645\u0646 \u0642\u0627\u0626\u0645\u0629 \u0627\u0644\u0627\u0634\u062A\u0631\u0627\u0643."
  };
  return prompts[action];
}
async function handleOwnerButton(message, text2) {
  const chatId = String(message.chat.id);
  const telegramId = String(message.from.id);
  text2 = normalizeOwnerLabel(text2);
  const replyMarkup = ownerKeyboardFor(telegramId);
  if (text2 === "\u21A9\uFE0F \u0631\u062C\u0648\u0639") {
    const stack = ownerStack(telegramId);
    if (stack.length > 1) stack.pop();
    await sendMessage(chatId, "\u21A9\uFE0F <b>\u0631\u062C\u0648\u0639</b>", { replyMarkup: ownerKeyboardFor(telegramId) });
    return true;
  }
  if (text2 === "\u{1F3E0} \u0627\u0644\u0631\u0626\u064A\u0633\u064A\u0629") {
    const stack = ownerStack(telegramId);
    stack.length = 0;
    stack.push("main");
    await sendMessage(chatId, "\u{1F3E0} <b>\u0627\u0644\u0631\u0626\u064A\u0633\u064A\u0629</b>", { replyMarkup: OWNER_KEYBOARD });
    return true;
  }
  if (text2 === "\u{1F465} \u0625\u062F\u0627\u0631\u0629 \u0627\u0644\u0645\u0633\u062A\u062E\u062F\u0645\u064A\u0646") {
    ownerStack(telegramId).push("users");
    await sendMessage(chatId, "\u{1F465} <b>\u0625\u062F\u0627\u0631\u0629 \u0627\u0644\u0645\u0633\u062A\u062E\u062F\u0645\u064A\u0646</b>\n\u0627\u0644\u0642\u0648\u0627\u0626\u0645\u060C \u0627\u0644\u062D\u0638\u0631\u060C \u0648\u0641\u0643 \u0627\u0644\u062D\u0638\u0631.", { replyMarkup: OWNER_USERS_KEYBOARD });
    return true;
  }
  if (text2 === "\u{1F512} \u0627\u0644\u0627\u0634\u062A\u0631\u0627\u0643 \u0627\u0644\u0625\u062C\u0628\u0627\u0631\u064A") {
    ownerStack(telegramId).push("subscriptions");
    await sendMessage(chatId, "\u{1F512} <b>\u0627\u0644\u0627\u0634\u062A\u0631\u0627\u0643 \u0627\u0644\u0625\u062C\u0628\u0627\u0631\u064A</b>\n\u0623\u0636\u0641 \u0627\u0644\u0642\u0646\u0648\u0627\u062A \u0623\u0648 \u0627\u0644\u0645\u062C\u0645\u0648\u0639\u0627\u062A \u0623\u0648 \u0627\u0644\u0628\u0648\u062A\u0627\u062A \u0627\u0644\u0645\u0637\u0644\u0648\u0628\u0629 \u0642\u0628\u0644 \u0627\u0633\u062A\u062E\u062F\u0627\u0645 \u0627\u0644\u0628\u0648\u062A. \u0645\u0644\u0643\u064A\u0629 \u0627\u0644\u0639\u0636\u0648\u064A\u0629 \u062A\u064F\u0641\u062D\u0635 \u062A\u0644\u0642\u0627\u0626\u064A\u0627\u064B \u0642\u0628\u0644 \u062A\u0646\u0632\u064A\u0644 \u0623\u064A \u0631\u0627\u0628\u0637.", { replyMarkup: OWNER_SUBSCRIPTIONS_KEYBOARD });
    return true;
  }
  if (text2 === "\u2699\uFE0F \u0627\u0644\u0625\u0639\u062F\u0627\u062F\u0627\u062A") {
    ownerStack(telegramId).push("settings");
    await sendMessage(chatId, "\u2699\uFE0F <b>\u0627\u0644\u0625\u0639\u062F\u0627\u062F\u0627\u062A</b>", { replyMarkup: OWNER_SETTINGS_KEYBOARD });
    return true;
  }
  if (text2 === "\u{1F9F9} \u062A\u0646\u0638\u064A\u0641 \u0627\u0644\u0628\u064A\u0627\u0646\u0627\u062A") {
    ownerStack(telegramId).push("cleanup");
    await sendMessage(chatId, "\u{1F9F9} <b>\u062A\u0646\u0638\u064A\u0641 \u0627\u0644\u0628\u064A\u0627\u0646\u0627\u062A</b>", { replyMarkup: OWNER_CLEANUP_KEYBOARD });
    return true;
  }
  if (text2 === "\u{1F4CA} \u0627\u0644\u0625\u062D\u0635\u0627\u0621\u0627\u062A") {
    const { botStats: botStats2 } = await Promise.resolve().then(() => (init_botDb(), botDb_exports));
    await sendMessage(chatId, formatStats(await botStats2()), { replyMarkup: OWNER_KEYBOARD });
    return true;
  }
  if (text2 === "\u{1F465} \u0622\u062E\u0631 \u0627\u0644\u0645\u0633\u062A\u062E\u062F\u0645\u064A\u0646") {
    const { listTelegramUsers: listTelegramUsers2 } = await Promise.resolve().then(() => (init_botDb(), botDb_exports));
    await sendUserList(chatId, "\u0622\u062E\u0631 50 \u0645\u0633\u062A\u062E\u062F\u0645\u0627\u064B", await listTelegramUsers2("recent"), replyMarkup);
    return true;
  }
  if (text2 === "\u2705 \u0627\u0644\u0646\u0634\u0637\u0648\u0646") {
    const { listTelegramUsers: listTelegramUsers2 } = await Promise.resolve().then(() => (init_botDb(), botDb_exports));
    await sendUserList(chatId, "\u0627\u0644\u0645\u0633\u062A\u062E\u062F\u0645\u0648\u0646 \u0627\u0644\u0646\u0634\u0637\u0648\u0646", await listTelegramUsers2("active"), replyMarkup);
    return true;
  }
  if (text2 === "\u{1F319} \u063A\u064A\u0631 \u0627\u0644\u0646\u0634\u0637\u064A\u0646") {
    const { listTelegramUsers: listTelegramUsers2 } = await Promise.resolve().then(() => (init_botDb(), botDb_exports));
    await sendUserList(chatId, "\u0627\u0644\u0645\u0633\u062A\u062E\u062F\u0645\u0648\u0646 \u063A\u064A\u0631 \u0627\u0644\u0646\u0634\u0637\u064A\u0646", await listTelegramUsers2("inactive"), replyMarkup);
    return true;
  }
  if (text2 === "\u{1F6AB} \u0627\u0644\u0645\u062D\u0638\u0648\u0631\u0648\u0646") {
    const { listTelegramUsers: listTelegramUsers2 } = await Promise.resolve().then(() => (init_botDb(), botDb_exports));
    await sendUserList(chatId, "\u0627\u0644\u0645\u0633\u062A\u062E\u062F\u0645\u0648\u0646 \u0627\u0644\u0645\u062D\u0638\u0648\u0631\u0648\u0646", await listTelegramUsers2("blocked"), replyMarkup);
    return true;
  }
  if (text2 === "\u{1F9F9} \u062A\u0646\u0638\u064A\u0641 \u0627\u0644\u0622\u0646") {
    const { cleanupBotData: cleanupBotData2 } = await Promise.resolve().then(() => (init_botDb(), botDb_exports));
    const result = await cleanupBotData2();
    await sendMessage(chatId, `\u062A\u0645 \u0627\u0644\u062A\u0646\u0638\u064A\u0641. \u0623\u0632\u064A\u0644\u062A \u0633\u062C\u0644\u0627\u062A <b>${result.removedInactiveUsers}</b> \u0645\u0633\u062A\u062E\u062F\u0645 \u063A\u064A\u0631 \u0646\u0634\u0637 \u0648\u0627\u0644\u0639\u0645\u0644\u064A\u0627\u062A \u0627\u0644\u0645\u0624\u0642\u062A\u0629 \u0627\u0644\u0645\u0646\u062A\u0647\u064A\u0629.`, { replyMarkup });
    return true;
  }
  if (text2 === "\u{1F4CB} \u0623\u062E\u0637\u0627\u0621 \u062D\u062F\u064A\u062B\u0629") {
    const { recentErrors: recentErrors2 } = await Promise.resolve().then(() => (init_botDb(), botDb_exports));
    const errors = await recentErrors2(8);
    await sendMessage(chatId, errors.length ? `\u{1F4CB} <b>\u0622\u062E\u0631 \u0627\u0644\u0623\u062E\u0637\u0627\u0621</b>

${errors.map((error) => `\u2022 <b>${escapeHtml(error.stage)}</b> \u2014 <code>${escapeHtml(error.telegramId || "\u2014")}</code>
${escapeHtml(error.message.slice(0, 160))}`).join("\n\n")}` : "\u0644\u0627 \u062A\u0648\u062C\u062F \u0623\u062E\u0637\u0627\u0621 \u0645\u0633\u062C\u0644\u0629 \u062D\u0627\u0644\u064A\u0627\u064B.", { replyMarkup: OWNER_KEYBOARD });
    return true;
  }
  if (text2 === "\u{1F4CB} \u0642\u0627\u0626\u0645\u0629 \u0627\u0644\u0627\u0634\u062A\u0631\u0627\u0643") {
    const subscriptions = await listForcedSubscriptions();
    if (!subscriptions.length) {
      await sendMessage(chatId, "\u0644\u0627 \u062A\u0648\u062C\u062F \u0642\u0646\u0648\u0627\u062A \u0627\u0634\u062A\u0631\u0627\u0643 \u0645\u0641\u0631\u0648\u0636\u0629 \u062D\u0627\u0644\u064A\u0627\u064B.", { replyMarkup: OWNER_SUBSCRIPTIONS_KEYBOARD });
      return true;
    }
    const lines = subscriptions.map((subscription, index2) => {
      const kindLabel = subscription.kind === "group" ? "\u0645\u062C\u0645\u0648\u0639\u0629" : subscription.kind === "bot" ? "\u0628\u0648\u062A" : "\u0642\u0646\u0627\u0629";
      const link = subscription.inviteUrl ? `<a href="${escapeHtml(subscription.inviteUrl)}">${escapeHtml(subscription.label)}</a>` : `<code>${escapeHtml(subscription.label)}</code>`;
      return `${index2 + 1}. (${kindLabel}) ${link}
   <code>${escapeHtml(subscription.target)}</code>`;
    }).join("\n");
    const note = subscriptions.some((subscription) => subscription.kind === "bot") ? "\n\n\u2139\uFE0F \u0644\u0627 \u062A\u0648\u062C\u062F \u0648\u0627\u062C\u0647\u0629 \u0639\u0627\u0645\u0629 \u0644\u0644\u062A\u062D\u0642\u0642 \u0645\u0646 \u0628\u062F\u0621 \u0627\u0644\u0645\u0633\u062A\u062E\u062F\u0645 \u0644\u0628\u0648\u062A\u061B \u064A\u064F\u0639\u062A\u0628\u0631 \u0627\u0634\u062A\u0631\u0627\u0643 \u0627\u0644\u0628\u0648\u062A \u0645\u0643\u062A\u0645\u0644\u0627\u064B \u062F\u0627\u0626\u0645\u0627\u064B." : "";
    await sendMessage(chatId, `\u{1F512} <b>\u0642\u0627\u0626\u0645\u0629 \u0627\u0644\u0627\u0634\u062A\u0631\u0627\u0643 \u0627\u0644\u0625\u062C\u0628\u0627\u0631\u064A (${subscriptions.length})</b>

${lines}${note}

\u0644\u0644\u0625\u0632\u0627\u0644\u0629 \u0627\u0636\u063A\u0637 \xAB\u0625\u0632\u0627\u0644\u0629 \u0642\u0646\u0627\u0629/\u0628\u0648\u062A\xBB \u0648\u0623\u0631\u0633\u0644 \u0646\u0641\u0633 \u0627\u0644\u0645\u0639\u0631\u0651\u0641.`, { replyMarkup: OWNER_SUBSCRIPTIONS_KEYBOARD });
    return true;
  }
  if (text2 === "\u{1F6D1} \u0625\u0644\u063A\u0627\u0621 \u0627\u0644\u0639\u0645\u0644\u064A\u0629") {
    const { cancelLatestActiveJob: cancelLatestActiveJob2 } = await Promise.resolve().then(() => (init_botDb(), botDb_exports));
    const cancelled = await cancelLatestActiveJob2(telegramId);
    if (cancelled) abortYtDlp(cancelled);
    await sendMessage(chatId, cancelled ? "\u062A\u0645 \u0625\u0644\u063A\u0627\u0621 \u0622\u062E\u0631 \u0639\u0645\u0644\u064A\u0629 \u0646\u0634\u0637\u0629." : "\u0644\u0627 \u062A\u0648\u062C\u062F \u0639\u0645\u0644\u064A\u0629 \u0642\u0627\u0628\u0644\u0629 \u0644\u0644\u0625\u0644\u063A\u0627\u0621.", { replyMarkup: keyboardFor(true) });
    return true;
  }
  const inputs = {
    "\u{1F6AB} \u062D\u0638\u0631 \u0645\u0633\u062A\u062E\u062F\u0645": { action: "ban" },
    "\u2705 \u0641\u0643 \u0627\u0644\u062D\u0638\u0631": { action: "unban" },
    "\u23F1\uFE0F \u0645\u062F\u0629 \u0627\u0644\u062A\u0646\u0638\u064A\u0641": { action: "cleanup" },
    "\u{1F4E3} \u0625\u0631\u0633\u0627\u0644 \u0644\u0644\u062C\u0645\u064A\u0639": { action: "broadcast" },
    "\u2795 \u0625\u0636\u0627\u0641\u0629 \u0642\u0646\u0627\u0629/\u0628\u0648\u062A": { action: "addChannel" },
    "\u2796 \u0625\u0632\u0627\u0644\u0629 \u0642\u0646\u0627\u0629/\u0628\u0648\u062A": { action: "removeChannel" }
  };
  if (inputs[text2]) {
    beginAdminInput(telegramId, inputs[text2].action);
    await sendMessage(chatId, `\u270D\uFE0F ${pendingInputPrompt(inputs[text2].action)}
\u064A\u0645\u0643\u0646\u0643 \u0627\u062E\u062A\u064A\u0627\u0631 \u0632\u0631 \u0623\u062F\u0627\u0631\u064A \u0622\u062E\u0631 \u0644\u0625\u0644\u063A\u0627\u0621 \u0647\u0630\u0627 \u0627\u0644\u0625\u062F\u062E\u0627\u0644.`, { replyMarkup });
    return true;
  }
  if (text2 === "\u21A9\uFE0F \u0625\u0644\u063A\u0627\u0621 \u0627\u0644\u0625\u062F\u062E\u0627\u0644") {
    pendingAdminInputs.delete(telegramId);
    await sendMessage(chatId, "\u062A\u0645 \u0625\u0644\u063A\u0627\u0621 \u0627\u0644\u0625\u062F\u062E\u0627\u0644 \u0627\u0644\u062D\u0627\u0644\u064A.", { replyMarkup });
    return true;
  }
  return false;
}
async function handlePendingAdminInput(message, text2) {
  const telegramId = String(message.from.id);
  const pending2 = pendingAdminInputs.get(telegramId);
  if (!pending2) return false;
  if (pending2.expiresAt < Date.now()) {
    pendingAdminInputs.delete(telegramId);
    await sendMessage(String(message.chat.id), "\u0627\u0646\u062A\u0647\u062A \u0645\u0647\u0644\u0629 \u0627\u0644\u0625\u062F\u062E\u0627\u0644. \u0627\u062E\u062A\u0631 \u0627\u0644\u0632\u0631 \u0627\u0644\u0645\u0637\u0644\u0648\u0628 \u0645\u062C\u062F\u062F\u0627\u064B.", { replyMarkup: ownerKeyboardFor(telegramId) });
    return true;
  }
  const chatId = String(message.chat.id);
  const replyMarkup = ownerKeyboardFor(telegramId);
  const { activeRecipients: activeRecipients2, setTelegramUserBlocked: setTelegramUserBlocked2, updateCleanupInactiveDays: updateCleanupInactiveDays2 } = await Promise.resolve().then(() => (init_botDb(), botDb_exports));
  try {
    if (pending2.action === "ban" || pending2.action === "unban") {
      const user = await setTelegramUserBlocked2(text2, pending2.action === "ban");
      if (!user) throw new Error("\u0644\u0645 \u064A\u062A\u0645 \u0627\u0644\u0639\u062B\u0648\u0631 \u0639\u0644\u0649 \u0627\u0644\u0645\u0633\u062A\u062E\u062F\u0645 \u0628\u0647\u0630\u0627 \u0627\u0644\u0645\u0639\u0631\u0641 \u0623\u0648 \u0627\u0644\u0627\u0633\u0645.");
      await notifyOwners(`${pending2.action === "ban" ? "\u{1F6AB}" : "\u2705"} <b>\u062A\u0639\u062F\u064A\u0644 \u062D\u0627\u0644\u0629 \u0645\u0633\u062A\u062E\u062F\u0645</b>
\u0627\u0644\u0645\u0633\u062A\u062E\u062F\u0645: <code>${user.telegramId}</code>
\u0628\u0648\u0627\u0633\u0637\u0629 \u0627\u0644\u0645\u0627\u0644\u0643: <code>${telegramId}</code>`);
      await sendMessage(chatId, `\u062A\u0645 ${pending2.action === "ban" ? "\u062D\u0638\u0631" : "\u0641\u0643 \u062D\u0638\u0631"} \u0627\u0644\u0645\u0633\u062A\u062E\u062F\u0645 \u0628\u0646\u062C\u0627\u062D.`, { replyMarkup });
    } else if (pending2.action === "cleanup") {
      const value = Number(text2);
      await updateCleanupInactiveDays2(value);
      await sendMessage(chatId, `\u062A\u0645 \u0636\u0628\u0637 \u0627\u0644\u062A\u0646\u0638\u064A\u0641 \u0628\u0639\u062F <b>${value}</b> \u064A\u0648\u0645\u0627\u064B \u0645\u0646 \u0639\u062F\u0645 \u0627\u0644\u0646\u0634\u0627\u0637.`, { replyMarkup });
    } else if (pending2.action === "addChannel") {
      const parsed = parseSubscriptionTarget(text2);
      const added = await addForcedSubscription({ target: parsed.target, inviteUrl: parsed.inviteUrl, label: parsed.label, kind: parsed.kind });
      if (!added) throw new Error("\u0647\u0630\u0647 \u0627\u0644\u0642\u0646\u0627\u0629/\u0627\u0644\u0628\u0648\u062A \u0645\u0636\u0627\u0641 \u0628\u0627\u0644\u0641\u0639\u0644.");
      await notifyOwners(`\u{1F512} <b>\u0625\u0636\u0627\u0641\u0629 \u0627\u0634\u062A\u0631\u0627\u0643 \u0625\u062C\u0628\u0627\u0631\u064A</b>
\u0627\u0644\u0646\u0648\u0639: <b>${parsed.kind}</b>
\u0627\u0644\u0645\u0639\u0631\u0651\u0641: <code>${escapeHtml(parsed.target)}</code>
\u0627\u0644\u0631\u0627\u0628\u0637: <code>${escapeHtml(parsed.inviteUrl || "\u2014")}</code>`);
      await sendMessage(chatId, `\u2705 \u062A\u0645\u062A \u0625\u0636\u0627\u0641\u0629 \xAB<b>${escapeHtml(parsed.label)}</b>\xBB \u0625\u0644\u0649 \u0627\u0644\u0627\u0634\u062A\u0631\u0627\u0643 \u0627\u0644\u0625\u062C\u0628\u0627\u0631\u064A.
\u0633\u064A\u064F\u0637\u0644\u0628 \u0645\u0646 \u0627\u0644\u0645\u0633\u062A\u062E\u062F\u0645\u064A\u0646 \u0627\u0644\u0627\u0646\u0636\u0645\u0627\u0645 \u0642\u0628\u0644 \u0627\u0633\u062A\u062E\u062F\u0627\u0645 \u0627\u0644\u0628\u0648\u062A.`, { replyMarkup });
    } else if (pending2.action === "removeChannel") {
      const removed = await removeForcedSubscription(text2);
      if (!removed) throw new Error("\u0644\u0645 \u064A\u062A\u0645 \u0627\u0644\u0639\u062B\u0648\u0631 \u0639\u0644\u0649 \u0647\u0630\u0627 \u0627\u0644\u0627\u0634\u062A\u0631\u0627\u0643. \u062A\u062D\u0642\u0642 \u0645\u0646 \u0627\u0644\u0645\u0639\u0631\u0651\u0641.");
      await notifyOwners(`\u{1F513} <b>\u0625\u0632\u0627\u0644\u0629 \u0627\u0634\u062A\u0631\u0627\u0643 \u0625\u062C\u0628\u0627\u0631\u064A</b>
\u0627\u0644\u0645\u0639\u0631\u0651\u0641: <code>${escapeHtml(text2.trim())}</code>`);
      await sendMessage(chatId, "\u2705 \u062A\u0645\u062A \u0625\u0632\u0627\u0644\u0629 \u0627\u0644\u0627\u0634\u062A\u0631\u0627\u0643 \u0628\u0646\u062C\u0627\u062D.", { replyMarkup });
    } else {
      const content = text2.trim();
      if (!content || content.length > 3500) throw new Error("\u0627\u0643\u062A\u0628 \u0631\u0633\u0627\u0644\u0629 \u0628\u064A\u0646 1 \u06483500 \u062D\u0631\u0641\u0627\u064B.");
      const recipients = await activeRecipients2();
      await sendMessage(chatId, `\u{1F4E3} \u0628\u062F\u0623 \u0627\u0644\u0625\u0631\u0633\u0627\u0644 \u0625\u0644\u0649 <b>${recipients.length}</b> \u0645\u0633\u062A\u062E\u062F\u0645\u0627\u064B \u0646\u0634\u0637\u0627\u064B\u2026`, { replyMarkup });
      let success = 0;
      let failed = 0;
      for (let index2 = 0; index2 < recipients.length; index2 += 20) {
        const result = await Promise.allSettled(recipients.slice(index2, index2 + 20).map((user) => sendMessage(user.telegramId, escapeHtml(content))));
        result.forEach((entry) => entry.status === "fulfilled" ? success += 1 : failed += 1);
        if (index2 + 20 < recipients.length) await new Promise((resolve) => setTimeout(resolve, 1e3));
      }
      await sendMessage(chatId, `\u062A\u0645 \u0627\u0644\u0625\u0631\u0633\u0627\u0644.
\u0627\u0644\u0646\u0627\u062C\u062D: <b>${success}</b>
\u0627\u0644\u0645\u062A\u0639\u0630\u0631: <b>${failed}</b>`, { replyMarkup });
    }
  } catch (error) {
    await sendMessage(chatId, `\u062A\u0639\u0630\u0631 \u0627\u0644\u062A\u0646\u0641\u064A\u0630: <b>${escapeHtml(error instanceof Error ? error.message : "\u062E\u0637\u0623 \u063A\u064A\u0631 \u0645\u062A\u0648\u0642\u0639")}</b>`, { replyMarkup });
  } finally {
    pendingAdminInputs.delete(telegramId);
  }
  return true;
}
async function handleMessage(message) {
  const admission = await admitMessage(message);
  if (!admission.admitted || !message.text) return;
  const text2 = message.text.trim();
  const chatId = String(message.chat.id);
  const telegramId = String(message.from.id);
  const role = await getOwnerRole(telegramId);
  if (!role && !admission.primary) {
    const missing = await checkForcedSubscriptions(telegramId);
    if (missing.length) {
      await sendMessage(chatId, subscriptionGateText(missing), { replyMarkup: subscriptionGateKeyboard(missing) });
      return;
    }
  }
  if (admission.primary) {
    if (text2 === "/admin") {
      pendingAdminInputs.delete(telegramId);
      return sendAdminPanel(chatId, telegramId);
    }
    if (isOwnerControlLabel(text2)) {
      pendingAdminInputs.delete(telegramId);
      if (await handleOwnerButton(message, text2)) return;
    }
    if (await handlePendingAdminInput(message, text2)) return;
  }
  if (text2 === "/start" || text2 === "\u{1F680} \u062A\u0634\u063A\u064A\u0644 \u0627\u0644\u0628\u0648\u062A" || /^\/start@/i.test(text2)) {
    pendingAdminInputs.delete(telegramId);
    pendingReports.delete(telegramId);
    const info = { username: message.from?.username, language: message.from?.language_code };
    const user = await getTelegramUser(telegramId);
    if (user?.firstSeenAt) info.firstSeen = user.firstSeenAt;
    await sendWelcomePhoto(chatId).catch(() => void 0);
    return sendMessage(chatId, welcomeText(userName(message), info), { replyMarkup: keyboardFor(admission.primary) });
  }
  if (text2 === "/help" || text2 === "\u2754 \u0637\u0631\u064A\u0642\u0629 \u0627\u0644\u0627\u0633\u062A\u062E\u062F\u0627\u0645") return sendMessage(chatId, HELP_TEXT, { replyMarkup: keyboardFor(admission.primary) });
  if (text2 === "\u{1F4E9} \u0625\u0631\u0633\u0627\u0644 \u0628\u0644\u0627\u063A") {
    pendingReports.set(telegramId, Date.now() + 10 * 6e4);
    return sendMessage(chatId, "\u0623\u0631\u0633\u0644 \u0627\u0644\u0622\u0646 \u0627\u0644\u0631\u0627\u0628\u0637 \u0623\u0648 \u0648\u0635\u0641 \u0627\u0644\u0645\u0634\u0643\u0644\u0629 \u0628\u0627\u062E\u062A\u0635\u0627\u0631. \u0633\u064A\u0635\u0644 \u0644\u0644\u0645\u0627\u0644\u0643 \u0645\u0639 \u0627\u0633\u0645\u0643 \u0648\u0631\u0627\u0628\u0637 \u0645\u0628\u0627\u0634\u0631 \u0644\u0645\u0644\u0641\u0643 \u0644\u062A\u0633\u0647\u064A\u0644 \u0627\u0644\u0645\u062A\u0627\u0628\u0639\u0629.", { replyMarkup: keyboardFor(admission.primary) });
  }
  if (text2 === "/report") return sendMessage(chatId, REPORT_TEXT, { replyMarkup: keyboardFor(admission.primary) });
  if (text2.startsWith("/report ") || (pendingReports.get(telegramId) || 0) > Date.now()) {
    pendingReports.delete(telegramId);
    const report = text2.startsWith("/report ") ? text2.slice(8).trim() : text2;
    if (!report) return sendMessage(chatId, "\u0627\u0643\u062A\u0628 \u0631\u0627\u0628\u0637\u0627\u064B \u0623\u0648 \u0648\u0635\u0641\u0627\u064B \u0645\u062E\u062A\u0635\u0631\u0627\u064B \u0644\u0644\u0645\u0634\u0643\u0644\u0629 \u062B\u0645 \u0623\u0631\u0633\u0644\u0647 \u0645\u0631\u0629 \u0623\u062E\u0631\u0649.", { replyMarkup: keyboardFor(admission.primary) });
    const notification = buildReportNotification(message, report);
    await notifyOwners(notification.text, { replyMarkup: notification.replyMarkup });
    return sendMessage(chatId, "\u062A\u0645 \u0625\u0631\u0633\u0627\u0644 \u0627\u0644\u0628\u0644\u0627\u063A \u0644\u0644\u0645\u0627\u0644\u0643 \u0645\u0639 \u0628\u064A\u0627\u0646\u0627\u062A \u0627\u0644\u062A\u0648\u0627\u0635\u0644 \u0627\u0644\u0644\u0627\u0632\u0645\u0629. \u0634\u0643\u0631\u0627\u064B \u0644\u0645\u0633\u0627\u0639\u062F\u062A\u0643.", { replyMarkup: keyboardFor(admission.primary) });
  }
  if (text2 === "/cancel" || text2 === "\u{1F6D1} \u0625\u0644\u063A\u0627\u0621 \u0627\u0644\u0639\u0645\u0644\u064A\u0629") {
    const cancelled = await cancelLatestActiveJob(telegramId);
    if (cancelled) abortYtDlp(cancelled);
    const cancelledJob = cancelled ? await getMediaJob(cancelled) : void 0;
    if (cancelled) await notifyOwners(`\u{1F6D1} <b>\u0623\u0644\u063A\u0649 \u0645\u0633\u062A\u062E\u062F\u0645 \u0639\u0645\u0644\u064A\u0629 \u062A\u0646\u0632\u064A\u0644</b>
\u0627\u0644\u0645\u0633\u062A\u062E\u062F\u0645: <code>${telegramId}</code>
\u0627\u0644\u0646\u0648\u0639: <b>${mediaLabel(cancelledJob?.selectedChoice)}</b>
\u0627\u0644\u0645\u0647\u0645\u0629: <code>${cancelled}</code>`);
    return sendMessage(chatId, cancelled ? "\u062A\u0645 \u0625\u0644\u063A\u0627\u0621 \u0627\u0644\u0639\u0645\u0644\u064A\u0629. \u0644\u0646 \u064A\u064F\u0631\u0633\u0644 \u0627\u0644\u0645\u0644\u0641 \u0625\u0630\u0627 \u0644\u0645 \u064A\u0643\u062A\u0645\u0644 \u0628\u0639\u062F." : "\u0644\u0627 \u062A\u0648\u062C\u062F \u0639\u0645\u0644\u064A\u0629 \u0642\u0627\u0628\u0644\u0629 \u0644\u0644\u0625\u0644\u063A\u0627\u0621.", { replyMarkup: keyboardFor(admission.primary) });
  }
  if (!/^https:\/\//i.test(text2)) return sendMessage(chatId, "\u0623\u0631\u0633\u0644 \u0631\u0627\u0628\u0637\u0627\u064B \u0639\u0627\u0645\u0627\u064B \u064A\u0628\u062F\u0623 \u0628\u0640 https:// \u0623\u0648 \u0627\u0636\u063A\u0637 \xAB\u0637\u0631\u064A\u0642\u0629 \u0627\u0644\u0627\u0633\u062A\u062E\u062F\u0627\u0645\xBB.", { replyMarkup: keyboardFor(admission.primary) });
  await inspectIncomingLink(message, text2, admission.primary);
}
async function handleDownloadCallback(callback) {
  const chatId = callback.message ? String(callback.message.chat.id) : String(callback.from.id);
  const data = callback.data || "";
  const senderId = String(callback.from.id);
  const primary = await isPrimaryOwner(senderId);
  if (data === "sub_check") {
    if (!allowCallback(senderId)) return answerCallbackQuery(callback.id, "\u{1F4A1} \u0623\u0646\u062A \u062A\u0636\u063A\u0637 \u0628\u0633\u0631\u0639\u0629. \u0627\u0646\u062A\u0638\u0631 \u0642\u0644\u064A\u0644\u0627\u064B \u062B\u0645 \u0623\u0639\u062F \u0627\u0644\u0645\u062D\u0627\u0648\u0644\u0629.");
    const missing = await checkForcedSubscriptions(senderId);
    if (missing.length) return answerCallbackQuery(callback.id, "\u0645\u0627 \u0632\u0644\u062A \u063A\u064A\u0631 \u0645\u0634\u062A\u0631\u0643 \u0641\u064A \u0643\u0644 \u0627\u0644\u0642\u0646\u0648\u0627\u062A \u0627\u0644\u0645\u0637\u0644\u0648\u0628\u0629");
    await answerCallbackQuery(callback.id, "\u062A\u0645 \u0627\u0644\u062A\u062D\u0642\u0642 \u0645\u0646 \u0627\u0644\u0627\u0634\u062A\u0631\u0627\u0643 \u2705");
    return sendMessage(chatId, "\u2705 <b>\u062A\u0645 \u0627\u0644\u062A\u062D\u0642\u0642 \u0645\u0646 \u0627\u0644\u0627\u0634\u062A\u0631\u0627\u0643 \u0628\u0646\u062C\u0627\u062D</b>\n\u0627\u0636\u063A\u0637 \xAB\u{1F680} \u062A\u0634\u063A\u064A\u0644 \u0627\u0644\u0628\u0648\u062A\xBB \u062B\u0645 \u0623\u0631\u0633\u0644 \u0631\u0627\u0628\u0637 \u0627\u0644\u0645\u0646\u0634\u0648\u0631 \u0644\u0644\u0628\u062F\u0621.", { replyMarkup: keyboardFor(primary) });
  }
  if (data.startsWith("cancel:")) {
    const cancelJob = await getMediaJob(data.slice(7));
    const cancelled = await cancelMediaJob(data.slice(7), senderId);
    if (cancelled) abortYtDlp(data.slice(7));
    if (cancelled) await notifyOwners(`\u{1F6D1} <b>\u0623\u0644\u063A\u0649 \u0645\u0633\u062A\u062E\u062F\u0645 \u0639\u0645\u0644\u064A\u0629 \u062A\u0646\u0632\u064A\u0644</b>
\u0627\u0644\u0645\u0633\u062A\u062E\u062F\u0645: <code>${senderId}</code>
\u0627\u0644\u0646\u0648\u0639: <b>${mediaLabel(cancelJob?.selectedChoice)}</b>
\u0627\u0644\u0645\u0647\u0645\u0629: <code>${escapeHtml(data.slice(7))}</code>`);
    await answerCallbackQuery(callback.id, cancelled ? "\u062A\u0645 \u0627\u0644\u0625\u0644\u063A\u0627\u0621" : "\u0644\u0627 \u062A\u0648\u062C\u062F \u0639\u0645\u0644\u064A\u0629 \u0642\u0627\u0628\u0644\u0629 \u0644\u0644\u0625\u0644\u063A\u0627\u0621");
    return sendMessage(chatId, cancelled ? "\u062A\u0645 \u0625\u0644\u063A\u0627\u0621 \u0627\u0644\u0639\u0645\u0644\u064A\u0629." : "\u0644\u0627 \u062A\u0648\u062C\u062F \u0639\u0645\u0644\u064A\u0629 \u0642\u0627\u0628\u0644\u0629 \u0644\u0644\u0625\u0644\u063A\u0627\u0621.", { replyMarkup: keyboardFor(primary) });
  }
  if (data.startsWith("retry_tiktok:")) {
    const retryJobId = data.slice("retry_tiktok:".length);
    const retryJob = await getMediaJob(retryJobId);
    const expired = !retryJob || new Date(retryJob.expiresAt).getTime() <= Date.now();
    if (expired || retryJob.telegramId !== senderId || retryJob.platform !== "tiktok" || retryJob.status !== "failed") {
      return answerCallbackQuery(callback.id, "\u0627\u0646\u062A\u0647\u062A \u0635\u0644\u0627\u062D\u064A\u0629 \u0625\u0639\u0627\u062F\u0629 \u0627\u0644\u0645\u062D\u0627\u0648\u0644\u0629. \u0623\u0631\u0633\u0644 \u0627\u0644\u0631\u0627\u0628\u0637 \u0645\u0646 \u062C\u062F\u064A\u062F.");
    }
    await deleteMediaJob(retryJobId);
    await answerCallbackQuery(callback.id, "\u062C\u0627\u0631\u064D \u0625\u0639\u0627\u062F\u0629 \u0641\u062D\u0635 \u0627\u0644\u0631\u0627\u0628\u0637");
    await inspectIncomingLink({
      message_id: callback.message?.message_id || 0,
      chat: callback.message?.chat || { id: chatId, type: "private" },
      from: callback.from,
      text: retryJob.sourceUrl
    }, retryJob.sourceUrl, primary);
    return;
  }
  const parts = data.split(":");
  const jobId = parts[1];
  const rawChoice = parts[2];
  const allImages = rawChoice === "images";
  const choice = allImages ? "image" : rawChoice;
  if (!jobId || !["video", "audio", "image", "story"].includes(choice)) return answerCallbackQuery(callback.id, "\u0637\u0644\u0628 \u063A\u064A\u0631 \u0635\u0627\u0644\u062D");
  if (!allowCallback(senderId)) return answerCallbackQuery(callback.id, "\u{1F4A1} \u0623\u0646\u062A \u062A\u0636\u063A\u0637 \u0628\u0633\u0631\u0639\u0629. \u0627\u0646\u062A\u0638\u0631 \u0642\u0644\u064A\u0644\u0627\u064B \u062B\u0645 \u0623\u0639\u062F \u0627\u0644\u0645\u062D\u0627\u0648\u0644\u0629.");
  const job = await getMediaJob(jobId);
  if (!job || job.telegramId !== senderId || job.status !== "ready" || job.cancelRequested) return answerCallbackQuery(callback.id, "\u0627\u0646\u062A\u0647\u062A \u0635\u0644\u0627\u062D\u064A\u0629 \u0647\u0630\u0627 \u0627\u0644\u0637\u0644\u0628");
  await answerCallbackQuery(callback.id, allImages ? "\u0628\u062F\u0623 \u062A\u062C\u0647\u064A\u0632 \u0627\u0644\u0635\u0648\u0631" : "\u0628\u062F\u0623 \u062A\u062C\u0647\u064A\u0632 \u0627\u0644\u0645\u0644\u0641");
  await updateMediaJob(jobId, { status: "downloading", selectedChoice: choice });
  const action = allImages || choice === "image" ? "upload_photo" : choice === "audio" ? "upload_audio" : "upload_video";
  let workdir;
  let preserveRetryJob = false;
  let deleteJobOnFinish = true;
  try {
    const queued = scheduleDownload(async () => {
      const beforeDownload = await getMediaJob(jobId);
      if (!beforeDownload || beforeDownload.cancelRequested) throw new DownloaderError("\u062A\u0645 \u0625\u0644\u063A\u0627\u0621 \u0627\u0644\u0639\u0645\u0644\u064A\u0629 \u0628\u0646\u062C\u0627\u062D.");
      await sendChatAction(chatId, action).catch(() => void 0);
      if (allImages) return downloadAllImages(job.sourceUrl, jobId);
      return downloadMedia(job.sourceUrl, choice, jobId);
    });
    const queueMessage = queued.position > 1 ? `\u23F3 <b>\u0637\u0644\u0628\u0643 \u0641\u064A \u0635\u0641 \u0627\u0644\u062A\u0646\u0632\u064A\u0644</b> \u2014 \u0623\u0645\u0627\u0645\u0643 <b>${queued.position - 1}</b> \u0637\u0644\u0628. \u0633\u064A\u0628\u062F\u0623 \u062A\u0644\u0642\u0627\u0626\u064A\u0627\u064B \u0648\u064A\u0645\u0643\u0646\u0643 \u0627\u0644\u0625\u0644\u063A\u0627\u0621 \u0627\u0644\u0622\u0646.` : "\u23F3 <b>\u062C\u0627\u0631\u064D \u062A\u062C\u0647\u064A\u0632 \u0627\u0644\u0645\u0644\u0641 \u0627\u0644\u0622\u0646\u2026</b> \u0633\u062A\u0635\u0644\u0643 \u0627\u0644\u0646\u062A\u064A\u062C\u0629 \u0647\u0646\u0627 \u0641\u0648\u0631 \u0627\u0643\u062A\u0645\u0627\u0644\u0647\u0627\u060C \u0648\u064A\u0645\u0643\u0646\u0643 \u0627\u0644\u0625\u0644\u063A\u0627\u0621 \u0641\u064A \u0623\u064A \u0648\u0642\u062A.";
    await sendMessage(chatId, queueMessage, { replyMarkup: keyboardFor(primary) });
    const output = await queued.completion;
    workdir = output.workdir;
    const latest = await getMediaJob(jobId);
    if (!latest || latest.cancelRequested) return;
    await sendChatAction(chatId, action).catch(() => void 0);
    if (allImages) {
      const files = output.files;
      const caption = `\u2705 <b>\u0627\u0643\u062A\u0645\u0644 \u062A\u0646\u0632\u064A\u0644 \u0627\u0644\u0635\u0648\u0631</b>
\u0639\u062F\u062F \u0627\u0644\u0635\u0648\u0631: <b>${files.length}</b>
\u0633\u064A\u064F\u062D\u0630\u0641 \u0627\u0644\u0645\u0644\u0641 \u0645\u0646 \u0627\u0644\u062E\u0627\u062F\u0645 \u0627\u0644\u0622\u0646.`;
      await sendMediaGroup(chatId, files.map((file) => ({ path: file.path, caption })));
    } else {
      await sendDownloadedMedia(chatId, choice, output.filePath, "\u2705 <b>\u0627\u0643\u062A\u0645\u0644 \u0627\u0644\u062A\u0646\u0632\u064A\u0644</b> \u2014 \u0627\u0644\u0645\u0644\u0641 \u0623\u064F\u0631\u0633\u0644 \u0628\u0646\u062C\u0627\u062D \u0648\u0633\u064A\u064F\u062D\u0630\u0641 \u0645\u0646 \u0627\u0644\u062E\u0627\u062F\u0645 \u0627\u0644\u0622\u0646.");
    }
    await updateMediaJob(jobId, { status: "sent" });
    await notifyOwners(`\u2705 <b>\u062A\u0646\u0632\u064A\u0644 \u0645\u0643\u062A\u0645\u0644</b>
\u0627\u0644\u0645\u0633\u062A\u062E\u062F\u0645: <code>${senderId}</code>
\u0627\u0644\u0646\u0648\u0639: <b>${allImages ? "\u0635\u0648\u0631 \u0643\u0627\u0645\u0644\u0629" : mediaLabel(choice)}</b>
\u0627\u0644\u062D\u062C\u0645: <b>${Math.round(output.bytes / 1024)} KB</b>
\u0627\u0644\u0631\u0627\u0628\u0637: <code>${escapeHtml(job.sourceUrl.slice(0, 500))}</code>`);
  } catch (error) {
    if (error instanceof DownloaderError && error.message === "\u062A\u0645 \u0625\u0644\u063A\u0627\u0621 \u0627\u0644\u0639\u0645\u0644\u064A\u0629 \u0628\u0646\u062C\u0627\u062D.") return;
    if (error instanceof DownloadQueueError) {
      const queue = getDownloadQueueStats();
      deleteJobOnFinish = false;
      await updateMediaJob(jobId, { status: "ready" });
      await sendMessage(chatId, `\u23F3 ${escapeHtml(error.message)}

<b>\u0627\u0636\u063A\u0637 \u0639\u0644\u0649 \u0632\u0631 \u0627\u0644\u062A\u0646\u0632\u064A\u0644 \u0645\u062C\u062F\u062F\u0627\u064B \u0628\u0639\u062F \u0644\u062D\u0638\u0627\u062A \u0648\u0633\u0646\u0633\u062A\u0623\u0646\u0641 \u0627\u0644\u0639\u0645\u0644 \u062A\u0644\u0642\u0627\u0626\u064A\u0627\u064B.</b>`, { replyMarkup: keyboardFor(primary) });
      await notifyOwners(`\u{1F4C8} <b>\u062A\u0646\u0628\u064A\u0647 \u0636\u063A\u0637</b>
\u0627\u0645\u062A\u0644\u0623 \u0635\u0641 \u0627\u0644\u062A\u0646\u0632\u064A\u0644.
\u0642\u064A\u062F \u0627\u0644\u062A\u0646\u0641\u064A\u0630: <b>${queue.active}</b>
\u0641\u064A \u0627\u0644\u0627\u0646\u062A\u0638\u0627\u0631: <b>${queue.waiting}</b>`);
      return;
    }
    await updateMediaJob(jobId, { status: "failed" });
    preserveRetryJob = isRetryableTikTokFailure(error, job.platform);
    const retryMarkup = preserveRetryJob ? retryTikTokKeyboard(jobId) : keyboardFor(primary);
    const retryHint = preserveRetryJob ? "\n\n\u064A\u0645\u0643\u0646\u0643 \u0627\u0644\u0636\u063A\u0637 \u0639\u0644\u0649 \xAB\u0625\u0639\u0627\u062F\u0629 \u0645\u062D\u0627\u0648\u0644\u0629 TikTok\xBB \u0644\u0625\u0639\u0627\u062F\u0629 \u0627\u0644\u0641\u062D\u0635 \u062A\u0644\u0642\u0627\u0626\u064A\u0627\u064B." : "";
    await sendMessage(chatId, `\u062A\u0639\u0630\u0631 \u0625\u0643\u0645\u0627\u0644 \u0627\u0644\u062A\u0646\u0632\u064A\u0644.
<b>${escapeHtml(userFacingMediaError(error))}</b>${retryHint}`, { replyMarkup: retryMarkup });
    await notifyError({ telegramId: senderId, sourceUrl: job.sourceUrl, stage: "\u062A\u0646\u0632\u064A\u0644 \u0648\u0625\u0631\u0633\u0627\u0644", error, mediaChoice: allImages ? "image" : choice });
  } finally {
    if (workdir) await purgeDownloadedMedia(workdir);
    if (!preserveRetryJob && deleteJobOnFinish) await deleteMediaJob(jobId);
  }
}
async function processTelegramUpdate(update) {
  if (!isValidTelegramUpdateId(update.update_id)) return;
  if (!await claimTelegramUpdate(update.update_id)) return;
  try {
    if (update.message) return handleMessage(update.message);
    if (update.callback_query) return handleDownloadCallback(update.callback_query);
  } catch (error) {
    const telegramId = update.message?.from ? String(update.message.from.id) : update.callback_query ? String(update.callback_query.from.id) : void 0;
    await notifyError({ telegramId, stage: "\u0645\u0639\u0627\u0644\u062C\u0629 \u062A\u062D\u062F\u064A\u062B Telegram", error });
    throw error;
  }
}

// server/telegram/polling.ts
var POLL_TIMEOUT_SECONDS = 30;
var RETRY_DELAY_MS = 3e3;
var running = false;
var stopped = false;
function isPollingEnabled() {
  const value = (process.env.TELEGRAM_POLLING || "").trim().toLowerCase();
  return value === "1" || value === "true" || value === "yes";
}
async function startTelegramPolling() {
  if (running) return;
  if (!process.env.BOT_TOKEN) {
    console.warn("[Telegram polling] \u062A\u0645 \u062A\u062C\u0627\u0647\u0644 \u0648\u0636\u0639 \u0627\u0644\u0627\u0633\u062A\u0639\u0644\u0627\u0645 \u0644\u0623\u0646 BOT_TOKEN \u063A\u064A\u0631 \u0645\u064F\u0639\u062F.");
    return;
  }
  running = true;
  stopped = false;
  try {
    await deleteWebhook();
  } catch (error) {
    console.warn("[Telegram polling] \u062A\u0639\u0630\u0631 \u062D\u0630\u0641 Webhook \u0642\u0628\u0644 \u0627\u0644\u0627\u0633\u062A\u0639\u0644\u0627\u0645\u061B \u0633\u0623\u062A\u0627\u0628\u0639 \u0639\u0644\u0649 \u0623\u064A \u062D\u0627\u0644.", error);
  }
  console.log("[Telegram polling] \u0628\u062F\u0623 \u0627\u0644\u0627\u0633\u062A\u0639\u0644\u0627\u0645 \u0627\u0644\u0645\u062D\u0644\u064A \u0639\u0628\u0631 getUpdates. \u0627\u0636\u063A\u0637 Ctrl+C \u0644\u0644\u0625\u064A\u0642\u0627\u0641.");
  void pollLoop();
}
async function pollLoop() {
  let offset;
  while (!stopped) {
    try {
      const updates = await getUpdates(offset, POLL_TIMEOUT_SECONDS);
      for (const update of updates) {
        offset = update.update_id + 1;
        try {
          await processTelegramUpdate(update);
        } catch (error) {
          console.error("[Telegram polling] \u0641\u0634\u0644 \u0645\u0639\u0627\u0644\u062C\u0629 \u062A\u062D\u062F\u064A\u062B.", error);
        }
      }
    } catch (error) {
      if (stopped) break;
      const message = error instanceof TelegramApiError ? error.message : String(error);
      console.error(`[Telegram polling] \u062E\u0637\u0623 \u0641\u064A getUpdates: ${message}`);
      await delay(RETRY_DELAY_MS);
    }
  }
  running = false;
}
function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// server/telegram/routes.ts
var ACTIVATION_COOLDOWN_MS = 6e4;
var activationInFlight;
var lastActivationAt = 0;
async function ensureTelegramWebhook(webhookUrl, secret) {
  const existing = await getWebhookInfo();
  if (existing.url === webhookUrl) {
    return { url: existing.url || null, pendingUpdates: existing.pending_update_count || 0, reused: true };
  }
  await setWebhook(webhookUrl, secret);
  const updated = await getWebhookInfo();
  return { url: updated.url || null, pendingUpdates: updated.pending_update_count || 0, reused: false };
}
function registerTelegramRoutes(app) {
  app.get("/api/telegram/status", async (_req, res) => {
    res.json({ ok: true, ...await getTelegramIntegrationStatus() });
  });
  app.post("/api/telegram/activate", async (req, res) => {
    if (isPollingEnabled()) {
      return res.status(409).json({ ok: false, error: "polling mode is enabled; remove TELEGRAM_POLLING to use the webhook and avoid duplicated updates" });
    }
    const status = await getTelegramIntegrationStatus();
    const secret = getWebhookSecret();
    const forwardedProtocol = req.header("x-forwarded-proto")?.split(",")[0]?.trim();
    const protocol = forwardedProtocol === "https" ? "https" : req.protocol;
    const host = req.get("host");
    if (protocol !== "https") {
      return res.status(403).json({ ok: false, error: "activation requires the published HTTPS domain" });
    }
    const configuredUrl = process.env.WEBHOOK_URL;
    const webhookUrl = configuredUrl || (host ? `${protocol}://${host}/api/telegram/webhook` : void 0);
    if (!status.tokenConfigured || !status.webhookSecretConfigured || !webhookUrl || !/^https:\/\/.+\/api\/telegram\/webhook$/.test(webhookUrl)) {
      return res.status(422).json({ ok: false, error: "integration setup is incomplete; activate from the published HTTPS domain" });
    }
    try {
      const now = Date.now();
      if (activationInFlight) {
        const result2 = await activationInFlight;
        return res.json({ ok: true, ...result2, shared: true });
      }
      if (now - lastActivationAt < ACTIVATION_COOLDOWN_MS) {
        return res.status(429).json({ ok: false, error: "activation cooldown", retryAfterSeconds: Math.ceil((ACTIVATION_COOLDOWN_MS - (now - lastActivationAt)) / 1e3) });
      }
      activationInFlight = ensureTelegramWebhook(webhookUrl, secret);
      const result = await activationInFlight;
      return res.json({ ok: true, ...result, shared: false });
    } catch (error) {
      console.error("[Telegram webhook] Activation failed", error);
      return res.status(502).json({ ok: false, error: "Telegram \u0631\u0641\u0636 \u062A\u0641\u0639\u064A\u0644 Webhook. \u062A\u062D\u0642\u0642 \u0645\u0646 \u0627\u0644\u062A\u0648\u0643\u0646 \u0648\u0627\u0644\u0631\u0627\u0628\u0637 \u0627\u0644\u0639\u0627\u0645." });
    } finally {
      lastActivationAt = Date.now();
      activationInFlight = void 0;
    }
  });
  app.post("/api/telegram/webhook", async (req, res) => {
    const secret = getWebhookSecret();
    const suppliedSecret = req.header("x-telegram-bot-api-secret-token");
    if (!matchesWebhookSecret(secret, suppliedSecret)) {
      return res.status(403).json({ ok: false, error: "invalid webhook secret" });
    }
    try {
      await processTelegramUpdate(req.body);
      return res.status(200).json({ ok: true });
    } catch (error) {
      console.error("[Telegram webhook] Update processing failed", error);
      return res.status(500).json({ ok: false });
    }
  });
}

// server/telegram/cleanupRoute.ts
init_botDb();
function registerTelegramCleanupRoute(app) {
  app.post("/api/scheduled/telegram-cleanup", async (req, res) => {
    try {
      const user = await sdk.authenticateRequest(req);
      if (!user.isCron || !user.taskUid) return res.status(403).json({ error: "cron-only" });
      const result = await cleanupBotData();
      return res.json({ ok: true, ...result, taskUid: user.taskUid });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error("[Telegram cleanup] Failed", error);
      return res.status(500).json({ error: message, timestamp: (/* @__PURE__ */ new Date()).toISOString() });
    }
  });
}

// server/_core/index.ts
init_botDb();
function isPortAvailable(port) {
  return new Promise((resolve) => {
    const server = net2.createServer();
    server.listen(port, () => {
      server.close(() => resolve(true));
    });
    server.on("error", () => resolve(false));
  });
}
async function findAvailablePort(startPort = 3e3) {
  for (let port = startPort; port < startPort + 20; port++) {
    if (await isPortAvailable(port)) {
      return port;
    }
  }
  throw new Error(`No available port found starting from ${startPort}`);
}
function configureTrustProxy(app) {
  const raw = (process.env.TRUST_PROXY || "0").trim();
  if (raw === "1" || raw.toLowerCase() === "true") {
    app.set("trust proxy", 1);
  } else if (/^\d+$/.test(raw) && Number(raw) > 1) {
    app.set("trust proxy", Number(raw));
  }
}
function isProductionRuntime() {
  if (process.env.NODE_ENV === "production") return true;
  if (process.env.NODE_ENV === "development") return false;
  return /[\\/]dist[\\/]/.test(new URL(import.meta.url).pathname);
}
async function startServer() {
  const app = express2();
  const server = createServer(app);
  configureTrustProxy(app);
  await cleanupStaleJobs();
  app.use(express2.json({ limit: "50mb" }));
  app.use(express2.urlencoded({ limit: "50mb", extended: true }));
  registerStorageProxy(app);
  registerOAuthRoutes(app);
  registerTelegramRoutes(app);
  registerTelegramCleanupRoute(app);
  app.use(
    "/api/trpc",
    createExpressMiddleware({
      router: appRouter,
      createContext
    })
  );
  if (isProductionRuntime()) {
    serveStatic(app);
  } else {
    const { setupVite } = await import("./vite");
    await setupVite(app, server);
  }
  const preferredPort = parseInt(process.env.PORT || "3000");
  const port = process.env.PORT ? preferredPort : await findAvailablePort(preferredPort);
  if (port !== preferredPort) {
    console.log(`Port ${preferredPort} is busy, using port ${port} instead`);
  }
  server.listen(port, () => {
    console.log(`Server running on http://localhost:${port}/`);
  });
  if (isPollingEnabled()) {
    await startTelegramPolling();
  }
}
startServer().catch(console.error);
