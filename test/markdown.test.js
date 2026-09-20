const assert = require("node:assert/strict");
const { LIMITS, parseMarkdown, serializeMarkdown, parseWorkspaceMarkdown, serializeWorkspaceMarkdown } = require(
  "../luma-markdown.js",
);
const canonical =
  `---\ntype: northstar-profile\nversion: 1\nid: personal\ntitle: Personal\n---\n\n# Personal\n\n## Tasks\n\n\`\`\`yaml\n- id: one\n  title: "Call: \\"Maya\\" #1"\n  status: open\n  importance: important\n  urgency: urgent\n  dueDate: 2026-09-08\n  notes: |\n    First line\n    Second line\n  canvas:\n    x: 70\n    y: 25\n- id: done\n  title: Finished\n  status: completed\n  completedAt: 2026-09-07T12:00:00.000Z\n\`\`\`\n\n## Notes\n\n\`\`\`text\nPersonal note\nnext line\n\`\`\``;
const personal = parseMarkdown(canonical, "Personal.md");
assert.equal(personal.id, "personal");
assert.equal(personal.tasks.length, 2);
assert.equal(personal.tasks[0].title, 'Call: "Maya" #1');
assert.equal(personal.tasks[0].notes, "First line\nSecond line");
assert.equal(personal.tasks[1].status, "completed");
assert.equal(personal.notes, "Personal note\nnext line");
const malformed = parseMarkdown(canonical.replace(/^  /gm, ""), "Personal.md");
assert.equal(malformed.tasks.length, 2);
assert.equal(malformed.tasks[0].title, 'Call: "Maya" #1');
const roundTrip = parseMarkdown(serializeMarkdown(personal), "Personal.md");
assert.match(serializeMarkdown(personal), /type: luma-profile/);
assert.equal(roundTrip.tasks.length, 2);
assert.equal(roundTrip.tasks[0].notes, "First line\nSecond line");
assert.equal(roundTrip.tasks[1].status, "completed");
const work = parseMarkdown(
  serializeMarkdown({
    ...personal,
    id: "work",
    title: "Work",
    notes: "work only",
  }),
  "Work.md",
);
assert.equal(work.id, "work");
assert.equal(personal.notes, "Personal note\nnext line");
assert.equal(work.notes, "work only");
console.log("markdown tests passed");

const rich = parseMarkdown(`---
type: northstar-profile
id: personal
title: Personal
owner: "me"
---

## Tasks

\`\`\`yaml
- id: inbox
  title: "Inbox #1: <safe>"
  status: inbox
  importance: important
  dueDate: 2026-09-09
  tags: ["home", "today"]
  delegated: true
  customField: "keep me"
- id: waiting
  title: Waiting item
  status: waiting
  dueDate: 2026-10-10
\`\`\`

## Notes

\`\`\`text
One\nTwo
\`\`\``, "personal.md");
assert.equal(rich.tasks[0].status, "inbox");
assert.equal(rich.tasks[1].status, "waiting");
assert.deepEqual(rich.tasks[0].tags, ["home", "today"]);
assert.equal(rich.tasks[0].extra.customField, "keep me");
assert.equal(rich.tasks[0].urgency, "urgent");
const richRoundTrip = parseMarkdown(serializeMarkdown(rich), "personal.md");
assert.equal(richRoundTrip.tasks[0].extra.customField, "keep me");
assert.equal(richRoundTrip.frontmatter.owner, "me");

const noCanvas = parseMarkdown(serializeMarkdown({
  id: "personal", title: "Personal", notes: "", tasks: [{
    id: "unplaced", title: "Unplaced", status: "open", importance: "less-important",
    dueDate: null, notes: "", createdAt: "2026-09-09T00:00:00.000Z", updatedAt: "2026-09-09T00:00:00.000Z", canvas: null,
  }],
}), "personal.md");
assert.equal(noCanvas.tasks[0].canvas, null);

const combined = serializeWorkspaceMarkdown([personal, work]);
assert.match(combined, /type: luma-workspace/);
const combinedRoundTrip = parseWorkspaceMarkdown(combined, "luma.md");
assert.equal(combinedRoundTrip.profiles.length, 2);
assert.equal(combinedRoundTrip.profiles.find((profile) => profile.id === "personal").tasks[0].title, 'Call: "Maya" #1');
assert.equal(combinedRoundTrip.profiles.find((profile) => profile.id === "work").notes, "work only");
const legacyWorkspace = parseWorkspaceMarkdown(combined.replace("luma-workspace", "northstar-workspace"), "northstar.md");
assert.equal(legacyWorkspace.profiles.length, 2);

assert.doesNotThrow(() => parseMarkdown(canonical, "within-limits.md"));
assert.throws(
  () => parseMarkdown(`## Notes\n\n\`\`\`text\n${"x".repeat(LIMITS.MAX_LINE_LENGTH + 1)}\n\`\`\``, "long-line.md"),
  /line limit/,
);
assert.throws(
  () => parseMarkdown(`## Tasks\n\n\`\`\`yaml\n- id: one\n  title: "${"x".repeat(LIMITS.MAX_TITLE_LENGTH + 1)}"\n\`\`\``, "long-title.md"),
  /Task title/,
);
const longNotes = Array.from({ length: Math.ceil((LIMITS.MAX_NOTE_LENGTH + 1) / 1000) }, () => "x".repeat(1000)).join("\n    ");
assert.throws(
  () => parseMarkdown(`## Tasks\n\n\`\`\`yaml\n- id: one\n  title: okay\n  notes: |\n    ${longNotes}\n\`\`\``, "long-notes.md"),
  /Task notes/,
);
const tooManyTasks = Array.from({ length: LIMITS.MAX_TASKS + 1 }, (_, index) => `- id: task-${index}\n  title: Task ${index}`).join("\n");
assert.throws(
  () => parseMarkdown(`## Tasks\n\n\`\`\`yaml\n${tooManyTasks}\n\`\`\``, "too-many.md"),
  /task limit/,
);
