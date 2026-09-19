const { test, expect } = require("@playwright/test");
const fs = require("node:fs");

test("an undated task groups at the Later marker without gaining a due date", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Start a new Markdown file" }).click();
  await expect(page.locator(".axis-important")).toHaveText("Important");
  await expect(page.locator(".lite-notes")).toHaveCSS("border-top-width", "1px");
  const [notesBox, stageBox] = await Promise.all([
    page.locator(".lite-notes").boundingBox(),
    page.locator(".lite-stage").boundingBox(),
  ]);
  expect(notesBox.width).toBeLessThan(stageBox.width / 2);
  expect(notesBox.x + notesBox.width).toBeLessThan(stageBox.x + stageBox.width / 2);
  const horizontalAxis = await page.locator(".lite-axis-x").boundingBox();
  expect(notesBox.y - horizontalAxis.y).toBeLessThanOrEqual(stageBox.height * 0.08 + 2);
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

test("a one-line task places its due date directly beneath the title", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Start a new Markdown file" }).click();
  const dueDate = await page.evaluate(() => {
    const date = new Date();
    date.setDate(date.getDate() + 3);
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  });
  await page.keyboard.press("/");
  await page.keyboard.type(`Brief task ${dueDate}`);
  await page.keyboard.press("Enter");
  const task = page.locator(".lite-task").first();
  await expect(task.locator(".lite-task-due")).toHaveCount(1);
  const [title, due] = await Promise.all([
    task.locator(".lite-task-title").boundingBox(),
    task.locator(".lite-task-due").boundingBox(),
  ]);
  expect(due.y).toBeGreaterThanOrEqual(title.y + title.height);
  expect(due.y - (title.y + title.height)).toBeLessThanOrEqual(4);
});

test("overdue tasks receive individual lanes without flipping", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Start a new Markdown file" }).click();
  const dueDates = await page.evaluate(() => [1, 2, 3, 4].map((daysAgo) => {
    const date = new Date();
    date.setDate(date.getDate() - daysAgo);
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  }));
  for (const [index, dueDate] of dueDates.entries()) {
    await page.keyboard.press("/");
    await page.keyboard.type(`Overdue group task ${index + 1} ${dueDate}`);
    await page.keyboard.press("Enter");
  }
  await expect(page.locator(".lite-task-due")).toHaveCount(4);
  await expect(page.locator(".lite-task-due")).toHaveText(["Overdue", "Overdue", "Overdue", "Overdue"]);
  await expect(page.locator(".lite-task").first()).not.toHaveClass(/is-right-edge/);
  const positions = await page.locator(".lite-task").evaluateAll((nodes) => nodes
    .map((node) => Number.parseFloat(node.style.getPropertyValue("--y")))
    .sort((a, b) => a - b));
  expect(new Set(positions).size).toBe(4);
});

