import { execFile } from "node:child_process";
import { mkdtemp, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const MAX_ARCHIVE_BYTES = 45 * 1024 * 1024;
const PROJECT_ENTRIES = [
  "client", "server", "drizzle", "shared", "patches", "scripts",
  "package.json", "pnpm-lock.yaml", "tsconfig.json", "vite.config.ts", "drizzle.config.ts", "components.json",
  "Dockerfile", "README.md", "todo.md", "facebook-link-investigation.md", "production-verification.md",
];

export class ProjectArchiveError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProjectArchiveError";
  }
}

async function availableProjectEntries(projectRoot: string) {
  const entries = await Promise.all(PROJECT_ENTRIES.map(async entry => {
    try {
      await stat(path.join(projectRoot, entry));
      return entry;
    } catch {
      return undefined;
    }
  }));
  return entries.filter((entry): entry is string => Boolean(entry));
}

export async function createProjectArchive(projectRoot = process.cwd()) {
  const entries = await availableProjectEntries(projectRoot);
  if (!entries.length) throw new ProjectArchiveError("تعذر العثور على ملفات المشروع القابلة للتصدير في بيئة الاستضافة.");
  const workdir = await mkdtemp(path.join(os.tmpdir(), "telegram-project-export-"));
  const archivePath = path.join(workdir, "telegram-media-downloader-project.zip");
  try {
    await execFileAsync("zip", ["-q", "-r", archivePath, ...entries], {
      cwd: projectRoot,
      timeout: 90_000,
      maxBuffer: 2 * 1024 * 1024,
    });
    const archive = await stat(archivePath);
    if (archive.size > MAX_ARCHIVE_BYTES) {
      throw new ProjectArchiveError("حجم نسخة المشروع أكبر من الحد الآمن للإرسال عبر البوت.");
    }
    return { archivePath, workdir, bytes: archive.size };
  } catch (error) {
    await rm(workdir, { recursive: true, force: true });
    if (error instanceof ProjectArchiveError) throw error;
    throw new ProjectArchiveError("تعذر إنشاء نسخة المشروع الآن. حاول مرة أخرى لاحقاً.");
  }
}

export async function purgeProjectArchive(workdir: string) {
  await rm(workdir, { recursive: true, force: true });
}
