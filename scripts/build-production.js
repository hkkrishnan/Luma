"use strict";

const fs = require("node:fs");
const path = require("node:path");

const ROOT_DIR = path.resolve(__dirname, "..");
const RUNTIME_ASSETS = Object.freeze([
  "index.html",
  "app.js",
  "luma-markdown.js",
  "lite-enhancements.css",
  "manifest.webmanifest",
  "sw.js",
  "icons/luma-192.svg",
  "icons/luma-512.svg",
]);

function buildProduction({ rootDir = ROOT_DIR, outDir = path.join(ROOT_DIR, "dist") } = {}) {
  fs.rmSync(outDir, { recursive: true, force: true });
  for (const asset of RUNTIME_ASSETS) {
    const source = path.join(rootDir, asset);
    const destination = path.join(outDir, asset);
    if (!fs.statSync(source).isFile()) throw new Error(`Required runtime asset is missing: ${asset}`);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.copyFileSync(source, destination);
  }
  return RUNTIME_ASSETS.map((asset) => path.join(outDir, asset));
}

if (require.main === module) {
  const output = buildProduction();
  process.stdout.write(`Built ${output.length} runtime assets in dist/.\n`);
}

module.exports = { ROOT_DIR, RUNTIME_ASSETS, buildProduction };
