const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { buildProduction, RUNTIME_ASSETS } = require("../scripts/build-production.js");

function listFiles(root, current = root) {
  return fs.readdirSync(current, { withFileTypes: true }).flatMap((entry) => {
    const absolute = path.join(current, entry.name);
    return entry.isDirectory() ? listFiles(root, absolute) : [path.relative(root, absolute).split(path.sep).join("/")];
  });
}

test("production build contains only approved runtime assets", () => {
  const output = fs.mkdtempSync(path.join(os.tmpdir(), "luma-dist-"));
  try {
    buildProduction({ outDir: output });
    const files = listFiles(output).sort();
    assert.deepEqual(files, [...RUNTIME_ASSETS].sort());
    const forbidden = /(^|\/)(?:\.git|\.env(?:\.|$)|test(?:s)?)(?:\/|$)|\.(?:map|log|bak|zip|tar|gz|pem|key|sqlite|db)$/i;
    files.forEach((file) => assert.doesNotMatch(file, forbidden));
  } finally {
    fs.rmSync(output, { recursive: true, force: true });
  }
});

test("production shell is safe below the /Luma/ project base path", () => {
  const html = fs.readFileSync("index.html", "utf8");
  const worker = fs.readFileSync("sw.js", "utf8");
  const manifest = fs.readFileSync("manifest.webmanifest", "utf8");
  for (const asset of ["luma-markdown.js", "app.js", "lite-enhancements.css", "manifest.webmanifest"]) {
    assert.match(html, new RegExp(`(?:src|href)="\\./${asset.replace(".", "\\.")}`));
  }
  assert.match(worker, /"\.\/index\.html"/);
  assert.match(manifest, /"start_url"\s*:\s*"\.\/"/);
  assert.match(manifest, /"scope"\s*:\s*"\.\/"/);
});
