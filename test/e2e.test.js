const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");

test("static shell references only first-party Lite assets", () => {
  const html = fs.readFileSync("index.html", "utf8");
  assert.match(html, /luma-markdown\.js/);
  assert.match(html, /app\.js/);
  assert.doesNotMatch(html, /https?:\/\//);
});

test("service worker has an explicit static-shell allowlist", () => {
  const worker = fs.readFileSync("sw.js", "utf8");
  assert.match(worker, /const SHELL/);
  assert.match(worker, /SHELL\.includes/);
  assert.doesNotMatch(worker, /cache\.put\(event\.request, copy\)/);
  assert.match(worker, /Workspace content never enters this cache/);
});

test("CSP permits only same-origin executable and stylesheet assets", () => {
  const html = fs.readFileSync("index.html", "utf8");
  assert.match(html, /script-src 'self'/);
  assert.match(html, /style-src 'self'/);
  assert.doesNotMatch(html, /style-src 'self' 'unsafe-inline'/);
  assert.match(html, /style-src-attr 'unsafe-inline'/);
  assert.doesNotMatch(html, /<style[\s>]/i);
});

test("app owns local recovery and external-conflict safeguards", () => {
  const app = fs.readFileSync("app.js", "utf8");
  assert.match(app, /beforeunload/);
  assert.match(app, /createWritable/);
  assert.match(app, /changed outside Luma/);
  assert.match(app, /indexedDB/);
  assert.match(app, /Reconnect/);
});
