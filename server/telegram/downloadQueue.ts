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

const pending: QueueTask<unknown>[] = [];
let active = 0;
let startedTotal = 0;
let completedTotal = 0;

function configNumber(name: string, fallback: number, min: number, max: number) {
  const raw = Number(process.env[name]);
  if (!Number.isFinite(raw)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(raw)));
}

function maxConcurrent() {
  return configNumber("DOWNLOAD_MAX_CONCURRENT", 2, 1, 64);
}

function maxWaiting() {
  return configNumber("DOWNLOAD_MAX_WAITING", 1000, 10, 50_000);
}

function pumpQueue() {
  while (active < maxConcurrent() && pending.length) {
    const task = pending.shift()!;
    active += 1;
    startedTotal += 1;
    task.run()
      .then(task.resolve, task.reject)
      .finally(() => {
        active -= 1;
        completedTotal += 1;
        pumpQueue();
      });
  }
}

export function scheduleDownload<T>(run: () => Promise<T>) {
  if (pending.length >= maxWaiting()) {
    throw new DownloadQueueError("البوت يعالج حالياً عدداً كبيراً من التنزيلات. أعد المحاولة بعد لحظات.");
  }
  const position = active + pending.length + 1;
  const completion = new Promise<T>((resolve, reject) => {
    pending.push({ run, resolve, reject } as QueueTask<unknown>);
    pumpQueue();
  });
  return { position, completion };
}

export function getDownloadQueueStats() {
  return {
    active,
    waiting: pending.length,
    maxConcurrent: maxConcurrent(),
    maxWaiting: maxWaiting(),
    started: startedTotal,
    completed: completedTotal,
  };
}

export function resetDownloadQueueForTests() {
  active = 0;
  pending.splice(0, pending.length);
  startedTotal = 0;
  completedTotal = 0;
}