test("individual date cards use separate lanes and never collide at crowded timeline positions", async ({ page }) => {
  const dueDates = await page.evaluate(() => [-4, -1, 0, 1, 2, 3].map((offset) => {
    const date = new Date();
    date.setDate(date.getDate() + offset);
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  }));
  const tasks = [
    ["Overdue task one with a long title", dueDates[0]],
    ["Overdue task two with a long title", dueDates[1]],
    ["Overdue task three with a long title", dueDates[0]],
    ["Today task that is deliberately long", dueDates[2]],
    ["Tomorrow task that is deliberately long", dueDates[3]],
    ["Two-day task that is deliberately long", dueDates[4]],
    ["Three-day task that is deliberately long", dueDates[5]],
  ].map(([title, dueDate], index) => `- id: crowded-${index}\n  title: ${title}\n  status: open\n  importance: less-important\n  dueDate: ${dueDate}`).join("\n");
  const markdown = `---\ntype: northstar-profile\nversion: 1\nid: crowded\ntitle: Crowded\n---\n\n## Tasks\n\n\`\`\`yaml\n${tasks}\n\`\`\`\n\n## Notes\n\n\`\`\`text\n\`\`\`\n`;

  const assertGeometry = async () => {
    const geometry = await page.locator(".lite-task").evaluateAll((nodes) => {
      const stage = document.querySelector(".lite-stage").getBoundingClientRect();
      const cards = nodes.map((node) => {
        const rect = node.getBoundingClientRect();
        return { id: node.dataset.task, left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom };
      });
      const outside = cards.filter((card) => card.left < stage.left - 1 || card.right > stage.right + 1 || card.top < stage.top - 1 || card.bottom > stage.bottom + 1);
      const dueOutsideCards = [...document.querySelectorAll(".lite-task-due")].filter((due) => {
        const rect = due.getBoundingClientRect();
        const card = due.closest(".lite-task").getBoundingClientRect();
        return rect.left < card.left - 1 || rect.right > card.right + 1 || rect.top < card.top - 1 || rect.bottom > card.bottom + 1;
      }).length;
      const collisions = cards.flatMap((card, index) => cards.slice(index + 1).flatMap((other) =>
        card.left < other.right - 1 && other.left < card.right - 1 && card.top < other.bottom - 1 && other.top < card.bottom - 1
          ? [[card.id, other.id]] : []));
      return { outside, dueOutsideCards, collisions, stageHeight: stage.height, viewportHeight: window.innerHeight };
    });
    expect(geometry.stageHeight).toBeLessThanOrEqual(geometry.viewportHeight - 57);
    expect(geometry.outside).toEqual([]);
    expect(geometry.dueOutsideCards).toBe(0);
    expect(geometry.collisions).toEqual([]);
  };

  for (const viewport of [{ width: 1536, height: 1024 }, { width: 1100, height: 800 }]) {
    await page.setViewportSize(viewport);
    await page.goto("/");
    await page.locator("#markdown-file").setInputFiles({
      name: "crowded.md",
      mimeType: "text/markdown",
      buffer: Buffer.from(markdown),
    });
    await expect(page.locator(".lite-task")).toHaveCount(7);
    await expect(page.locator(".lite-task-due")).toHaveCount(6);
    await expect(page.locator(".lite-task-title").first()).toHaveCSS("-webkit-line-clamp", viewport.height === 800 ? "1" : "2");
    await expect(page.locator(".lite-task", { hasText: "Overdue task one" }).first()).not.toHaveClass(/is-right-edge/);
    if (viewport.height === 800) await expect(page.locator(".lite-task.is-compact")).not.toHaveCount(0);
    const overdueX = await page.locator(".lite-task", { hasText: "Overdue task" }).evaluateAll((nodes) =>
      [...new Set(nodes.map((node) => node.style.getPropertyValue("--x")))],
    );
    expect(overdueX).toHaveLength(1);
    await assertGeometry();
  }
});

test("today guide, dated history, Markdown notes, and named backups work together", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Start a new Markdown file" }).click();
  await expect(page.locator(".lite-today-guide")).toHaveCSS("--today-x", "76%");

  await page.keyboard.press("/");
  await page.keyboard.type("Review full task title");
  await page.keyboard.press("Enter");
  await page.getByText("Review full task title", { exact: true }).click();
  const notes = page.locator("#task-notes");
  await notes.click();
  await page.keyboard.type("Bold note");
  await notes.evaluate((element) => {
    const range = document.createRange();
    range.selectNodeContents(element);
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
  });
  await page.keyboard.press("Control+b");
  await expect(notes).toContainText("Bold note");
  expect(await notes.evaluate((element) => element.innerHTML)).toMatch(/<(strong|b)>Bold note<\/(strong|b)>/);
  await page.keyboard.press("Control+b");
  expect(await notes.evaluate((element) => element.innerHTML)).not.toMatch(/<(strong|b)>Bold note<\/(strong|b)>/);
  await page.keyboard.press("Control+b");
  expect(await notes.evaluate((element) => element.innerHTML)).toMatch(/<(strong|b)>Bold note<\/(strong|b)>/);
  await page.getByRole("button", { name: "Save changes" }).click();

  await page.getByRole("button", { name: "Mark Review full task title complete" }).click();
  await page.getByRole("button", { name: "Open workspace menu" }).click();
  await page.getByRole("button", { name: "History" }).click();
  await expect(page.locator(".lite-history-list")).toContainText("Completed ·");
  await page.getByRole("button", { name: "Close history" }).click();

  await page.getByRole("button", { name: "Open workspace menu" }).click();
  await page.getByRole("button", { name: "Settings" }).click();
  await page.locator("[data-setting='backup-name']").selectOption("week");
  await expect(page.locator(".lite-settings-hint")).toContainText(/luma-WK\d{4}\.md/);
  await page.getByRole("button", { name: "Close settings" }).click();
  const downloadPromise = page.waitForEvent("download");
  await page.getByLabel("Save current Markdown workspace").click();
  const download = await downloadPromise;
  await expect(download.suggestedFilename()).toMatch(/^luma-WK\d{4}\.md$/);
  expect(fs.readFileSync(await download.path(), "utf8")).toContain('notes: "**Bold note**"');
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
