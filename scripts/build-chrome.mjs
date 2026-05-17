import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
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
const chromeDir = path.join(buildDir, "chrome");
const chromeZipPath = path.join(rootDir, "av-currencies-chrome.zip");

const INSTALL_NOTE = `Load this directory in Chrome-based browsers.\n\nDo not select the repository root. The root manifest is Firefox-specific and uses background.scripts.\n\nInstall steps:\n1. Open chrome://extensions.\n2. Enable Developer mode.\n3. Click Load unpacked.\n4. Select this build/chrome directory.\n`;

const COPY_PATHS = ["src"];

async function copyProjectFiles() {
  for (const relPath of COPY_PATHS) {
    const source = path.join(rootDir, relPath);
    const destination = path.join(chromeDir, relPath);
    await mkdir(path.dirname(destination), { recursive: true });
    await cp(source, destination, { recursive: true });
  }
}

async function writeChromeManifest() {
  const manifestPath = path.join(rootDir, "manifest.json");
  const manifestText = await readFile(manifestPath, "utf8");
  const manifest = JSON.parse(manifestText);

  delete manifest.browser_specific_settings;

  manifest.background = {
    service_worker: "src/background.js",
    type: "module",
  };

  const outputPath = path.join(chromeDir, "manifest.json");
  const output = `${JSON.stringify(manifest, null, 2)}\n`;
  await writeFile(outputPath, output, "utf8");
}

async function main() {
  await rm(chromeDir, { recursive: true, force: true });
  await mkdir(buildDir, { recursive: true });

  await copyProjectFiles();
  await copyAllowedIcons(
    path.join(rootDir, "icons"),
    path.join(chromeDir, "icons"),
  );
  await writeChromeManifest();
  await removeAgentsFiles(chromeDir);
  await writeFile(
    path.join(chromeDir, "README_CHROME_INSTALL.txt"),
    INSTALL_NOTE,
    "utf8",
  );
  await createZip(chromeDir, chromeZipPath);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
