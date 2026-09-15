const { test, expect } = require("@playwright/test");

test("an undated task groups at the Later marker without gaining a due date", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Start a new Markdown file" }).click();
  await expect(page.locator(".axis-important")).toHaveText("Important");
  await expect(page.locator(".axis-not-important span")).toHaveText(["Not", "Important"]);
  const [axis, not, important] = await Promise.all([
    page.locator(".lite-axis-y").boundingBox(),
    page.locator(".axis-not-important span").first().boundingBox(),
    page.locator(".axis-not-important span").last().boundingBox(),
  ]);
  expect(not.x + not.width).toBeLessThan(axis.x);
  expect(important.x).toBeGreaterThan(axis.x);
  await page.keyboard.press("/");
  await page.keyboard.type("Unscheduled task");
  await page.keyboard.press("Enter");
  const task = page.locator(".lite-task", { hasText: "Unscheduled task" });
  await expect(task).toHaveCSS("--x", "10%");
  await expect(task.locator(".lite-task-due")).toHaveText("Later");
  await page.getByText("Unscheduled task", { exact: true }).click();
  await expect(page.locator("#task-due")).toHaveValue("");
});

test("dense same-date tasks receive separate vertical lanes", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Start a new Markdown file" }).click();
  const dueDate = await page.evaluate(() => {
    const date = new Date();
    date.setDate(date.getDate() + 3);
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  });
  for (let number = 1; number <= 6; number += 1) {
    await page.keyboard.press("/");
    await page.keyboard.type(`Dense task ${number} ${dueDate}`);
    await page.keyboard.press("Enter");
  }
  const verticalPositions = await page.locator(".lite-task").evaluateAll((nodes) =>
    nodes.map((node) => node.style.getPropertyValue("--y")),
  );
  expect(new Set(verticalPositions).size).toBe(6);
  await expect(page.locator(".lite-task-due")).toHaveCount(1);
});

test("quick capture recognizes weekdays and relative date phrases", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Start a new Markdown file" }).click();
  await expect(page.getByRole("button", { name: "Work", exact: true })).toHaveClass(/active/);
  const expected = await page.evaluate(() => {
    const local = (date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
    const base = new Date();
    base.setHours(12, 0, 0, 0);
    const thursday = new Date(base);
    thursday.setDate(thursday.getDate() + ((4 - thursday.getDay() + 7) % 7));
    const nextThursday = new Date(thursday);
    nextThursday.setDate(nextThursday.getDate() + 7);
    const inThreeDays = new Date(base);
    inThreeDays.setDate(inThreeDays.getDate() + 3);
    const endOfMonth = new Date(base.getFullYear(), base.getMonth() + 1, 0, 12);
    return {
      thursday: local(thursday),
      nextThursday: local(nextThursday),
      inThreeDays: local(inThreeDays),
      endOfMonth: local(endOfMonth),
    };
  });
  const examples = [
    ["Review log Thursday", "Review log", expected.thursday],
    ["Follow up next Thursday", "Follow up", expected.nextThursday],
    ["Ship draft in 3 days", "Ship draft", expected.inThreeDays],
    ["Close books end of month", "Close books", expected.endOfMonth],
  ];
  for (const [entry, title, dueDate] of examples) {
    await page.keyboard.press("/");
    await page.keyboard.type(entry);
    await page.keyboard.press("Enter");
    await page.getByText(title, { exact: true }).click();
    await expect(page.locator("#task-due")).toHaveValue(dueDate);
  }
});

test("slash capture assigns importance and derives urgency from the due date", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Start a new Markdown file" }).click();
  const today = await page.evaluate(() => new Date().toLocaleDateString(undefined, { month: "short", day: "numeric" }));
  await expect(page.locator(".timeline span", { hasText: today })).toHaveCount(1);
  await expect(page.locator(".timeline span").first()).toHaveText("Later");

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
  await expect(page.locator(".timeline span")).toHaveCount(9);

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
  const clear = page.getByRole("button", { name: "Clear browser copy" });
  await expect(clear).toBeVisible();
  page.once("dialog", (dialog) => dialog.accept());
  await clear.click();
  await expect(page.getByRole("button", { name: "Start a new Markdown file" })).toBeVisible();
});
