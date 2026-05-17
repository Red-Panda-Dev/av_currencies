import { cp, mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  copyAllowedIcons,
  createZip,
  removeAgentsFiles,
} from "./package-utils.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");
const buildDir = path.join(rootDir, "build");
const firefoxDir = path.join(buildDir, "firefox");
const firefoxZipPath = path.join(rootDir, "av-currencies-firefox.zip");

const COPY_PATHS = ["manifest.json", "src"];

async function copyProjectFiles() {
  for (const relPath of COPY_PATHS) {
    const source = path.join(rootDir, relPath);
    const destination = path.join(firefoxDir, relPath);
    await mkdir(path.dirname(destination), { recursive: true });
    await cp(source, destination, { recursive: true });
  }
}

async function main() {
  await rm(firefoxDir, { recursive: true, force: true });
  await mkdir(buildDir, { recursive: true });
  await copyProjectFiles();
  await copyAllowedIcons(
    path.join(rootDir, "icons"),
    path.join(firefoxDir, "icons"),
  );
  await removeAgentsFiles(firefoxDir);
  await createZip(firefoxDir, firefoxZipPath);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
