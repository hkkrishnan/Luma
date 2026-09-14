const { test, expect } = require("@playwright/test");
const fs = require("node:fs");

const profile = `---
type: northstar-profile
version: 1
id: personal
title: Personal
---

## Tasks

\`\`\`yaml
- id: first
  title: First important task
  status: open
  importance: important
  dueDate: 2026-09-10
  canvas:
    x: 66
    y: 24
- id: second
  title: Second important task
  status: open
  importance: important
  dueDate: 2026-09-10
  canvas:
    x: 66
    y: 24
- id: unplaced
  title: Task without a saved position
  status: open
  importance: less-important
  dueDate: 2026-10-10
\`\`\`

## Notes

\`\`\`text
Position test
\`\`\`
`;

async function positions(page) {
  return page.locator(".lite-task").evaluateAll((nodes) =>
    nodes.map((node) => ({
      id: node.dataset.task,
      x: node.style.getPropertyValue("--x"),
      y: node.style.getPropertyValue("--y"),
    })).sort((a, b) => a.id.localeCompare(b.id)),
  );
}

test("one Markdown workspace preserves profiles and aligns same-date tasks", async ({ page }) => {
  await page.goto("/");
  await page.locator("#markdown-file").setInputFiles({
    name: "personal.md",
    mimeType: "text/markdown",
    buffer: Buffer.from(profile),
  });
  await expect(page.getByText("First important task")).toBeVisible();
  await page.getByRole("button", { name: "Open workspace menu" }).click();
  await expect(page.getByRole("button", { name: "Open / replace Markdown workspace" })).toBeVisible();
  const before = await positions(page);
  expect(before.find((item) => item.id === "first").x).toBe(before.find((item) => item.id === "second").x);
  expect(before.find((item) => item.id === "first").y).not.toBe(before.find((item) => item.id === "second").y);
  const tickPositions = await page.locator(".timeline span").evaluateAll((nodes) =>
    nodes.map((node) => Number.parseFloat(node.style.getPropertyValue("--tick-x"))),
  );
  expect(tickPositions).toEqual([10, 21, 32, 43, 54, 65, 76, 88]);

  const downloadPromise = page.waitForEvent("download");
  await page.getByLabel("Save current Markdown workspace").click();
  const download = await downloadPromise;
  const path = await download.path();
  expect(path).toBeTruthy();
  const saved = fs.readFileSync(path, "utf8");
  expect(saved).toContain("type: northstar-workspace");
  expect(saved).toContain("## Profile: Personal");
  expect(saved).toContain("## Profile: Work");

  await page.reload();
  await page.locator("#markdown-file").setInputFiles(path);
  await page.getByRole("button", { name: "Personal", exact: true }).click();
  await expect(page.getByText("First important task")).toBeVisible();
  expect(await positions(page)).toEqual(before);
});
