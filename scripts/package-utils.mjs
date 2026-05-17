import { execFile } from "node:child_process";
import { cp, mkdir, readdir, rm } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const ALLOWED_ICON_FILENAME_PATTERN = /^(?:icon\.svg|icon-\d{2,3}\.png)$/;

export async function copyAllowedIcons(sourceDir, destinationDir) {
  await mkdir(destinationDir, { recursive: true });

  const entries = await readdir(sourceDir, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isFile() || !ALLOWED_ICON_FILENAME_PATTERN.test(entry.name)) {
      continue;
    }

    await cp(
      path.join(sourceDir, entry.name),
      path.join(destinationDir, entry.name),
    );
  }
}

export async function removeAgentsFiles(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      await removeAgentsFiles(fullPath);
    } else if (entry.name === "AGENTS.md") {
      await rm(fullPath);
    }
  }
}

export async function createZip(sourceDir, outputPath) {
  await rm(outputPath, { force: true });
  await execFileAsync("zip", ["-r", outputPath, "."], { cwd: sourceDir });
}
