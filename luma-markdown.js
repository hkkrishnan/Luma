/* Dependency-free Markdown/YAML subset for Luma profile files. */
(function (global) {
  "use strict";
  const ACTIVE_STATUSES = new Set(["inbox", "open", "in-progress", "waiting"]);
  const CLOSED_STATUSES = new Set(["completed", "cancelled", "deleted"]);
  const KNOWN_TASK_FIELDS = new Set(["id", "title", "status", "importance", "urgency", "dueDate", "due", "notes", "createdAt", "updatedAt", "completedAt", "deletedAt", "canvas", "project", "tags", "delegated", "recurrence", "extra"]);
  // These limits protect the client-only parser from accidental or hostile imports.
  const LIMITS = Object.freeze({ MAX_TASKS: 1000, MAX_LINE_LENGTH: 20000, MAX_TITLE_LENGTH: 500, MAX_NOTE_LENGTH: 100000, MAX_IMPORT_HISTORY: 10 });
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
  function assertSourceLimits(source) {
    for (const line of String(source || "").replace(/\r/g, "").split("\n")) {
      if (line.length > LIMITS.MAX_LINE_LENGTH) throw new Error(`Markdown import exceeds the ${LIMITS.MAX_LINE_LENGTH.toLocaleString()}-character line limit.`);
    }
  }
  function assertLength(value, limit, label) {
    if (String(value || "").length > limit) throw new Error(`${label} exceeds the ${limit.toLocaleString()}-character limit.`);
  }
  function parseTasks(source) {
    const tasks = [];
    let task = null, nested = null, block = null;
    const push = () => {
      if (task && Object.keys(task).length) {
        if (tasks.length >= LIMITS.MAX_TASKS) throw new Error(`Markdown import exceeds the ${LIMITS.MAX_TASKS.toLocaleString()}-task limit.`);
        tasks.push(task);
      }
      task = null; nested = null; block = null;
    };
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
  function assertWorkspaceTaskCount(profiles) {
    const count = profiles.reduce((total, profile) => total + (profile.tasks?.length || 0), 0);
    if (count > LIMITS.MAX_TASKS) throw new Error(`Markdown import exceeds the ${LIMITS.MAX_TASKS.toLocaleString()}-task limit.`);
  }
  const normalizedStatus = (value) => {
    const status = String(value || "open").toLowerCase().replace(/\s+/g, "-");
    return ACTIVE_STATUSES.has(status) || CLOSED_STATUSES.has(status) ? status : "open";
  };
  function normalizeImportHistory(entries) {
    if (!Array.isArray(entries)) return [];
    return entries.map((entry) => ({
      importedAt: String(entry?.importedAt || ""),
      fileName: String(entry?.fileName || "Markdown import").replace(/[\r\n|]/g, " "),
      mode: entry?.mode === "replace" ? "replace" : "add",
      contentHash: String(entry?.contentHash || ""),
      found: Math.max(0, Number(entry?.found) || 0),
      added: Math.max(0, Number(entry?.added) || 0),
      skippedDuplicates: Math.max(0, Number(entry?.skippedDuplicates) || 0),
    })).filter((entry) => entry.importedAt && entry.contentHash)
      .sort((a, b) => new Date(b.importedAt) - new Date(a.importedAt))
      .slice(0, LIMITS.MAX_IMPORT_HISTORY);
  }
  function normalizeTask(raw, index, warnings = [], seen = new Set()) {
    const created = raw.createdAt || now();
    let id = raw.id ? String(raw.id) : newId();
    if (!raw.id) warnings.push(`Task ${index + 1} had no id; a new id was created.`);
    if (seen.has(id)) { id = newId(); warnings.push(`Duplicate task id “${raw.id}” was replaced for task ${index + 1}.`); }
    seen.add(id);
    const title = raw.title == null || raw.title === "" ? `Recovered task ${index + 1}` : String(raw.title);
    const notes = raw.notes == null ? "" : String(raw.notes);
    assertLength(title, LIMITS.MAX_TITLE_LENGTH, "Task title");
    assertLength(notes, LIMITS.MAX_NOTE_LENGTH, "Task notes");
    const dueDate = isIsoDate(raw.dueDate || raw.due) ? String(raw.dueDate || raw.due) : null;
    if ((raw.dueDate || raw.due) && !dueDate) warnings.push(`Task “${raw.title || id}” has an invalid due date.`);
    const canvas = raw.canvas && Number.isFinite(Number(raw.canvas.x)) && Number.isFinite(Number(raw.canvas.y)) ? { x: Number(raw.canvas.x), y: Number(raw.canvas.y) } : null;
    const extra = { ...(raw.extra && typeof raw.extra === "object" ? raw.extra : {}), ...Object.fromEntries(Object.entries(raw).filter(([key]) => !KNOWN_TASK_FIELDS.has(key))) };
    return {
      id, title,
      status: normalizedStatus(raw.status), importance: raw.importance === "important" ? "important" : "less-important",
      urgency: urgencyFor(dueDate), dueDate, notes,
      project: raw.project == null ? null : String(raw.project), tags: Array.isArray(raw.tags) ? raw.tags.map(String) : raw.tags ? [String(raw.tags)] : [],
      delegated: raw.delegated === true || raw.delegated === "true", recurrence: raw.recurrence == null ? null : String(raw.recurrence),
      createdAt: created, updatedAt: raw.updatedAt || created, completedAt: raw.completedAt || null, deletedAt: raw.deletedAt || null, canvas, extra,
    };
  }
  const workspaceIdentity = (workspace) => String(workspace.id || workspace.title || "").trim().toLowerCase() === "work" ? "work" : "personal";
  function normalizeWorkspace(workspace, warnings = []) {
    const id = workspaceIdentity(workspace), seen = new Set();
    const notes = workspace.notes == null ? "" : String(workspace.notes);
    assertLength(notes, LIMITS.MAX_NOTE_LENGTH, "Workspace notes");
    return {
      id, title: id === "work" ? "Work" : "Personal", tasks: (workspace.tasks || []).map((task, index) => normalizeTask(task, index, warnings, seen)),
      notes, fileName: workspace.fileName || `${id}.md`,
      handle: workspace.handle || null, revision: workspace.revision || null, dirty: Boolean(workspace.dirty), warnings, frontmatter: workspace.frontmatter || {},
      importHistory: normalizeImportHistory(workspace.importHistory),
    };
  }
  function parseMarkdown(text, fileName = "luma.md") {
    assertSourceLimits(text);
    const warnings = [], meta = frontmatter(text);
    const title = meta.title || (/^work(?:\.|$)/i.test(fileName) ? "Work" : "Personal");
    const workspace = normalizeWorkspace({ id: meta.id || title, title, tasks: parseTasks(section("Tasks", text)), notes: section("Notes", text), fileName, frontmatter: meta }, warnings);
    if (meta.type && !["luma-profile", "northstar-profile", "cluster-profile"].includes(meta.type)) warnings.push("This file does not declare a Luma profile type.");
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
      "---", "type: luma-profile", "version: 1", `id: ${quote(w.id)}`, `title: ${quote(w.title)}`,
      ...meta.map(([key, value]) => `${key}: ${typeof value === "string" ? quote(value) : JSON.stringify(value)}`),
      "---", "", `# ${w.title}`, "", "## Tasks", "", "```yaml", tasks || "[]", "```", "", "## Notes", "", "```text", w.notes, "```", "",
    ].join("\n");
  }
  const subSection = (name, text) => new RegExp(`^###\\s+${name}\\s*\\n\\s*(?:\`\`\`(?:yaml|text)?\\n)?([\\s\\S]*?)(?:\\n\`\`\`|(?=^###\\s)|(?![\\s\\S]))`, "im").exec(text)?.[1]?.replace(/\n$/, "") ?? "";
  function parseImportHistory(source) {
    const entries = [];
    for (const line of String(source || "").split(/\r?\n/)) {
      const match = line.match(/^-\s+(.+?)\s+\|\s+(add|replace)\s+\|\s+(.+?)\s+\|\s+found\s+(\d+)\s+\|\s+added\s+(\d+)\s+\|\s+skipped duplicates\s+(\d+)\s+\|\s+(.+)$/i);
      if (!match) continue;
      entries.push({ importedAt: match[1], mode: match[2].toLowerCase(), fileName: match[3], found: Number(match[4]), added: Number(match[5]), skippedDuplicates: Number(match[6]), contentHash: match[7] });
    }
    return normalizeImportHistory(entries);
  }
  function serializeImportHistory(entries) {
    return normalizeImportHistory(entries).map((entry) => `- ${entry.importedAt} | ${entry.mode} | ${entry.fileName} | found ${entry.found} | added ${entry.added} | skipped duplicates ${entry.skippedDuplicates} | ${entry.contentHash}`).join("\n");
  }
  function parseWorkspaceMarkdown(text, fileName = "luma.md") {
    assertSourceLimits(text);
    const meta = frontmatter(text), warnings = [];
    if (!["luma-workspace", "northstar-workspace"].includes(meta.type)) {
      const legacy = parseMarkdown(text, fileName);
      warnings.push("Imported a legacy single-profile file. Save it to migrate to one Luma workspace file.");
      return { profiles: [legacy], warnings, legacy: true };
    }
    const profiles = [];
    const matcher = /^##\s+Profile:\s*(Personal|Work)\s*\n([\s\S]*?)(?=^##\s+Profile:|(?![\s\S]))/gim;
    for (const match of text.matchAll(matcher)) {
      const title = match[1][0].toUpperCase() + match[1].slice(1).toLowerCase();
      const profileWarnings = [];
      profiles.push(normalizeWorkspace({ id: title, title, tasks: parseTasks(subSection("Tasks", match[2])), notes: subSection("Notes", match[2]), importHistory: parseImportHistory(subSection("Import history", match[2])), fileName }, profileWarnings));
      warnings.push(...profileWarnings);
    }
    assertWorkspaceTaskCount(profiles);
    if (!profiles.length) warnings.push("No Personal or Work profiles were found in this workspace file.");
    return { profiles, warnings, legacy: false };
  }
  function parseTaskImportMarkdown(text) {
    assertSourceLimits(text);
    const tasks = [], seen = new Set();
    let current = null;
    const finish = () => {
      if (!current) return;
      const source = current.fields.source;
      const notes = [current.fields.description, ...current.notes].filter(Boolean).join("\n").trim();
      const withSource = source ? [notes, `Source: ${source}`].filter(Boolean).join("\n") : notes;
      const priority = String(current.fields.priority || "").toLowerCase();
      const dueDate = isIsoDate(current.fields.due) ? current.fields.due : null;
      // Luma only has Important and Not important. Its canvas has no
      // "not urgent + not important" quadrant, so non-urgent work belongs in
      // Important regardless of the source file's high/medium/low wording.
      const importance = urgencyFor(dueDate) === "not-urgent"
        ? "important"
        : priority === "high" ? "important" : "less-important";
      tasks.push(normalizeTask({
        title: current.title,
        status: current.completed ? "completed" : "open",
        completedAt: current.completed ? now() : null,
        importance,
        dueDate,
        notes: withSource,
        project: current.fields.project && !/^unknown$/i.test(current.fields.project) ? current.fields.project : null,
        source: source || undefined,
      }, tasks.length, [], seen));
      current = null;
    };
    for (const raw of String(text || "").replace(/\r/g, "").split("\n")) {
      const item = raw.match(/^\s*[-*+]\s*\[([ xX])\]\s+(.+?)\s*$/);
      if (item) { finish(); current = { title: item[2], completed: item[1].toLowerCase() === "x", fields: {}, notes: [] }; continue; }
      if (!current) continue;
      const field = raw.match(/^\s{2,}[-*+]?\s*(description|due|priority|project|source)\s*:\s*(.*?)\s*$/i);
      if (field) { current.fields[field[1].toLowerCase()] = field[2]; continue; }
      if (/^\s{2,}\S/.test(raw)) current.notes.push(raw.replace(/^\s{2,}[-*+]?\s?/, "").trim());
    }
    finish();
    if (!tasks.length) throw new Error("No Markdown checklist tasks were found. Add items such as “- [ ] Task title”.");
    if (tasks.length > LIMITS.MAX_TASKS) throw new Error(`Markdown import exceeds the ${LIMITS.MAX_TASKS.toLocaleString()}-task limit.`);
    return tasks;
  }
  function serializeWorkspaceMarkdown(workspaces) {
    const profiles = workspaces.map((workspace) => normalizeWorkspace(workspace));
    const contents = profiles.map((profile) => {
      const source = serializeMarkdown(profile);
      const history = serializeImportHistory(profile.importHistory);
      return `## Profile: ${profile.title}\n\n### Tasks\n\n\`\`\`yaml\n${section("Tasks", source) || "[]"}\n\`\`\`\n\n### Notes\n\n\`\`\`text\n${section("Notes", source)}\n\`\`\`${history ? `\n\n### Import history\n\n\`\`\`text\n${history}\n\`\`\`` : ""}`;
    });
    return ["---", "type: luma-workspace", "version: 1", "title: Luma", "---", "", "# Luma", "", ...contents, ""].join("\n");
  }
  const api = { ACTIVE_STATUSES, CLOSED_STATUSES, LIMITS, isIsoDate, urgencyFor, parseMarkdown, parseTaskImportMarkdown, serializeMarkdown, parseWorkspaceMarkdown, serializeWorkspaceMarkdown, normalizeWorkspace, normalizeTask, normalizeImportHistory, localDate };
  global.LumaMarkdown = api;
  // Compatibility for pages already open before the rename.
  global.NorthstarMarkdown = api;
  if (typeof module !== "undefined") module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
