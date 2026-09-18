import { boolean, index, int, mysqlEnum, mysqlTable, text, timestamp, uniqueIndex, varchar } from "drizzle-orm/mysql-core";

/**
 * Core user table backing auth flow.
 * Extend this file with additional tables as your product grows.
 * Columns use camelCase to match both database fields and generated types.
 */
export const users = mysqlTable("users", {
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
  lastSignedIn: timestamp("lastSignedIn").defaultNow().notNull(),
});

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;

// Telegram bot domain tables
export const telegramUsers = mysqlTable("telegram_users", {
  id: int("id").autoincrement().primaryKey(),
  telegramId: varchar("telegram_id", { length: 32 }).notNull(),
  username: varchar("username", { length: 64 }),
  displayName: varchar("display_name", { length: 160 }).notNull(),
  languageCode: varchar("language_code", { length: 16 }),
  status: mysqlEnum("status", ["active", "blocked"]).notNull().default("active"),
  firstSeenAt: timestamp("first_seen_at").defaultNow().notNull(),
  lastSeenAt: timestamp("last_seen_at").defaultNow().notNull(),
  lastActivityAt: timestamp("last_activity_at").defaultNow().notNull(),
}, table => [
  uniqueIndex("telegram_users_telegram_id_unique").on(table.telegramId),
  index("telegram_users_activity_idx").on(table.lastActivityAt),
  index("telegram_users_status_idx").on(table.status),
]);

export const botOwners = mysqlTable("bot_owners", {
  id: int("id").autoincrement().primaryKey(),
  telegramId: varchar("telegram_id", { length: 32 }).notNull(),
  role: mysqlEnum("role", ["primary", "owner"]).notNull().default("owner"),
  addedAt: timestamp("added_at").defaultNow().notNull(),
  addedByTelegramId: varchar("added_by_telegram_id", { length: 32 }),
}, table => [uniqueIndex("bot_owners_telegram_id_unique").on(table.telegramId)]);

export const botSettings = mysqlTable("bot_settings", {
  id: int("id").primaryKey(),
  maxUsers: int("max_users").notNull().default(100),
  cleanupInactiveDays: int("cleanup_inactive_days").notNull().default(30),
  cleanupTempMinutes: int("cleanup_temp_minutes").notNull().default(60),
  broadcastRatePerSecond: int("broadcast_rate_per_second").notNull().default(20),
  notifyNewUsers: boolean("notify_new_users").notNull().default(true),
  updatedAt: timestamp("updated_at").defaultNow().onUpdateNow().notNull(),
});

export const botJobs = mysqlTable("bot_jobs", {
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
  updatedAt: timestamp("updated_at").defaultNow().onUpdateNow().notNull(),
}, table => [
  index("bot_jobs_expiry_idx").on(table.expiresAt),
  index("bot_jobs_user_status_idx").on(table.telegramId, table.status),
]);

export const botErrors = mysqlTable("bot_errors", {
  id: int("id").autoincrement().primaryKey(),
  telegramId: varchar("telegram_id", { length: 32 }),
  sourceUrl: varchar("source_url", { length: 2048 }),
  stage: varchar("stage", { length: 64 }).notNull(),
  message: text("message").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, table => [index("bot_errors_created_idx").on(table.createdAt)]);

export const processedTelegramUpdates = mysqlTable("processed_telegram_updates", {
  updateId: int("update_id").primaryKey(),
  processedAt: timestamp("processed_at").defaultNow().notNull(),
});

export type TelegramBotUser = typeof telegramUsers.$inferSelect;
export type BotJob = typeof botJobs.$inferSelect;
