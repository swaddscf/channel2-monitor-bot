import { execFile, execFileSync } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import { createProjectArchive, purgeProjectArchive } from "./projectArchive";

const execFileAsync = promisify(execFile);

function commandAvailable(command: string) {
  try {
    execFileSync(command, ["--version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

const canRunArchiveTests = commandAvailable("zip") && commandAvailable("unzip");

const workdirs: string[] = [];

afterEach(async () => {
  await Promise.all(workdirs.splice(0).map(workdir => rm(workdir, { recursive: true, force: true })));
});

describe.runIf(canRunArchiveTests)("نسخة المشروع الآمنة", () => {
  it("تضم ملفات المشروع المسموحة وتستثني الأسرار والتبعيات", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "telegram-project-fixture-"));
    workdirs.push(root);
    await mkdir(path.join(root, "server"), { recursive: true });
    await mkdir(path.join(root, "node_modules"), { recursive: true });
    await mkdir(path.join(root, ".manus-logs"), { recursive: true });
    await mkdir(path.join(root, "telegram-media-temp"), { recursive: true });
    await writeFile(path.join(root, "package.json"), "{}");
    await writeFile(path.join(root, "server", "index.ts"), "export {};");
    await writeFile(path.join(root, ".env"), "BOT_TOKEN=forbidden");
    await writeFile(path.join(root, "node_modules", "secret.js"), "forbidden");
    await writeFile(path.join(root, ".manus-logs", "devserver.log"), "forbidden");
    await writeFile(path.join(root, "telegram-media-temp", "media.mp4"), "forbidden");
    const archive = await createProjectArchive(root);
    workdirs.push(archive.workdir);
    const { stdout } = await execFileAsync("unzip", ["-Z1", archive.archivePath]);
    expect(stdout).toContain("package.json");
    expect(stdout).toContain("server/index.ts");
    expect(stdout).not.toContain(".env");
    expect(stdout).not.toContain("node_modules");
    expect(stdout).not.toContain(".manus-logs");
    expect(stdout).not.toContain("telegram-media-temp");
    await purgeProjectArchive(archive.workdir);
  });
});
