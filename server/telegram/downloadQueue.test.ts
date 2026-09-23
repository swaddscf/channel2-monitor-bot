import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DownloadQueueError, getDownloadQueueStats, resetDownloadQueueForTests, scheduleDownload } from "./downloadQueue";

beforeEach(() => {
  process.env.DOWNLOAD_MAX_CONCURRENT = "2";
  process.env.DOWNLOAD_MAX_WAITING = "12";
});

afterEach(() => {
  resetDownloadQueueForTests();
  delete process.env.DOWNLOAD_MAX_CONCURRENT;
  delete process.env.DOWNLOAD_MAX_WAITING;
});

describe("صف التنزيل", () => {
  it("يشغّل مهمتين فقط بالتوازي ويضع التالية في الانتظار", async () => {
    let releaseFirst!: () => void;
    let releaseSecond!: () => void;
    const first = scheduleDownload(() => new Promise<string>(resolve => { releaseFirst = () => resolve("الأول"); }));
    const second = scheduleDownload(() => new Promise<string>(resolve => { releaseSecond = () => resolve("الثاني"); }));
    const third = scheduleDownload(async () => "الثالث");
    expect(first.position).toBe(1);
    expect(second.position).toBe(2);
    expect(third.position).toBe(3);
    expect(getDownloadQueueStats()).toMatchObject({ active: 2, waiting: 1 });
    releaseFirst();
    await first.completion;
    releaseSecond();
    await expect(second.completion).resolves.toBe("الثاني");
    await expect(third.completion).resolves.toBe("الثالث");
  });

  it("يرفض الطلب عند امتلاء صف الانتظار", () => {
    scheduleDownload(async () => new Promise<string>(() => undefined));
    scheduleDownload(async () => new Promise<string>(() => undefined));
    for (let index = 0; index < 12; index += 1) scheduleDownload(async () => "queued");
    expect(() => scheduleDownload(async () => "overflow")).toThrow(DownloadQueueError);
  });

  it("يقرأ حدود التزامن من متغيرات البيئة ويرفع السعة للضغط العالي", () => {
    delete process.env.DOWNLOAD_MAX_CONCURRENT;
    delete process.env.DOWNLOAD_MAX_WAITING;
    expect(getDownloadQueueStats()).toMatchObject({ maxConcurrent: 2, maxWaiting: 1000 });
    process.env.DOWNLOAD_MAX_CONCURRENT = "8";
    process.env.DOWNLOAD_MAX_WAITING = "12";
  });

  it("لا يتجاوز الحد الأقصى المسموح عند الضبط ببيئة مفرطة", () => {
    process.env.DOWNLOAD_MAX_CONCURRENT = "999";
    process.env.DOWNLOAD_MAX_WAITING = "999999";
    expect(getDownloadQueueStats()).toMatchObject({ maxConcurrent: 64, maxWaiting: 50_000 });
  });

  it("يتبع ترتيب الوصول (FIFO) ويحسب الإحصاءات المنجزة", async () => {
    const order: string[] = [];
    const first = scheduleDownload(async () => { order.push("أول"); return 1; });
    const second = scheduleDownload(async () => { order.push("ثان"); return 2; });
    await Promise.all([first.completion, second.completion]);
    expect(order).toEqual(["أول", "ثان"]);
    const stats = getDownloadQueueStats();
    expect(stats.completed).toBeGreaterThanOrEqual(2);
    expect(stats.started).toBeGreaterThanOrEqual(2);
  });
});