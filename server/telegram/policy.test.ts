import { describe, expect, it } from "vitest";
import { canAdmitNewUser, canShowOwnerKeyboard, cleanupInactiveBefore, isValidCleanupDays, isValidMaxUsers, isValidTelegramUpdateId } from "./policy";

describe("سياسة المالك والسعة", () => {
  it("يُظهر لوحة التحكم للمالك الأساسي فقط", () => {
    expect(canShowOwnerKeyboard("primary")).toBe(true);
    expect(canShowOwnerKeyboard("owner")).toBe(false);
    expect(canShowOwnerKeyboard(undefined)).toBe(false);
  });

  it("يحمي حد المستخدمين مع استثناء الملاك", () => {
    expect(canAdmitNewUser(99, 100, undefined)).toBe(true);
    expect(canAdmitNewUser(100, 100, undefined)).toBe(false);
    expect(canAdmitNewUser(100, 100, "owner")).toBe(true);
  });
});

describe("سياسة التنظيف وتحديثات Telegram", () => {
  it("يقيد إعدادات التنظيف والسعة إلى نطاقات آمنة", () => {
    expect(isValidMaxUsers(1)).toBe(true);
    expect(isValidMaxUsers(1_000_001)).toBe(false);
    expect(isValidCleanupDays(7)).toBe(true);
    expect(isValidCleanupDays(6)).toBe(false);
  });

  it("يحسب حد عدم النشاط ويتحقق من معرف التحديث", () => {
    expect(cleanupInactiveBefore(30, 1_700_000_000_000).getTime()).toBe(1_697_408_000_000);
    expect(isValidTelegramUpdateId(0)).toBe(true);
    expect(isValidTelegramUpdateId(-1)).toBe(false);
    expect(isValidTelegramUpdateId("12")).toBe(false);
  });
});
