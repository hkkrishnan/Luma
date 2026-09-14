const { test, expect } = require("@playwright/test");

test("slash capture assigns importance and derives urgency from the due date", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Start a new Markdown file" }).click();
  const today = await page.evaluate(() => new Date().toLocaleDateString(undefined, { month: "short", day: "numeric" }));
  await expect(page.locator(".timeline span").last()).toHaveText(today);

  await page.keyboard.press("/");
  await expect(page.getByLabel("Add a task")).toBeFocused();
  await page.keyboard.type("Plan launch tomorrow");
  await page.keyboard.press("Enter");
  await expect(page.locator(".lite-task", { hasText: "Plan launch" })).toHaveClass(/task-reconsider/);

  await page.keyboard.press("/");
  await page.keyboard.press("i");
  await expect(page.locator(".lite-capture-wrap")).toHaveClass(/is-important/);
  await page.keyboard.type("Send proposal tomorrow");
  await page.keyboard.press("Enter");
  await expect(page.locator(".lite-task", { hasText: "Send proposal" })).toHaveClass(/task-do-first/);

  await page.getByText("Send proposal").click();
  await expect(page.getByText("Urgency is calculated automatically from the due date.")).toHaveCount(0);
  await expect(page.locator("#task-urgency")).toHaveCount(0);

  const later = new Date();
  later.setDate(later.getDate() + 30);
  const namedDate = later.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  await page.keyboard.press("/");
  await page.keyboard.type(`Plan release ${namedDate}`);
  await page.keyboard.press("Enter");
  const laterTask = page.locator(".lite-task", { hasText: "Plan release" });
  await expect(laterTask).toHaveClass(/task-schedule/);
  await expect(laterTask).toContainText(namedDate);
  await expect(page.locator(".timeline span", { hasText: namedDate })).toHaveCount(1);

  await page.getByText("Plan release").click();
  await expect(page.locator("#task-importance")).toHaveValue("important");
  await expect(page.locator("#task-importance option[value='less-important']")).toHaveCount(0);

  await page.getByRole("button", { name: "Search tasks" }).click();
  const search = page.getByLabel("Search tasks");
  await search.pressSequentially("Plan release");
  await expect(search).toHaveValue("Plan release");
  await expect(laterTask).toBeVisible();

  await page.waitForTimeout(250);
  await page.reload();
  await expect(page.getByText("Plan release")).toBeVisible();
  await page.getByRole("button", { name: "Open workspace menu" }).click();
  const clear = page.getByRole("button", { name: "Clear browser workspace" });
  await expect(clear).toBeVisible();
  page.once("dialog", (dialog) => dialog.accept());
  await clear.click();
  await expect(page.getByRole("button", { name: "Start a new Markdown file" })).toBeVisible();
});
