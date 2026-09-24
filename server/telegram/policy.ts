export type OwnerRole = "primary" | "owner" | undefined;

export function canShowOwnerKeyboard(role: OwnerRole) {
  return role === "primary";
}

export function canAdmitNewUser(activeUserCount: number, maxUsers: number, role: OwnerRole) {
  return Boolean(role) || activeUserCount < maxUsers;
}

export function isValidMaxUsers(value: number) {
  return Number.isInteger(value) && value >= 1 && value <= 1_000_000;
}

export function isValidCleanupDays(value: number) {
  return Number.isInteger(value) && value >= 7 && value <= 365;
}

export function cleanupInactiveBefore(days: number, now = Date.now()) {
  return new Date(now - days * 86_400_000);
}

export function isValidUsageLimitCount(value: number) {
  return Number.isInteger(value) && value >= 1 && value <= 1_000;
}

export function isValidUsageWindowHours(value: number) {
  return Number.isInteger(value) && value >= 1 && value <= 8_760;
}

export function isValidPlanDurationDays(value: number) {
  return Number.isInteger(value) && value >= 1 && value <= 3_650;
}

export function isValidPlanStars(value: number) {
  return Number.isInteger(value) && value >= 1 && value <= 100_000;
}

export function isValidTelegramUpdateId(value: unknown) {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}
