export class DownloadQueueError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DownloadQueueError";
  }
}

type QueueTask<T> = {
  run: () => Promise<T>;
  resolve: (value: T) => void;
  reject: (reason: unknown) => void;
};

const MAX_CONCURRENT_DOWNLOADS = 2;
const MAX_QUEUED_DOWNLOADS = 12;
let active = 0;
const pending: QueueTask<unknown>[] = [];

function pumpQueue() {
  while (active < MAX_CONCURRENT_DOWNLOADS && pending.length) {
    const task = pending.shift()!;
    active += 1;
    task.run()
      .then(task.resolve, task.reject)
      .finally(() => {
        active -= 1;
        pumpQueue();
      });
  }
}

export function scheduleDownload<T>(run: () => Promise<T>) {
  if (pending.length >= MAX_QUEUED_DOWNLOADS) {
    throw new DownloadQueueError("البوت مشغول حالياً بعدة تنزيلات. انتظر دقيقة ثم حاول مجدداً.");
  }
  const position = active + pending.length + 1;
  const completion = new Promise<T>((resolve, reject) => {
    pending.push({ run, resolve, reject } as QueueTask<unknown>);
    pumpQueue();
  });
  return { position, completion };
}

export function getDownloadQueueStats() {
  return { active, waiting: pending.length, maxConcurrent: MAX_CONCURRENT_DOWNLOADS, maxWaiting: MAX_QUEUED_DOWNLOADS };
}

export function resetDownloadQueueForTests() {
  active = 0;
  pending.splice(0, pending.length);
}
