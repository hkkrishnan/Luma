const { test, expect } = require("@playwright/test");

test("reviews Markdown tasks before adding or replacing a workspace", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Start a new Markdown file" }).click();
  await page.keyboard.press("/");
  await page.keyboard.type("Existing task");
  await page.keyboard.press("Enter");
  await page.getByRole("button", { name: "Open workspace menu" }).click();
  await page.getByRole("button", { name: "Import", exact: true }).click();
  await page.locator("#markdown-task-import").setInputFiles({
    name: "intake.md", mimeType: "text/markdown", buffer: Buffer.from("- [ ] Imported task\n  - description: Review this\n  - due: 2026-10-01\n  - priority: high"),
  });
  await expect(page.getByRole("heading", { name: "Review Markdown tasks" })).toBeVisible();
  await expect(page.getByLabel("Imported task title")).toHaveValue("Imported task");
  await page.getByRole("button", { name: "Add selected tasks" }).click();
  await expect(page.getByText("Existing task", { exact: true })).toBeVisible();
  await expect(page.getByText("Imported task", { exact: true })).toBeVisible();
});

test("uses Luma importance rules and keeps non-urgent imports above workspace notes", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Start a new Markdown file" }).click();
  await page.getByRole("button", { name: "Open workspace menu" }).click();
  await page.getByRole("button", { name: "Import", exact: true }).click();
  await page.locator("#markdown-task-import").setInputFiles({
    name: "later.md", mimeType: "text/markdown", buffer: Buffer.from("- [ ] Unscheduled imported task\n  - priority: low\n  - due: unknown"),
  });
  const importance = page.getByLabel("Imported task importance");
  await expect(importance).toHaveValue("important");
  await expect(importance.getByRole("option", { name: "Important" })).toHaveCount(1);
  await expect(importance.getByRole("option", { name: "Not important" })).toHaveCount(0);
  await page.getByRole("button", { name: "Add selected tasks" }).click();
  const task = page.locator(".lite-task", { hasText: "Unscheduled imported task" });
  await expect(task).toHaveClass(/task-schedule/);
  const [taskBox, notesBox] = await Promise.all([
    task.boundingBox(), page.locator(".lite-notes").boundingBox(),
  ]);
  expect(taskBox.y + taskBox.height).toBeLessThan(notesBox.y);
});

test("skips an exact file re-import by default and writes bounded audit history to Markdown", async ({ page }) => {
  const markdown = "- [ ] Avoid duplicate import\n  - due: unknown\n  - priority: low";
  await page.goto("/");
  await page.getByRole("button", { name: "Start a new Markdown file" }).click();
  await page.getByRole("button", { name: "Open workspace menu" }).click();
  await page.getByRole("button", { name: "Import", exact: true }).click();
  await page.locator("#markdown-task-import").setInputFiles({
    name: "same-file.md", mimeType: "text/markdown", buffer: Buffer.from(markdown),
  });
  await page.getByRole("button", { name: "Add selected tasks" }).click();
  await page.getByRole("button", { name: "Open workspace menu" }).click();
  await page.getByRole("button", { name: "Import", exact: true }).click();
  await page.locator("#markdown-task-import").setInputFiles({
    name: "same-file.md", mimeType: "text/markdown", buffer: Buffer.from(markdown),
  });
  await expect(page.getByText("This exact file was previously imported into Work.")).toBeVisible();
  await expect(page.locator("[data-import-selected='0']")).not.toBeChecked();
  await expect(page.getByText("This exact Markdown file was imported before. Skipped by default.")).toBeVisible();
  await page.locator("[data-import-selected='0']").check();
  await page.getByRole("button", { name: "Add selected tasks" }).click();
  const downloadPromise = page.waitForEvent("download");
  await page.getByLabel("Save current Markdown workspace").click();
  const download = await downloadPromise;
  const fs = require("fs");
  const saved = fs.readFileSync(await download.path(), "utf8");
  expect(saved).toContain("### Import history");
  expect(saved).toContain("same-file.md");
  expect((saved.match(/same-file\.md/g) || []).length).toBe(2);
});

test("flags an existing identical task from a changed Markdown file", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Start a new Markdown file" }).click();
  await page.getByRole("button", { name: "Open workspace menu" }).click();
  await page.getByRole("button", { name: "Import", exact: true }).click();
  await page.locator("#markdown-task-import").setInputFiles({
    name: "first.md", mimeType: "text/markdown", buffer: Buffer.from("- [ ] Same task\n  - due: unknown"),
  });
  await page.getByRole("button", { name: "Add selected tasks" }).click();
  await page.getByRole("button", { name: "Open workspace menu" }).click();
  await page.getByRole("button", { name: "Import", exact: true }).click();
  await page.locator("#markdown-task-import").setInputFiles({
    name: "changed-wrapper.md", mimeType: "text/markdown", buffer: Buffer.from("# Different file wrapper\n\n- [ ] Same task\n  - due: unknown"),
  });
  await expect(page.getByText("An identical task already exists in this workspace. Skipped by default.")).toBeVisible();
  await expect(page.locator("[data-import-selected='0']")).not.toBeChecked();
});

test("wraps a long task title in a compact two-line editor field", async ({ page }) => {
  const title = "Prepare a detailed cross-functional launch readiness review with every stakeholder on the launch team";
  await page.goto("/");
  await page.getByRole("button", { name: "Start a new Markdown file" }).click();
  await page.keyboard.press("/");
  await page.keyboard.type(title);
  await page.keyboard.press("Enter");
  await page.locator(".lite-task-label").click();
  const editor = page.getByLabel("Task title");
  await expect(editor).toHaveValue(title);
  await expect(editor).toHaveAttribute("rows", "2");
  await expect(editor).toHaveCSS("overflow-y", "hidden");
  await editor.focus();
  await expect(editor).toHaveCSS("outline-style", "none");
});
