import { afterEach, describe, expect, it } from "vitest";
import { isPollingEnabled } from "./polling";

describe("وضع الاستعلام المحلي", () => {
  const original = process.env.TELEGRAM_POLLING;

  afterEach(() => {
    if (original === undefined) delete process.env.TELEGRAM_POLLING;
    else process.env.TELEGRAM_POLLING = original;
  });

  it("يُفعَّل بالقيم المقبولة فقط", () => {
    for (const value of ["1", "true", "TRUE", "yes", " 1 "]) {
      process.env.TELEGRAM_POLLING = value;
      expect(isPollingEnabled()).toBe(true);
    }
    for (const value of ["0", "false", "", "off"]) {
      process.env.TELEGRAM_POLLING = value;
      expect(isPollingEnabled()).toBe(false);
    }
    delete process.env.TELEGRAM_POLLING;
    expect(isPollingEnabled()).toBe(false);
  });
});
