import { describe, expect, it } from "vitest";
import { renderWelcomeBanner } from "./welcomeImage";

describe("مولّد صورة الترحيب", () => {
  it("يُرجع صورة PNG صالحة بصيغة وتوقيع صحيحين", () => {
    const png = renderWelcomeBanner();
    expect(png).toBeInstanceOf(Buffer);
    expect(png.subarray(0, 8)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    const ihdr = png.toString("ascii", 12, 16);
    expect(ihdr).toBe("IHDR");
    expect(png.toString("ascii", png.length - 8, png.length - 4)).toBe("IEND");
    expect(png.length).toBeGreaterThan(1_000);
  });
});