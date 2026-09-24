import { readFile } from "node:fs/promises";
import path from "node:path";
import pg from "pg";
import { nanoid } from "nanoid";
import type { ForcedSubscription, SubscriptionPlan, TelegramFrom } from "./types";
import type { Admission, MemoryBotOwner, MemoryBotSettings, MemoryBotUser, UserAccessRecord } from "./botDb";

/** Active Supabase/Postgres storage only when a connection string is provided. */
export function isSupabaseConfigured() {
  const url = (process.env.SUPABASE_DATABASE_URL || "").trim();
  return url.length > 0;
}

/** Creates all tables at boot (idempotent) and seeds any legacy JSON data. */
export async function initializeSupabaseStorage() {
  if (!isSupabaseConfigured()) return false;
  await ensureSchema();
  console.log("[Supabase] storage connected, schema ready");
  return true;
}

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS tg_users (
  id BIGSERIAL PRIMARY KEY,
  telegram_id TEXT NOT NULL UNIQUE,
  username TEXT,
  display_name TEXT NOT NULL,
  language_code TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  first_seen_at TIMESTAMPTZ NOT NULL,
  last_seen_at TIMESTAMPTZ NOT NULL,
  last_activity_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS tg_users_activity_idx ON tg_users (last_activity_at);
CREATE TABLE IF NOT EXISTS tg_owners (
  telegram_id TEXT PRIMARY KEY,
  role TEXT NOT NULL,
  added_at TIMESTAMPTZ NOT NULL,
  added_by TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS tg_settings (
  id INTEGER PRIMARY KEY,
  max_users INTEGER NOT NULL,
  cleanup_inactive_days INTEGER NOT NULL,
  cleanup_temp_minutes INTEGER NOT NULL,
  broadcast_rate_per_second INTEGER NOT NULL,
  notify_new_users BOOLEAN NOT NULL,
  usage_limit_enabled BOOLEAN NOT NULL,
  usage_limit_count INTEGER NOT NULL,
  usage_limit_window_hours INTEGER NOT NULL,
  paid_mode_enabled BOOLEAN NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL
);
CREATE TABLE IF NOT EXISTS tg_subscriptions (
  id TEXT PRIMARY KEY,
  target TEXT NOT NULL UNIQUE,
  invite_url TEXT NOT NULL,
  label TEXT NOT NULL,
  kind TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL
);
CREATE TABLE IF NOT EXISTS tg_plans (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  duration_days INTEGER NOT NULL,
  stars INTEGER NOT NULL,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL
);
CREATE TABLE IF NOT EXISTS tg_access (
  telegram_id TEXT PRIMARY KEY,
  subscription_expires_at TIMESTAMPTZ,
  subscription_plan_id TEXT,
  download_timestamps JSONB NOT NULL DEFAULT '[]'::jsonb
);
CREATE TABLE IF NOT EXISTS tg_claims (
  update_id BIGINT PRIMARY KEY,
  claimed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS tg_claims_claimed_at_idx ON tg_claims (claimed_at);
`;

type UserRow = {
  id: string;
  telegramId: string;
  username: string | null;
  displayName: string;
  languageCode: string | null;
  status: "active" | "blocked";
  firstSeenAt: Date;
  lastSeenAt: Date;
  lastActivityAt: Date;
};

type OwnerRow = {
  telegramId: string;
  role: "primary" | "owner";
  addedAt: Date;
  addedBy: string;
};

type SettingsRow = {
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

let pool: pg.Pool | undefined;
let schemaReady: Promise<void> | undefined;

function getPool() {
  if (!pool) {
    pool = new pg.Pool({
      connectionString: (process.env.SUPABASE_DATABASE_URL || "").trim(),
      max: 10,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 15_000,
    });
    pool.on("error", error => console.error("[Supabase] pool error", error));
  }
  return pool;
}

async function run<T extends pg.QueryResultRow = pg.QueryResultRow>(text: string, params: unknown[] = []) {
  const client = await getPool().connect();
  try {
    return await client.query<T>(text, params);
  } finally {
    client.release();
  }
}

function ensureSchema() {
  if (!schemaReady) {
    schemaReady = (async () => {
      await run(SCHEMA_SQL);
      await seedLegacyJson();
    })().catch(error => {
      schemaReady = undefined;
      throw error;
    });
  }
  return schemaReady;
}

function dataDir() {
  return process.env.DATA_DIR?.trim() || path.join(process.cwd(), "data");
}

async function seedLegacyJson() {
  try {
    const existing = await run("SELECT COUNT(*)::int AS count FROM tg_subscriptions");
    if (Number(existing.rows[0].count) === 0) {
      const raw = await readFile(path.join(dataDir(), "subscriptions.json"), "utf8");
      const subscriptions = JSON.parse(raw) as ForcedSubscription[];
      for (const subscription of subscriptions) {
        await run(
          "INSERT INTO tg_subscriptions (id, target, invite_url, label, kind, created_at) VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT DO NOTHING",
          [subscription.id, subscription.target, subscription.inviteUrl, subscription.label, subscription.kind, new Date(subscription.createdAt)],
        );
      }
    }
  } catch {
    // No legacy file or empty store: nothing to seed.
  }
  try {
    const existing = await run("SELECT COUNT(*)::int AS count FROM tg_plans");
    const plansEmpty = Number(existing.rows[0].count) === 0;
    const accessRaw = await readFile(path.join(dataDir(), "access.json"), "utf8").catch(() => null);
    if (accessRaw) {
      const parsed = JSON.parse(accessRaw) as { plans?: SubscriptionPlan[]; users?: Record<string, UserAccessRecord> };
      if (plansEmpty && Array.isArray(parsed.plans)) {
        for (const plan of parsed.plans) {
          await run(
            "INSERT INTO tg_plans (id, name, duration_days, stars, active, created_at) VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT DO NOTHING",
            [plan.id, plan.name, plan.durationDays, plan.stars, plan.active, new Date(plan.createdAt)],
          );
        }
      }
      if (parsed.users && typeof parsed.users === "object") {
        for (const [telegramId, record] of Object.entries(parsed.users)) {
          await run(
            "INSERT INTO tg_access (telegram_id, subscription_expires_at, subscription_plan_id, download_timestamps) VALUES ($1, $2, $3, $4::jsonb) ON CONFLICT DO NOTHING",
            [
              telegramId,
              record.subscriptionExpiresAt ? new Date(record.subscriptionExpiresAt) : null,
              record.subscriptionPlanId,
              JSON.stringify((record.downloadTimestamps || []).filter((value: unknown) => typeof value === "number")),
            ],
          );
        }
      }
    }
  } catch {
    // Legacy access file absent: starting fresh.
  }
}

function mapUserRow(row: UserRow): MemoryBotUser {
  return {
    id: Number(row.id),
    telegramId: row.telegramId,
    username: row.username,
    displayName: row.displayName,
    languageCode: row.languageCode,
    status: row.status,
    firstSeenAt: row.firstSeenAt,
    lastSeenAt: row.lastSeenAt,
    lastActivityAt: row.lastActivityAt,
  };
}

const USER_COLUMNS = `id, telegram_id AS "telegramId", username, display_name AS "displayName", language_code AS "languageCode", status, first_seen_at AS "firstSeenAt", last_seen_at AS "lastSeenAt", last_activity_at AS "lastActivityAt"`;

export async function touchUser(from: TelegramFrom): Promise<{ admission: Admission; isNew: boolean }> {
  await ensureSchema();
  const telegramId = String(from.id);
  const displayName = [from.first_name, from.last_name].filter(Boolean).join(" ").slice(0, 160) || "مستخدم";
  const existing = await run("SELECT status FROM tg_users WHERE telegram_id = $1", [telegramId]);
  if (existing.rowCount) {
    if (existing.rows[0].status === "blocked") return { admission: "blocked", isNew: false };
    await run(
      "UPDATE tg_users SET username = $2, display_name = $3, language_code = $4, last_seen_at = now(), last_activity_at = now() WHERE telegram_id = $1",
      [telegramId, from.username || null, displayName, from.language_code || null],
    );
    return { admission: "active", isNew: false };
  }
  const insert = await run(
    "INSERT INTO tg_users (telegram_id, username, display_name, language_code, status, first_seen_at, last_seen_at, last_activity_at) VALUES ($1, $2, $3, $4, 'active', now(), now(), now()) ON CONFLICT (telegram_id) DO NOTHING",
    [telegramId, from.username || null, displayName, from.language_code || null],
  );
  if (!insert.rowCount) {
    await run(
      "UPDATE tg_users SET username = $2, display_name = $3, language_code = $4, last_seen_at = now(), last_activity_at = now() WHERE telegram_id = $1",
      [telegramId, from.username || null, displayName, from.language_code || null],
    );
  }
  return { admission: "active", isNew: true };
}

export async function getUser(telegramId: string): Promise<MemoryBotUser | undefined> {
  await ensureSchema();
  const result = await run(`SELECT ${USER_COLUMNS} FROM tg_users WHERE telegram_id = $1`, [String(telegramId)]);
  return result.rows.length ? mapUserRow(result.rows[0] as UserRow) : undefined;
}

export async function findUserByUsername(username: string): Promise<MemoryBotUser | undefined> {
  await ensureSchema();
  const result = await run(`SELECT ${USER_COLUMNS} FROM tg_users WHERE lower(username) = lower($1) LIMIT 1`, [username]);
  return result.rows.length ? mapUserRow(result.rows[0] as UserRow) : undefined;
}

export async function setUserStatus(telegramId: string, blocked: boolean): Promise<MemoryBotUser | undefined> {
  await ensureSchema();
  const result = await run(
    `UPDATE tg_users SET status = $2, last_activity_at = now() WHERE telegram_id = $1 RETURNING ${USER_COLUMNS.replace(/^id,/, "")}`,
    [telegramId, blocked ? "blocked" : "active"],
  );
  return result.rows.length ? mapUserRow({ id: "0", ...result.rows[0] } as UserRow) : undefined;
}

export async function listUsers(kind: "recent" | "active" | "blocked" | "inactive", limit: number, inactiveBefore: Date) {
  await ensureSchema();
  let where = "";
  const params: unknown[] = [];
  if (kind === "active") where = " WHERE status = 'active'";
  if (kind === "blocked") where = " WHERE status = 'blocked'";
  if (kind === "inactive") {
    where = " WHERE status = 'active' AND last_activity_at < $1";
    params.push(inactiveBefore);
  }
  const limitParam = params.length + 1;
  const orderBy = kind === "recent" ? "first_seen_at" : "last_seen_at";
  params.push(limit);
  const result = await run(`SELECT ${USER_COLUMNS} FROM tg_users${where} ORDER BY ${orderBy} DESC LIMIT $${limitParam}`, params);
  return result.rows.map(row => mapUserRow(row as UserRow));
}

export async function stats(inactiveBefore: Date, dayStart: Date) {
  await ensureSchema();
  const result = await run(
    `SELECT
      COUNT(*)::int AS total,
      COUNT(*) FILTER (WHERE last_activity_at >= $1)::int AS "activeToday",
      COUNT(*) FILTER (WHERE first_seen_at >= $1)::int AS "joinedToday",
      COUNT(*) FILTER (WHERE status = 'blocked')::int AS blocked,
      COUNT(*) FILTER (WHERE status = 'active' AND last_activity_at < $2)::int AS inactive
    FROM tg_users`,
    [dayStart, inactiveBefore],
  );
  const row = result.rows[0] as { total: number; activeToday: number; joinedToday: number; blocked: number; inactive: number };
  return { total: row.total, activeToday: row.activeToday, joinedToday: row.joinedToday, blocked: row.blocked, inactive: row.inactive };
}

export async function activeRecipientIds(): Promise<string[]> {
  await ensureSchema();
  const result = await run("SELECT telegram_id FROM tg_users WHERE status = 'active'");
  return result.rows.map(row => String(row.telegram_id));
}

/** Deletes inactive non-owner users together with all their access/quota records. Returns removed ids. */
export async function pruneUsers(inactiveBefore: Date, ownerIds: string[]): Promise<string[]> {
  await ensureSchema();
  const removed = await run(
    "DELETE FROM tg_users WHERE status = 'active' AND last_activity_at < $1 AND NOT (telegram_id = ANY($2::text[])) RETURNING telegram_id",
    [inactiveBefore, ownerIds],
  );
  const ids = removed.rows.map(row => String(row.telegram_id));
  if (ids.length) {
    await run("DELETE FROM tg_access WHERE telegram_id = ANY($1::text[])", [ids]);
  }
  return ids;
}

export async function ensurePrimaryOwnerWeb(telegramId: string) {
  await ensureSchema();
  await run(
    "INSERT INTO tg_owners (telegram_id, role, added_at, added_by) VALUES ($1, 'primary', now(), $1) ON CONFLICT (telegram_id) DO UPDATE SET role = 'primary'",
    [String(telegramId)],
  );
}

export async function getOwnerRole(telegramId: string): Promise<"primary" | "owner" | undefined> {
  await ensureSchema();
  const result = await run("SELECT role FROM tg_owners WHERE telegram_id = $1", [String(telegramId)]);
  return result.rows.length ? (result.rows[0].role as "primary" | "owner") : undefined;
}

export async function listOwners(): Promise<MemoryBotOwner[]> {
  await ensureSchema();
  const result = await run<OwnerRow>(
    "SELECT telegram_id AS \"telegramId\", role, added_at AS \"addedAt\", added_by AS \"addedBy\" FROM tg_owners ORDER BY added_at DESC",
  );
  return result.rows.map(row => ({
    id: 0,
    telegramId: row.telegramId,
    role: row.role,
    addedAt: row.addedAt,
    addedByTelegramId: row.addedBy,
  }));
}

export async function addOwner(telegramId: string, addedByTelegramId: string): Promise<boolean> {
  await ensureSchema();
  const insert = await run(
    "INSERT INTO tg_owners (telegram_id, role, added_at, added_by) VALUES ($1, 'owner', now(), $2) ON CONFLICT (telegram_id) DO NOTHING",
    [telegramId, addedByTelegramId],
  );
  return Boolean(insert.rowCount);
}

export async function removeOwner(telegramId: string): Promise<"primary" | undefined | boolean> {
  await ensureSchema();
  const owner = await run("SELECT telegram_id, role FROM tg_owners WHERE telegram_id = $1", [telegramId]);
  if (!owner.rows.length) return false;
  if (owner.rows[0].role === "primary") return "primary";
  await run("DELETE FROM tg_owners WHERE telegram_id = $1", [telegramId]);
  return true;
}

export async function getSettings(): Promise<MemoryBotSettings> {
  await ensureSchema();
  const result = await run(
    `SELECT id, max_users AS "maxUsers", cleanup_inactive_days AS "cleanupInactiveDays", cleanup_temp_minutes AS "cleanupTempMinutes",
     broadcast_rate_per_second AS "broadcastRatePerSecond", notify_new_users AS "notifyNewUsers",
     usage_limit_enabled AS "usageLimitEnabled", usage_limit_count AS "usageLimitCount",
     usage_limit_window_hours AS "usageLimitWindowHours", paid_mode_enabled AS "paidModeEnabled", updated_at AS "updatedAt"
     FROM tg_settings WHERE id = 1`,
  );
  if (result.rows.length) return result.rows[0] as MemoryBotSettings;
  const defaults: SettingsRow = {
    maxUsers: 100,
    cleanupInactiveDays: 30,
    cleanupTempMinutes: 60,
    broadcastRatePerSecond: 20,
    notifyNewUsers: true,
    usageLimitEnabled: false,
    usageLimitCount: 5,
    usageLimitWindowHours: 24,
    paidModeEnabled: false,
    updatedAt: new Date(),
  };
  const insert = await run(
    `INSERT INTO tg_settings (id, max_users, cleanup_inactive_days, cleanup_temp_minutes, broadcast_rate_per_second, notify_new_users, usage_limit_enabled, usage_limit_count, usage_limit_window_hours, paid_mode_enabled, updated_at)
     VALUES (1, $1, $2, $3, $4, $5, $6, $7, $8, $9, $10) ON CONFLICT DO NOTHING`,
    [defaults.maxUsers, defaults.cleanupInactiveDays, defaults.cleanupTempMinutes, defaults.broadcastRatePerSecond, defaults.notifyNewUsers, defaults.usageLimitEnabled, defaults.usageLimitCount, defaults.usageLimitWindowHours, defaults.paidModeEnabled, defaults.updatedAt],
  );
  if (!insert.rowCount) return (await run(`SELECT id, max_users AS "maxUsers", cleanup_inactive_days AS "cleanupInactiveDays", cleanup_temp_minutes AS "cleanupTempMinutes", broadcast_rate_per_second AS "broadcastRatePerSecond", notify_new_users AS "notifyNewUsers", usage_limit_enabled AS "usageLimitEnabled", usage_limit_count AS "usageLimitCount", usage_limit_window_hours AS "usageLimitWindowHours", paid_mode_enabled AS "paidModeEnabled", updated_at AS "updatedAt" FROM tg_settings WHERE id = 1`)).rows[0] as MemoryBotSettings;
  return { id: 1, ...defaults, updatedAt: new Date() };
}

export async function saveSettings(settings: MemoryBotSettings) {
  await ensureSchema();
  await run(
    `INSERT INTO tg_settings (id, max_users, cleanup_inactive_days, cleanup_temp_minutes, broadcast_rate_per_second, notify_new_users, usage_limit_enabled, usage_limit_count, usage_limit_window_hours, paid_mode_enabled, updated_at)
     VALUES (1, $1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     ON CONFLICT (id) DO UPDATE SET max_users = EXCLUDED.max_users, cleanup_inactive_days = EXCLUDED.cleanup_inactive_days, cleanup_temp_minutes = EXCLUDED.cleanup_temp_minutes, broadcast_rate_per_second = EXCLUDED.broadcast_rate_per_second, notify_new_users = EXCLUDED.notify_new_users, usage_limit_enabled = EXCLUDED.usage_limit_enabled, usage_limit_count = EXCLUDED.usage_limit_count, usage_limit_window_hours = EXCLUDED.usage_limit_window_hours, paid_mode_enabled = EXCLUDED.paid_mode_enabled, updated_at = EXCLUDED.updated_at`,
    [settings.maxUsers, settings.cleanupInactiveDays, settings.cleanupTempMinutes, settings.broadcastRatePerSecond, settings.notifyNewUsers, settings.usageLimitEnabled, settings.usageLimitCount, settings.usageLimitWindowHours, settings.paidModeEnabled, settings.updatedAt],
  );
}

type PlanRow = { id: string; name: string; durationDays: number; stars: number; active: boolean; createdAt: Date };
type SubscriptionRow = { id: string; target: string; inviteUrl: string; label: string; kind: ForcedSubscription["kind"]; createdAt: Date };

export async function listForcedSubscriptions(): Promise<ForcedSubscription[]> {
  await ensureSchema();
  const result = await run<SubscriptionRow>(
    "SELECT id, target, invite_url AS \"inviteUrl\", label, kind, created_at AS \"createdAt\" FROM tg_subscriptions ORDER BY created_at ASC",
  );
  return result.rows.map(row => ({ id: row.id, target: row.target, inviteUrl: row.inviteUrl, label: row.label, kind: row.kind, createdAt: row.createdAt }));
}

export async function addForcedSubscription(input: Omit<ForcedSubscription, "id" | "createdAt">): Promise<boolean> {
  await ensureSchema();
  const id = nanoid(12);
  const insert = await run(
    "INSERT INTO tg_subscriptions (id, target, invite_url, label, kind, created_at) VALUES ($1, $2, $3, $4, $5, now()) ON CONFLICT (target) DO NOTHING",
    [id, input.target, input.inviteUrl, input.label, input.kind],
  );
  return Boolean(insert.rowCount);
}

export async function removeForcedSubscription(id: string): Promise<boolean> {
  await ensureSchema();
  const result = await run("DELETE FROM tg_subscriptions WHERE id = $1", [id]);
  return Boolean(result.rowCount);
}

export async function listSubscriptionPlans(): Promise<SubscriptionPlan[]> {
  await ensureSchema();
  const result = await run<PlanRow>(
    "SELECT id, name, duration_days AS \"durationDays\", stars, active, created_at AS \"createdAt\" FROM tg_plans ORDER BY created_at ASC",
  );
  return result.rows.map(row => ({ id: row.id, name: row.name, durationDays: row.durationDays, stars: row.stars, active: row.active, createdAt: row.createdAt }));
}

export async function addSubscriptionPlan(input: { name: string; durationDays: number; stars: number }): Promise<SubscriptionPlan> {
  await ensureSchema();
  const id = nanoid(12);
  const created = new Date();
  await run(
    "INSERT INTO tg_plans (id, name, duration_days, stars, active, created_at) VALUES ($1, $2, $3, $4, TRUE, $5)",
    [id, input.name, input.durationDays, input.stars, created],
  );
  return { id, name: input.name, durationDays: input.durationDays, stars: input.stars, active: true, createdAt: created };
}

export async function findSubscriptionPlanById(id: string): Promise<SubscriptionPlan | undefined> {
  await ensureSchema();
  const result = await run<PlanRow>(
    "SELECT id, name, duration_days AS \"durationDays\", stars, active, created_at AS \"createdAt\" FROM tg_plans WHERE id = $1",
    [id],
  );
  return result.rows.length ? { id: result.rows[0].id, name: result.rows[0].name, durationDays: result.rows[0].durationDays, stars: result.rows[0].stars, active: result.rows[0].active, createdAt: result.rows[0].createdAt } : undefined;
}

export async function setSubscriptionPlanActive(id: string, active: boolean): Promise<boolean> {
  await ensureSchema();
  const result = await run("UPDATE tg_plans SET active = $2 WHERE id = $1", [id, active]);
  return Boolean(result.rowCount);
}

export async function getAccessRecord(telegramId: string): Promise<UserAccessRecord> {
  await ensureSchema();
  const id = String(telegramId);
  const result = await run(
    "SELECT subscription_expires_at AS \"subscriptionExpiresAt\", subscription_plan_id AS \"subscriptionPlanId\", download_timestamps AS \"downloadTimestamps\" FROM tg_access WHERE telegram_id = $1",
    [id],
  );
  if (result.rows.length) {
    const row = result.rows[0] as { subscriptionExpiresAt: Date | null; subscriptionPlanId: string | null; downloadTimestamps: number[] };
    return {
      subscriptionExpiresAt: row.subscriptionExpiresAt ? row.subscriptionExpiresAt.getTime() : null,
      subscriptionPlanId: row.subscriptionPlanId,
      downloadTimestamps: Array.isArray(row.downloadTimestamps) ? row.downloadTimestamps.filter((value: unknown) => typeof value === "number") : [],
    };
  }
  const record: UserAccessRecord = { subscriptionExpiresAt: null, subscriptionPlanId: null, downloadTimestamps: [] };
  await run(
    "INSERT INTO tg_access (telegram_id, subscription_expires_at, subscription_plan_id, download_timestamps) VALUES ($1, NULL, NULL, '[]'::jsonb) ON CONFLICT (telegram_id) DO NOTHING",
    [id],
  );
  return record;
}

export async function saveAccessRecord(telegramId: string, record: UserAccessRecord) {
  await ensureSchema();
  await run(
    "INSERT INTO tg_access (telegram_id, subscription_expires_at, subscription_plan_id, download_timestamps) VALUES ($1, $2, $3, $4::jsonb) ON CONFLICT (telegram_id) DO UPDATE SET subscription_expires_at = EXCLUDED.subscription_expires_at, subscription_plan_id = EXCLUDED.subscription_plan_id, download_timestamps = EXCLUDED.download_timestamps",
    [
      String(telegramId),
      record.subscriptionExpiresAt ? new Date(record.subscriptionExpiresAt) : null,
      record.subscriptionPlanId,
      JSON.stringify(record.downloadTimestamps || []),
    ],
  );
}

/** Global, cross-instance deduplication lock backed by the database primary key. */
export async function claimUpdate(updateId: number): Promise<boolean> {
  await ensureSchema();
  const insert = await run(
    "INSERT INTO tg_claims (update_id, claimed_at) VALUES ($1, now()) ON CONFLICT (update_id) DO NOTHING",
    [String(updateId)],
  );
  return Boolean(insert.rowCount);
}

export async function trimClaims(before: Date) {
  await ensureSchema();
  await run("DELETE FROM tg_claims WHERE claimed_at < $1", [before]);
}

export async function endSupabasePool() {
  if (pool) {
    await pool.end();
    pool = undefined;
  }
}