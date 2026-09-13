/* Dependency-free Markdown/YAML subset for NorthStar Lite profile files. */
(function (global) {
  "use strict";
  const ACTIVE_STATUSES = new Set(["inbox", "open", "in-progress", "waiting"]);
  const CLOSED_STATUSES = new Set(["completed", "cancelled", "deleted"]);
  const KNOWN_TASK_FIELDS = new Set(["id", "title", "status", "importance", "urgency", "dueDate", "due", "notes", "createdAt", "updatedAt", "completedAt", "deletedAt", "canvas", "project", "tags", "delegated", "recurrence", "extra"]);
  const now = () => new Date().toISOString();
  const newId = () => global.crypto?.randomUUID?.() || `task-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const quote = (value) => JSON.stringify(String(value ?? ""));
  const unquote = (value) => {
    value = String(value ?? "").trim();
    if (!value || value === "null" || value === "~") return null;
    if ((value[0] === '"' && value.at(-1) === '"') || (value[0] === "'" && value.at(-1) === "'")) {
      try { return value[0] === '"' ? JSON.parse(value) : value.slice(1, -1).replace(/''/g, "'"); } catch { return value.slice(1, -1); }
    }
    if (/^(true|false)$/i.test(value)) return value.toLowerCase() === "true";
    if (/^-?\d+(?:\.\d+)?$/.test(value)) return Number(value);
    if (/^\[.*\]$/.test(value)) {
      try { return JSON.parse(value); } catch { return value.slice(1, -1).split(",").map((item) => unquote(item)).filter((item) => item != null); }
    }
    return value;
  };
  const localDate = (date = new Date()) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  const isIsoDate = (value) => /^\d{4}-\d{2}-\d{2}$/.test(String(value || "")) && !Number.isNaN(new Date(`${value}T12:00:00`).getTime());
  const urgencyFor = (dueDate, currentDate = localDate()) => {
    if (!isIsoDate(dueDate)) return "not-urgent";
    return Math.round((new Date(`${dueDate}T12:00:00`) - new Date(`${currentDate}T12:00:00`)) / 86400000) <= 7 ? "urgent" : "not-urgent";
  };
  const section = (name, text) => new RegExp(`^##\\s+${name}\\s*\\n\\s*(?:\`\`\`(?:yaml|text)?\\n)?([\\s\\S]*?)(?:\\n\`\`\`|(?=^##\\s)|(?![\\s\\S]))`, "im").exec(text)?.[1]?.replace(/\n$/, "") ?? "";
  const frontmatter = (text) => {
    const data = {};
    const raw = /^---\s*\n([\s\S]*?)\n---/m.exec(text)?.[1] || "";
    raw.split(/\r?\n/).forEach((line) => {
      const match = line.match(/^([^:#][^:]*):\s*(.*)$/);
      if (match) data[match[1].trim()] = unquote(match[2]);
    });
    return data;
  };
  function parseTasks(source) {
    const tasks = [];
    let task = null, nested = null, block = null;
    const push = () => { if (task && Object.keys(task).length) tasks.push(task); task = null; nested = null; block = null; };
    for (const line of source.replace(/\r/g, "").split("\n")) {
      const item = line.match(/^\s*-\s+id:\s*(.*)$/);
      if (item) { push(); task = { id: unquote(item[1]) }; continue; }
      if (!task || /^\s*(#|\[\])\s*$/.test(line)) continue;
      const field = line.match(/^(\s*)([A-Za-z][\w-]*):\s*(.*)$/);
      if (!field) {
        if (block && /^\s{2,}/.test(line)) task[block] += `${task[block] ? "\n" : ""}${line.replace(/^\s{2,}/, "")}`;
        continue;
      }
      const [, indent, key, raw] = field;
      if (key === "id" && task.id) { push(); task = { id: unquote(raw) }; continue; }
      if (raw === "|" || raw === "|-") { task[key] = ""; block = key; nested = null; continue; }
      block = null;
      if (!raw) {
        if (key === "canvas") { task.canvas = {}; nested = "canvas"; } else task[key] = null;
      } else if (nested === "canvas" && /^(x|y)$/.test(key) && indent.length >= 2) task.canvas[key] = Number(unquote(raw));
      else task[key] = unquote(raw);
    }
    push();
    return tasks;
  }
  const normalizedStatus = (value) => {
    const status = String(value || "open").toLowerCase().replace(/\s+/g, "-");
    return ACTIVE_STATUSES.has(status) || CLOSED_STATUSES.has(status) ? status : "open";
  };
  function normalizeTask(raw, index, warnings = [], seen = new Set()) {
    const created = raw.createdAt || now();
    let id = raw.id ? String(raw.id) : newId();
    if (!raw.id) warnings.push(`Task ${index + 1} had no id; a new id was created.`);
    if (seen.has(id)) { id = newId(); warnings.push(`Duplicate task id “${raw.id}” was replaced for task ${index + 1}.`); }
    seen.add(id);
    const dueDate = isIsoDate(raw.dueDate || raw.due) ? String(raw.dueDate || raw.due) : null;
    if ((raw.dueDate || raw.due) && !dueDate) warnings.push(`Task “${raw.title || id}” has an invalid due date.`);
    const canvas = raw.canvas && Number.isFinite(Number(raw.canvas.x)) && Number.isFinite(Number(raw.canvas.y)) ? { x: Number(raw.canvas.x), y: Number(raw.canvas.y) } : null;
    const extra = { ...(raw.extra && typeof raw.extra === "object" ? raw.extra : {}), ...Object.fromEntries(Object.entries(raw).filter(([key]) => !KNOWN_TASK_FIELDS.has(key))) };
    return {
      id, title: raw.title == null || raw.title === "" ? `Recovered task ${index + 1}` : String(raw.title),
      status: normalizedStatus(raw.status), importance: raw.importance === "important" ? "important" : "less-important",
      urgency: urgencyFor(dueDate), dueDate, notes: raw.notes == null ? "" : String(raw.notes),
      project: raw.project == null ? null : String(raw.project), tags: Array.isArray(raw.tags) ? raw.tags.map(String) : raw.tags ? [String(raw.tags)] : [],
      delegated: raw.delegated === true || raw.delegated === "true", recurrence: raw.recurrence == null ? null : String(raw.recurrence),
      createdAt: created, updatedAt: raw.updatedAt || created, completedAt: raw.completedAt || null, deletedAt: raw.deletedAt || null, canvas, extra,
    };
  }
  const workspaceIdentity = (workspace) => String(workspace.id || workspace.title || "").trim().toLowerCase() === "work" ? "work" : "personal";
  function normalizeWorkspace(workspace, warnings = []) {
    const id = workspaceIdentity(workspace), seen = new Set();
    return {
      id, title: id === "work" ? "Work" : "Personal", tasks: (workspace.tasks || []).map((task, index) => normalizeTask(task, index, warnings, seen)),
      notes: workspace.notes == null ? "" : String(workspace.notes), fileName: workspace.fileName || `${id}.md`,
      handle: workspace.handle || null, revision: workspace.revision || null, dirty: Boolean(workspace.dirty), warnings, frontmatter: workspace.frontmatter || {},
    };
  }
  function parseMarkdown(text, fileName = "northstar.md") {
    const warnings = [], meta = frontmatter(text);
    const title = meta.title || (/^work(?:\.|$)/i.test(fileName) ? "Work" : "Personal");
    const workspace = normalizeWorkspace({ id: meta.id || title, title, tasks: parseTasks(section("Tasks", text)), notes: section("Notes", text), fileName, frontmatter: meta }, warnings);
    if (meta.type && meta.type !== "northstar-profile" && meta.type !== "cluster-profile") warnings.push("This file does not declare a NorthStar profile type.");
    return workspace;
  }
  function line(key, value, indent = "  ") {
    if (value == null || value === "") return `${indent}${key}:`;
    if (Array.isArray(value)) return `${indent}${key}: ${JSON.stringify(value)}`;
    if (typeof value === "boolean" || typeof value === "number") return `${indent}${key}: ${value}`;
    if (String(value).includes("\n")) return `${indent}${key}: |\n${String(value).split("\n").map((entry) => `${indent}  ${entry}`).join("\n")}`;
    return `${indent}${key}: ${quote(value)}`;
  }
  function serializeMarkdown(workspace) {
    const warnings = [], w = normalizeWorkspace(workspace, warnings);
    const tasks = w.tasks.map((task, index) => {
      const t = normalizeTask(task, index, warnings, new Set());
      const extras = Object.entries(t.extra || {}).filter(([key]) => /^[A-Za-z][\w-]*$/.test(key));
      return [
        `- id: ${quote(t.id)}`, line("title", t.title), line("status", t.status), line("importance", t.importance), line("urgency", urgencyFor(t.dueDate)),
        line("dueDate", t.dueDate), line("notes", t.notes), line("project", t.project), line("tags", t.tags), line("delegated", t.delegated), line("recurrence", t.recurrence),
        line("createdAt", t.createdAt), line("updatedAt", t.updatedAt), line("completedAt", t.completedAt), line("deletedAt", t.deletedAt),
        ...(t.canvas ? ["  canvas:", `    x: ${Math.round(t.canvas.x)}`, `    y: ${Math.round(t.canvas.y)}`] : []),
        ...extras.map(([key, value]) => line(key, value)),
      ].join("\n");
    }).join("\n");
    const meta = Object.entries(w.frontmatter || {}).filter(([key]) => !["type", "version", "id", "title"].includes(key) && /^[A-Za-z][\w-]*$/.test(key));
    return [
      "---", "type: northstar-profile", "version: 1", `id: ${quote(w.id)}`, `title: ${quote(w.title)}`,
      ...meta.map(([key, value]) => `${key}: ${typeof value === "string" ? quote(value) : JSON.stringify(value)}`),
      "---", "", `# ${w.title}`, "", "## Tasks", "", "```yaml", tasks || "[]", "```", "", "## Notes", "", "```text", w.notes, "```", "",
    ].join("\n");
  }
  const subSection = (name, text) => new RegExp(`^###\\s+${name}\\s*\\n\\s*(?:\`\`\`(?:yaml|text)?\\n)?([\\s\\S]*?)(?:\\n\`\`\`|(?=^###\\s)|(?![\\s\\S]))`, "im").exec(text)?.[1]?.replace(/\n$/, "") ?? "";
  function parseWorkspaceMarkdown(text, fileName = "northstar.md") {
    const meta = frontmatter(text), warnings = [];
    if (meta.type !== "northstar-workspace") {
      const legacy = parseMarkdown(text, fileName);
      warnings.push("Imported a legacy single-profile file. Save it to migrate to one NorthStar workspace file.");
      return { profiles: [legacy], warnings, legacy: true };
    }
    const profiles = [];
    const matcher = /^##\s+Profile:\s*(Personal|Work)\s*\n([\s\S]*?)(?=^##\s+Profile:|(?![\s\S]))/gim;
    for (const match of text.matchAll(matcher)) {
      const title = match[1][0].toUpperCase() + match[1].slice(1).toLowerCase();
      const profileWarnings = [];
      profiles.push(normalizeWorkspace({ id: title, title, tasks: parseTasks(subSection("Tasks", match[2])), notes: subSection("Notes", match[2]), fileName }, profileWarnings));
      warnings.push(...profileWarnings);
    }
    if (!profiles.length) warnings.push("No Personal or Work profiles were found in this workspace file.");
    return { profiles, warnings, legacy: false };
  }
  function serializeWorkspaceMarkdown(workspaces) {
    const profiles = workspaces.map((workspace) => normalizeWorkspace(workspace));
    const contents = profiles.map((profile) => {
      const source = serializeMarkdown(profile);
      return `## Profile: ${profile.title}\n\n### Tasks\n\n\`\`\`yaml\n${section("Tasks", source) || "[]"}\n\`\`\`\n\n### Notes\n\n\`\`\`text\n${section("Notes", source)}\n\`\`\``;
    });
    return ["---", "type: northstar-workspace", "version: 1", "title: NorthStar", "---", "", "# NorthStar", "", ...contents, ""].join("\n");
  }
  const api = { ACTIVE_STATUSES, CLOSED_STATUSES, isIsoDate, urgencyFor, parseMarkdown, serializeMarkdown, parseWorkspaceMarkdown, serializeWorkspaceMarkdown, normalizeWorkspace, normalizeTask, localDate };
  global.NorthstarMarkdown = api;
  if (typeof module !== "undefined") module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
