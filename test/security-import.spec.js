const { test, expect } = require("@playwright/test");

test("rejects an oversized Markdown file before parsing or saving it", async ({ page }) => {
  await page.goto("/");
  await page.locator("#markdown-file").setInputFiles({
    name: "too-large.md",
    mimeType: "text/markdown",
    buffer: Buffer.alloc((5 * 1024 * 1024) + 1, 0x61),
  });
  await expect(page.locator(".lite-error")).toContainText("5 MiB import limit");
  await expect(page.getByText("Open your Luma Markdown")).toBeVisible();
});

test("renders imported Markdown as text rather than executable HTML", async ({ page }) => {
  const markdown = `---\ntype: luma-profile\nid: work\ntitle: Work\n---\n\n## Tasks\n\n\`\`\`yaml\n- id: hostile\n  title: "<img src=x onerror=window.pwned=1>"\n  notes: "<script>window.pwned=1</script>"\n\`\`\`\n\n## Notes\n\n\`\`\`text\n<img src=x onerror=window.pwned=1>\n\`\`\``;
  await page.goto("/");
  await page.locator("#markdown-file").setInputFiles({
    name: "hostile.md",
    mimeType: "text/markdown",
    buffer: Buffer.from(markdown),
  });
  await expect(page.locator(".lite-task-title")).toHaveText("<img src=x onerror=window.pwned=1>");
  await expect(page.locator(".lite-canvas img")).toHaveCount(0);
  await expect(page.evaluate(() => window.pwned)).resolves.toBeUndefined();
});
