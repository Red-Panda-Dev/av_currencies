import { execFile } from "node:child_process";
import { readdir, rm } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

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
