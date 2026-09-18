import { afterEach, describe, expect, it } from "vitest";
import { DownloadQueueError, getDownloadQueueStats, resetDownloadQueueForTests, scheduleDownload } from "./downloadQueue";

afterEach(() => resetDownloadQueueForTests());

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
});
