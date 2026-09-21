(() => {
  "use strict";
  // The application shell may work offline; user content is never cached or retained.
  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => navigator.serviceWorker.register("./sw.js").catch(() => {}));
  }
  const { parseWorkspaceMarkdown, parseTaskImportMarkdown, serializeWorkspaceMarkdown, normalizeWorkspace, normalizeImportHistory } =
    window.LumaMarkdown || window.NorthstarMarkdown;
  const MAX_IMPORT_BYTES = 5 * 1024 * 1024;
  const IMPORT_HISTORY_LIMIT = 10;
  const root = document.getElementById("root");
  const defaultPreferences = { backupName: "date" };
  const state = {
    workspaces: new Map(),
    activeId: null,
    search: false,
    query: "",
    selectedId: null,
    menuOpen: false,
    settingsOpen: false,
    historyOpen: false,
    conflict: null,
    editorNotesExpanded: null,
    taskImport: null,
    undo: null,
    notice: "",
    captureImportant: false,
    preferences: { ...defaultPreferences },
    file: { handle: null, fileName: "luma.md", revision: null },
    persistTimer: null,
  };
  const icon = (name) =>
    `<svg class="lite-icon" aria-hidden="true" viewBox="0 0 24 24">${
      ({
        plus: '<path d="M12 5v14M5 12h14"/>',
        search: '<circle cx="11" cy="11" r="6"/><path d="m16 16 4 4"/>',
        cloud:
          '<path d="M7 18h10a4 4 0 0 0 .4-8A6 6 0 0 0 6 9.5 4.3 4.3 0 0 0 7 18Z"/><path d="M12 8v7m-3-3 3 3 3-3"/>',
        more:
          '<circle cx="5" cy="12" r="1" fill="currentColor"/><circle cx="12" cy="12" r="1" fill="currentColor"/><circle cx="19" cy="12" r="1" fill="currentColor"/>',
        download: '<path d="M12 3v12m-4-4 4 4 4-4M5 21h14"/>',
        upload: '<path d="M12 15V3m-4 4 4-4 4 4M5 21h14"/>',
        restore: '<path d="M3 12a9 9 0 1 0 3-6.7M3 4v5h5"/>',
        settings:
          '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-2.1 2.1-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.5v.2h-3v-.2a1.7 1.7 0 0 0-1-1.5 1.7 1.7 0 0 0-1.9.3l-.1.1L6.6 17l.1-.1A1.7 1.7 0 0 0 7 15a1.7 1.7 0 0 0-1.5-1H5.3v-3h.2A1.7 1.7 0 0 0 7 10a1.7 1.7 0 0 0-.3-1.9L6.6 8 8.7 5.9l.1.1a1.7 1.7 0 0 0 1.9.3 1.7 1.7 0 0 0 1-1.5v-.2h3v.2a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.9-.3l.1-.1L19.8 8l-.1.1a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.5 1h.2v3h-.2a1.7 1.7 0 0 0-1.5 1Z"/>',
        file: '<path d="M6 3h8l4 4v14H6zM14 3v5h5M9 13h6M9 17h6"/>',
        close: '<path d="m6 6 12 12M18 6 6 18"/>',
        clear: '<path d="M6 7h12M10 7V5h4v2M8 7l1 12h6l1-12M11 11v4m2-4v4"/>',
      })[name]
    }</svg>`;
  const esc = (v) =>
    String(v ?? "").replace(
      /[&<>"']/g,
      (c) => ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      }[c]),
    );
  const today = () => new Date().toLocaleDateString("en-CA");
  const displayDate = (value) => {
    if (!value) return "Date unavailable";
    const date = new Date(value);
    return Number.isNaN(date.getTime())
      ? "Date unavailable"
      : date.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
  };
  const isoWeekCode = (value = new Date()) => {
    const date = new Date(Date.UTC(value.getFullYear(), value.getMonth(), value.getDate()));
    const day = date.getUTCDay() || 7;
    date.setUTCDate(date.getUTCDate() + 4 - day);
    const year = date.getUTCFullYear();
    const yearStart = new Date(Date.UTC(year, 0, 1));
    const week = Math.ceil((((date - yearStart) / 86400000) + 1) / 7);
    return `WK${String(year).slice(-2)}${String(week).padStart(2, "0")}`;
  };
  const backupFilename = () => state.preferences.backupName === "week"
    ? `luma-${isoWeekCode()}.md`
    : `luma-${today()}.md`;
  const noteHtml = (value) => esc(value)
    .replace(/\*\*([^*\n]+)\*\*/g, "<strong>$1</strong>")
    .replace(/\n/g, "<br>");
  const noteMarkdown = (editor) => {
    const text = (node) => {
      if (node.nodeType === Node.TEXT_NODE) return node.nodeValue || "";
      if (node.nodeType !== Node.ELEMENT_NODE) return "";
      if (node.tagName === "BR") return "\n";
      const contents = [...node.childNodes].map(text).join("");
      if (node.tagName === "STRONG" || node.tagName === "B") return `**${contents}**`;
      return node.tagName === "DIV" || node.tagName === "P" ? `${contents}\n` : contents;
    };
    return [...editor.childNodes].map(text).join("").replace(/\n{3,}/g, "\n\n").replace(/\n$/, "");
  };
  const active = () => state.workspaces.get(state.activeId);
  const profiles = () => [...state.workspaces.values()];
  const dirty = (w) => { w.dirty = true; queueLocalSave(); };
  const hash = async (text) => {
    if (crypto.subtle) {
      const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
      return [...new Uint8Array(bytes)].map((x) => x.toString(16).padStart(2, "0")).join("");
    }
    let value = 2166136261;
    for (const char of String(text)) value = Math.imul(value ^ char.charCodeAt(0), 16777619);
    return `fnv1a:${(value >>> 0).toString(16)}:${String(text).length}`;
  };
  const localDb = (() => {
    const DATABASE = "luma";
    const LEGACY_DATABASE = "northstar-lite";
    const open = (name) => new Promise((resolve, reject) => {
      if (!window.indexedDB) return reject(new Error("IndexedDB is unavailable."));
      const request = indexedDB.open(name, 1);
      request.onupgradeneeded = () => request.result.createObjectStore("workspace");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const readFrom = async (name) => {
      const db = await open(name);
      return new Promise((resolve, reject) => {
        const request = db.transaction("workspace").objectStore("workspace").get("current");
        request.onsuccess = () => resolve(request.result || null);
        request.onerror = () => reject(request.error);
      });
    };
    const writeTo = async (name, value) => {
      const db = await open(name);
      return new Promise((resolve, reject) => {
        const request = db.transaction("workspace", "readwrite").objectStore("workspace").put(value, "current");
        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
      });
    };
    const clearFrom = async (name) => {
      const db = await open(name);
      return new Promise((resolve, reject) => {
        const request = db.transaction("workspace", "readwrite").objectStore("workspace").delete("current");
        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
      });
    };
    const read = async () => {
      const current = await readFrom(DATABASE);
      if (current) return current;
      const legacy = await readFrom(LEGACY_DATABASE);
      if (legacy) await writeTo(DATABASE, legacy);
      return legacy;
    };
    const write = (value) => writeTo(DATABASE, value);
    const clear = async () => {
      await clearFrom(DATABASE);
      await clearFrom(LEGACY_DATABASE);
    };
    return { read, write, clear };
  })();
  function queueLocalSave() {
    clearTimeout(state.persistTimer);
    state.persistTimer = setTimeout(() => void persistLocal(), 150);
  }
  async function persistLocal() {
    if (!profiles().length) return;
    const snapshot = serializeWorkspaceMarkdown(profiles());
    const previous = await localDb.read().catch(() => null);
    const snapshots = [{ createdAt: new Date().toISOString(), markdown: snapshot }, ...(previous?.snapshots || [])]
      .filter((entry, index, entries) => index === 0 || entry.markdown !== entries[index - 1].markdown)
      .slice(0, 5);
    const record = {
      profiles: profiles().map((profile) => ({ ...profile, handle: null, revision: null })),
      activeId: state.activeId,
      file: state.file,
      preferences: state.preferences,
      savedAt: new Date().toISOString(),
      snapshots,
    };
    try {
      await localDb.write(record);
    } catch {
      // Some browsers cannot persist file handles. Retain the safe task copy anyway.
      await localDb.write({ ...record, file: { ...state.file, handle: null } }).catch(() => {});
    }
  }
  async function restoreLocal() {
    try {
      const record = await localDb.read();
      if (!record?.profiles?.length) return false;
      loadProfiles(record.profiles.map((profile) => normalizeWorkspace(profile)), record.file, record.activeId);
      state.preferences = { ...defaultPreferences, ...(record.preferences || {}) };
      if (!["date", "week"].includes(state.preferences.backupName)) state.preferences.backupName = "date";
      state.notice = state.file.handle
        ? `Restored your browser copy. Reconnect ${state.file.fileName} to check the latest Markdown.`
        : "Restored your browser copy. Import or reconnect Markdown when ready.";
      return true;
    } catch {
      return false;
    }
  }
  const blank = (id) =>
    normalizeWorkspace({
      id,
      title: id === "work" ? "Work" : "Personal",
      tasks: [],
      notes: "",
      fileName: "luma.md",
    });
  function addWorkspace(w) {
    const id = /work/i.test(`${w.id} ${w.title}`) ? "work" : "personal";
    w.id = id;
    w.title = id === "work" ? "Work" : "Personal";
    state.workspaces.set(id, w);
    if (!state.workspaces.has("personal")) {
      state.workspaces.set("personal", blank("personal"));
    }
    if (!state.workspaces.has("work")) {
      state.workspaces.set("work", blank("work"));
    }
    state.activeId = id;
  }
  function loadProfiles(items, file = state.file, activeId = "work") {
    const sourceIds = items.map((item) => /work/i.test(`${item.id} ${item.title}`) ? "work" : "personal");
    state.workspaces.clear();
    items.forEach((item) => {
      item.tasks.forEach(normalizeTaskPriority);
      addWorkspace(item);
    });
    if (!state.workspaces.has("personal")) state.workspaces.set("personal", blank("personal"));
    if (!state.workspaces.has("work")) state.workspaces.set("work", blank("work"));
    state.file = { handle: file?.handle || null, fileName: file?.fileName || "luma.md", revision: file?.revision || null };
    profiles().forEach((profile) => { profile.fileName = state.file.fileName; profile.handle = state.file.handle; profile.revision = state.file.revision; });
    state.activeId = sourceIds.includes(activeId)
      ? activeId
      : sourceIds.includes("work")
      ? "work"
      : sourceIds[0] || "work";
  }
  function due(d) {
    if (!d) return "";
    const n = new Date(`${d}T12:00:00`),
      diff = Math.round((n - new Date(`${today()}T12:00:00`)) / 86400000);
    return diff < 0
      ? "Overdue"
      : diff === 0
      ? "Today"
      : diff === 1
      ? "Tomorrow"
      : n.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  }
  function urgencyFor(d) {
    if (!d) return "not-urgent";
    const days = Math.round((new Date(`${d}T12:00:00`) - new Date(`${today()}T12:00:00`)) / 86400000);
    return days <= 7 ? "urgent" : "not-urgent";
  }
  const localDate = (date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  const monthNames = [
    /jan(?:uary)?/i, /feb(?:ruary)?/i, /mar(?:ch)?/i, /apr(?:il)?/i,
    /may/i, /jun(?:e)?/i, /jul(?:y)?/i, /aug(?:ust)?/i,
    /sept?(?:ember)?/i, /oct(?:ober)?/i, /nov(?:ember)?/i, /dec(?:ember)?/i,
  ];
  const weekdayPattern = "sun(?:day)?|mon(?:day)?|tue(?:sday|s)?|wed(?:nesday)?|thu(?:rsday|rs)?|fri(?:day)?|sat(?:urday)?";
  const weekdayIndex = { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 };
  function dateForWeekday(base, weekday, modifier = "") {
    const target = weekdayIndex[weekday.slice(0, 3).toLowerCase()];
    let offset = (target - base.getDay() + 7) % 7;
    if (modifier === "next") offset += 7;
    const candidate = new Date(base);
    candidate.setDate(candidate.getDate() + offset);
    return candidate;
  }
  function dateForNextMonday(base) {
    const candidate = new Date(base);
    candidate.setDate(candidate.getDate() + ((8 - candidate.getDay()) % 7 || 7));
    return candidate;
  }
  function parseDueDate(text) {
    const base = new Date(`${today()}T12:00:00`);
    const iso = text.match(/\b(\d{4}-\d{2}-\d{2})\b/);
    if (iso && !Number.isNaN(new Date(`${iso[1]}T12:00:00`).getTime())) return { dueDate: iso[1], token: iso[0] };
    const named = text.match(/\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sept?(?:ember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+(\d{1,2})(?:st|nd|rd|th)?(?:,?\s+(\d{4}))?\b/i);
    if (named) {
      const month = monthNames.findIndex((pattern) => pattern.test(named[1]));
      let year = named[3] ? Number(named[3]) : base.getFullYear();
      let candidate = new Date(year, month, Number(named[2]), 12);
      const valid = candidate.getMonth() === month && candidate.getDate() === Number(named[2]);
      if (valid) {
        if (!named[3] && candidate < base) candidate = new Date(++year, month, Number(named[2]), 12);
        return { dueDate: localDate(candidate), token: named[0] };
      }
    }
    const interval = text.match(/\b(?:in\s+)?(\d+)\s+(day|week)s?(?:\s+from\s+now)?\b/i);
    if (interval) {
      const candidate = new Date(base);
      candidate.setDate(candidate.getDate() + Number(interval[1]) * (interval[2].toLowerCase() === "week" ? 7 : 1));
      return { dueDate: localDate(candidate), token: interval[0] };
    }
    const simple = text.match(/\b(today|tomorrow|yesterday|next\s+week|next\s+month|end\s+of\s+(?:the\s+)?month|end\s+of\s+(?:the\s+)?week|(?:this|next)\s+weekend)\b/i);
    if (simple) {
      const token = simple[1].toLowerCase().replace(/\s+/g, " ");
      const candidate = new Date(base);
      if (token === "tomorrow") candidate.setDate(candidate.getDate() + 1);
      else if (token === "yesterday") candidate.setDate(candidate.getDate() - 1);
      else if (token === "next week") return { dueDate: localDate(dateForNextMonday(base)), token: simple[0] };
      else if (token === "next month") return { dueDate: localDate(new Date(base.getFullYear(), base.getMonth() + 1, 1, 12)), token: simple[0] };
      else if (token.includes("end of") && token.includes("month")) return { dueDate: localDate(new Date(base.getFullYear(), base.getMonth() + 1, 0, 12)), token: simple[0] };
      else if (token.includes("end of")) candidate.setDate(candidate.getDate() + ((7 - candidate.getDay()) % 7));
      else if (token.includes("weekend")) return { dueDate: localDate(dateForWeekday(base, "saturday", token.startsWith("next") ? "next" : "")), token: simple[0] };
      return { dueDate: localDate(candidate), token: simple[0] };
    }
    const weekday = text.match(new RegExp("\\b(?:(this|next)\\s+)?(" + weekdayPattern + ")\\b", "i"));
    if (weekday) return {
      dueDate: localDate(dateForWeekday(base, weekday[2], (weekday[1] || "").toLowerCase())),
      token: weekday[0],
    };
    return { dueDate: null, token: null };
  }
  function priorityFor(dueDate, importance = "less-important") {
    const urgency = urgencyFor(dueDate);
    // The canvas deliberately has no "not important + not urgent" state.
    return { urgency, importance: urgency === "not-urgent" ? "important" : importance };
  }
  function normalizeTaskPriority(task) {
    const priority = priorityFor(task.dueDate, task.importance);
    task.urgency = priority.urgency;
    task.importance = priority.importance;
    // Legacy free-form positions are intentionally discarded: the date determines X.
    task.canvas = null;
    return task;
  }
  function taskFingerprint(task) {
    const priority = priorityFor(task.dueDate, task.importance).importance;
    const normalize = (value) => String(value || "").trim().replace(/\s+/g, " ").toLocaleLowerCase();
    return JSON.stringify([
      normalize(task.title), normalize(task.notes), task.dueDate || "", priority,
      String(task.status || "open").toLowerCase(), normalize(task.project),
    ]);
  }
  function parseCapture(value) {
    const parsed = parseDueDate(value.trim());
    const title = parsed.token
      ? value.trim().replace(parsed.token, " ").replace(/\s+/g, " ").trim()
      : value.trim();
    return { title: title || value.trim(), dueDate: parsed.dueDate };
  }
  function dayOffset(date) {
    if (!date) return null;
    return Math.round(
      (new Date(`${date}T12:00:00`) - new Date(`${today()}T12:00:00`)) / 86400000,
    );
  }
  const TIMELINE_DAYS = 42;
  const TIMELINE_LEFT = 10;
  const URGENT_START = 56;
  const TIMELINE_TODAY = 76;
  const OVERDUE_X = 88;
  function timelineX(days) {
    if (days <= 7) return TIMELINE_TODAY - days * ((TIMELINE_TODAY - URGENT_START) / 7);
    return URGENT_START - Math.min(TIMELINE_DAYS, days - 7) *
      ((URGENT_START - TIMELINE_LEFT) / (TIMELINE_DAYS - 7));
  }
  function timeline() {
    const base = new Date(`${today()}T12:00:00`);
    // Later work stays legible with weekly dates; the urgent week gets more room.
    const offsets = [42, 35, 28, 21, 14, 7, 3, 0];
    const ticks = offsets.map((offset) => {
      const d = new Date(base);
      d.setDate(base.getDate() + offset);
      return {
        offset,
        // The far-left boundary groups dates outside the visible six-week window.
        label: offset === TIMELINE_DAYS ? "Later" : d.toLocaleDateString(undefined, { month: "short", day: "numeric" }),
        x: timelineX(offset),
        showLabel: true,
      };
    });
    return [...ticks, { label: "Overdue", x: OVERDUE_X, showLabel: true }];
  }
  function quadrant(t) {
    const priority = priorityFor(t.dueDate, t.importance);
    return priority.importance === "important"
      ? (priority.urgency === "urgent" ? "do-first" : "schedule")
      : "reconsider";
  }
  function position(t, i) {
    if (!t.dueDate) return { x: TIMELINE_LEFT, y: 22 + (i % 4) * 7 };
    const days = dayOffset(t.dueDate);
    // A stable six-week scale keeps Personal and Work visually comparable.
    const x = days < 0
      ? OVERDUE_X
      : timelineX(days);
    return { x, y: priorityFor(t.dueDate, t.importance).importance === "important" ? 22 : 66 };
  }
  function notice(m) {
    state.notice = m;
    render();
  }
  async function importFile(file, handle = null) {
    try {
      if (!file || file.size > MAX_IMPORT_BYTES) {
        throw new Error("This file is larger than the 5 MiB import limit. Choose a smaller Markdown file.");
      }
      const text = await file.text();
      const parsed = parseWorkspaceMarkdown(text, file.name);
      loadProfiles(parsed.profiles, { handle, fileName: file.name || "luma.md", revision: await hash(text) }, state.activeId || "work");
      state.selectedId = null;
      state.notice = parsed.warnings.join(" ") || "Opened one Luma workspace file.";
      queueLocalSave();
      render();
    } catch (e) {
      notice(`Could not read Markdown: ${e.message}`);
    }
  }
  async function importTasksFile(file) {
    try {
      if (!file || file.size > MAX_IMPORT_BYTES) throw new Error("This file is larger than the 5 MiB import limit. Choose a smaller Markdown file.");
      const text = await file.text();
      const tasks = parseTaskImportMarkdown(text);
      const workspace = active();
      if (!workspace) throw new Error("Open a workspace before importing tasks.");
      const contentHash = await hash(text);
      const exactFile = (workspace.importHistory || []).some((entry) => entry.contentHash === contentHash);
      const existing = new Set(workspace.tasks.map(taskFingerprint));
      const reviewed = tasks.map((task) => {
        const normalized = normalizeTaskPriority(task);
        const taskDuplicate = existing.has(taskFingerprint(normalized));
        return {
          ...normalized,
          duplicate: exactFile ? "file" : taskDuplicate ? "task" : null,
          selected: !(exactFile || taskDuplicate),
        };
      });
      state.taskImport = {
        mode: "add", tasks: reviewed,
        fileName: file.name || "Markdown import",
        contentHash,
        exactFile,
        duplicateCount: reviewed.filter((task) => task.duplicate).length,
      };
      state.menuOpen = false;
      render();
    } catch (e) { notice(`Could not import tasks: ${e.message}`); }
  }
  function recordImportHistory(workspace, review, imported) {
    const importedIds = new Set(imported.map((task) => task.id));
    const skippedDuplicates = review.tasks.filter((task) => task.duplicate && !importedIds.has(task.id)).length;
    const entry = {
      importedAt: new Date().toISOString(), fileName: review.fileName,
      mode: review.mode, contentHash: review.contentHash, found: review.tasks.length,
      added: imported.length, skippedDuplicates,
    };
    workspace.importHistory = normalizeImportHistory([entry, ...(workspace.importHistory || [])]).slice(0, IMPORT_HISTORY_LIMIT);
  }
  function picker(direct = false) {
    if (profiles().some((profile) => profile.dirty) &&
      !window.confirm("Open another Markdown workspace? Unsaved browser changes will be replaced. Save first if you want to keep them.")) {
      return;
    }
    if (direct && window.showOpenFilePicker) {
      window.showOpenFilePicker({
        types: [{
          description: "Markdown",
          accept: {
            "text/markdown": [".md", ".markdown"],
            "text/plain": [".txt"],
          },
        }],
      }).then(([h]) => h.getFile().then((f) => importFile(f, h)))
        .catch((e) => {
          if (e.name !== "AbortError") {
            notice(`Could not open Markdown: ${e.message}`);
          }
        });
      return;
    }
    const input = document.getElementById("markdown-file");
    input.value = "";
    input.click();
  }
  async function reconnect() {
    if (!state.file.handle) return picker(true);
    try {
      const permission = await state.file.handle.requestPermission({ mode: "readwrite" });
      if (permission !== "granted") return notice("File permission was not granted. Your browser copy is still safe.");
      const file = await state.file.handle.getFile();
      await importFile(file, state.file.handle);
    } catch (e) {
      notice(`Could not reconnect Markdown: ${e.message}`);
    }
  }
  async function save(download = false) {
    const text = serializeWorkspaceMarkdown(profiles());
    try {
      if (state.file.handle && !download) {
        const before = await state.file.handle.getFile();
        const external = await before.text();
        if (state.file.revision && await hash(external) !== state.file.revision) {
          state.conflict = { text: external, name: before.name || state.file.fileName };
          state.notice = "The Markdown file changed outside Luma. Choose Reload file or Download current changes.";
          render();
          return;
        }
        const out = await state.file.handle.createWritable();
        await out.write(text);
        await out.close();
        const verified = await (await state.file.handle.getFile()).text();
        if (verified !== text) throw new Error("The browser could not verify the saved file.");
        state.file.revision = await hash(verified);
        profiles().forEach((profile) => { profile.revision = state.file.revision; profile.dirty = false; });
        state.notice = "Saved to the opened Markdown file.";
      } else {
        const a = document.createElement("a");
        a.href = URL.createObjectURL(
          new Blob([text], { type: "text/markdown;charset=utf-8" }),
        );
        a.download = backupFilename();
        a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 500);
        profiles().forEach((profile) => profile.dirty = false);
        state.notice = "Downloaded an updated Markdown copy.";
      }
      queueLocalSave();
      render();
    } catch (e) {
      notice(`Could not save Markdown: ${e.message}`);
    }
  }
  function update(t, changes) {
    Object.assign(t, changes);
    normalizeTaskPriority(t);
    Object.assign(t, { updatedAt: new Date().toISOString() });
    dirty(active());
  }
  async function clearBrowserWorkspace() {
    if (!window.confirm("Clear this browser's Luma workspace? This removes only the local recovery copy. Your Markdown file will not be changed.")) {
      return;
    }
    try {
      clearTimeout(state.persistTimer);
      await localDb.clear();
      state.workspaces.clear();
      state.activeId = null;
      state.selectedId = null;
      state.undo = null;
      state.menuOpen = false;
      state.file = { handle: null, fileName: "luma.md", revision: null };
      state.notice = "Cleared this browser's Luma workspace. Your Markdown files were not changed.";
      render();
    } catch (e) {
      notice(`Could not clear this browser workspace: ${e.message}`);
    }
  }
  function menu(w) {
    const undo = state.undo?.workspaceId === w.id;
    return `<div class="lite-menu" ${
      state.menuOpen ? "" : "hidden"
    } role="menu"><div class="lite-menu-section">Workspace</div><button class="lite-menu-item" data-action="import-tasks">${
      icon("upload")
    }Import</button><button class="lite-menu-item" data-action="open-workspace">${
      icon("upload")
    }Open</button><button class="lite-menu-item" data-action="history">${
      icon("restore")
    }History</button>${
      undo
        ? `<div class="lite-menu-separator"></div><button class="lite-menu-item" data-action="undo">${
          icon("restore")
        }Undo ${state.undo.kind}</button>`
        : ""
    }<button class="lite-menu-item lite-menu-danger" data-action="clear-browser">${
      icon("clear")
    }Clear browser copy</button><div class="lite-menu-separator"></div><div class="lite-menu-section">Settings</div><button class="lite-menu-item" data-action="settings">${
      icon("settings")
    }Settings</button></div>`;
  }
  function history(w) {
    const entries = w.tasks.filter((t) => ["completed", "cancelled", "deleted"].includes(t.status))
      .map((t) => ({
        task: t,
        event: t.status === "completed" ? "Completed" : "Removed",
        at: t.status === "completed" ? t.completedAt : t.deletedAt || t.updatedAt || t.createdAt,
      }))
      .sort((a, b) => new Date(b.at || 0) - new Date(a.at || 0));
    return `<div class="lite-history" ${state.historyOpen ? "" : "hidden"}><section class="lite-history-card" role="dialog" aria-modal="true"><div class="lite-settings-header"><h2>${esc(w.title)} history</h2><button data-action="close-history" aria-label="Close history">${icon("close")}</button></div><div class="lite-history-list">${entries.map(({ task, event, at }) => `<p title="${esc(task.title)}">${esc(task.title)}<span> · ${event} · ${displayDate(at)}</span></p>`).join("") || "<p>No completed or removed tasks yet.</p>"}</div></section></div>`;
  }
  function settingsPanel() {
    const name = state.preferences.backupName;
    const importCount = active()?.importHistory?.length || 0;
    return `<div class="lite-settings" ${state.settingsOpen ? "" : "hidden"}><section class="lite-settings-card" role="dialog" aria-modal="true"><div class="lite-settings-header"><h2>Settings</h2><button data-action="close-settings" aria-label="Close settings">${icon("close")}</button></div><p>Luma saves a private recovery copy in this browser. Save to Markdown when you want to update your file.</p><label class="lite-settings-label">Backup filename<select data-setting="backup-name"><option value="date" ${name === "date" ? "selected" : ""}>Current date</option><option value="week" ${name === "week" ? "selected" : ""}>Week number</option></select></label><p class="lite-settings-hint">Downloads use ${esc(backupFilename())}.</p><div class="lite-privacy-notice"><h3>Privacy & local data</h3><p>Your tasks and notes stay in this browser or in the Markdown file you choose. Luma does not send workspace content to a server.</p></div><div class="lite-import-history-setting"><p>${importCount} of ${IMPORT_HISTORY_LIMIT} local import-history entries retained for this workspace. Downloads include the same entries.</p><button class="lite-reset-layout" data-action="clear-import-history" ${importCount ? "" : "disabled"}>Clear import history</button></div><button class="lite-reset-layout" data-action="reset-layout">Reset current layout</button></section></div>`;
  }
  function taskImportReview() {
    const review = state.taskImport;
    if (!review) return "";
    const selected = review.tasks.filter((task) => task.selected).length;
    const importedTasks = review.tasks.map((task, index) => {
      const urgency = urgencyFor(task.dueDate);
      const importanceChoices = `<option value="important" ${task.importance === "important" ? "selected" : ""}>Important</option>${
        urgency === "urgent" ? `<option value="less-important" ${task.importance !== "important" ? "selected" : ""}>Not important</option>` : ""
      }`;
      const duplicateLabel = task.duplicate === "file"
        ? "This exact Markdown file was imported before. Skipped by default."
        : task.duplicate === "task" ? "An identical task already exists in this workspace. Skipped by default." : "";
      return `<article class="lite-import-task${task.duplicate ? " is-duplicate" : ""}"><label><input type="checkbox" data-import-selected="${index}" ${task.selected ? "checked" : ""}> Include</label>${duplicateLabel ? `<p class="lite-import-duplicate">${duplicateLabel}</p>` : ""}<input data-import-title="${index}" aria-label="Imported task title" value="${esc(task.title)}"><textarea data-import-notes="${index}" aria-label="Imported task notes">${esc(task.notes || "")}</textarea><div><input data-import-due="${index}" aria-label="Imported task due date" type="date" value="${esc(task.dueDate || "")}"><select data-import-priority="${index}" aria-label="Imported task importance">${importanceChoices}</select></div></article>`;
    }).join("");
    const duplicateCount = review.tasks.filter((task) => task.duplicate).length;
    const summary = `${review.tasks.length} found · ${review.tasks.length - duplicateCount} new · ${duplicateCount} duplicate${duplicateCount === 1 ? "" : "s"} skipped`;
    return `<div class="lite-history"><section class="lite-history-card lite-import-card" role="dialog" aria-modal="true"><div class="lite-settings-header"><h2>Review Markdown tasks</h2><button data-action="cancel-task-import" aria-label="Close import review">${icon("close")}</button></div><p>${summary}. Edit or select duplicates to import them anyway.</p>${review.exactFile ? `<p class="lite-import-warning">This exact file was previously imported into ${esc(active()?.title || "this workspace")}. All tasks start unchecked.</p>` : ""}<label class="lite-settings-label">Import mode<select data-import-mode><option value="add" ${review.mode === "add" ? "selected" : ""}>Add to workspace</option><option value="replace" ${review.mode === "replace" ? "selected" : ""}>Replace workspace — removes all current tasks</option></select></label>${review.mode === "replace" ? `<p class="lite-import-warning">Replace workspace will permanently remove the current task list unless you use Undo immediately afterward.</p>` : ""}<div class="lite-import-list">${importedTasks}</div><div class="lite-editor-actions"><button class="lite-editor-delete" data-action="cancel-task-import">Cancel</button><button class="lite-editor-save" data-action="confirm-task-import">${review.mode === "replace" ? "Replace with selected tasks" : "Add selected tasks"}</button></div></section></div>`;
  }
  function tasks(w) {
    const q = state.query.trim().toLowerCase();
    const width = Math.min(25, Math.max(16, 210 / Math.max(root.clientWidth, 1) * 100));
    const stageWidth = root.querySelector(".lite-stage")?.clientWidth || Math.max(1, root.clientWidth - 88);
    const labelWidth = (x) => Math.max(24, Math.min(154, Math.floor(stageWidth * (100 - x) / 100 - 30)));
    const cards = w.tasks.filter((t) =>
      !["completed", "cancelled", "deleted"].includes(t.status) &&
      (!state.search || `${t.title} ${t.notes} ${(t.tags || []).join(" ")} ${t.project || ""}`.toLowerCase().includes(q))
    ).map((t, i) => ({
      t, i, saved: position(t, i, w),
      band: priorityFor(t.dueDate, t.importance).importance === "important" ? "important" : "less-important",
    }));
    const occupied = { important: [], "less-important": [] };
    ["important", "less-important"].forEach((band) => cards
      .filter((card) => card.band === band)
      .sort((a, b) => a.saved.x - b.saved.x || a.i - b.i)
      .forEach((card) => {
        const lane = occupied[band].findIndex((items) =>
          !items.some((item) => card.saved.x < item.x + item.width + 1 && item.x < card.saved.x + width + 1),
        );
        card.lane = lane === -1 ? occupied[band].length : lane;
        if (!occupied[band][card.lane]) occupied[band][card.lane] = [];
        occupied[band][card.lane].push({ x: card.saved.x, width });
      }));
    const laneCount = {
      important: Math.max(1, occupied.important.length),
      "less-important": Math.max(1, occupied["less-important"].length),
    };
    const stageHeight = Math.max(1, window.innerHeight - 58);
    const compactBand = (band) => {
      const count = laneCount[band];
      if (count < 2) return false;
      const availableHeight = (band === "important" ? 35 : 35) / 100 * stageHeight;
      return availableHeight / (count - 1) < 54;
    };
    const laneY = (band, lane) => {
      const [start, end] = band === "important" ? [5, 40] : [56, 91];
      const count = laneCount[band];
      return count === 1 ? (start + end) / 2 : start + lane * ((end - start) / (count - 1));
    };
    state.laneCount = laneCount;
    const dateLeaders = new Set();
    ["important", "less-important"].forEach((band) => {
      const shownDates = new Set();
      cards.filter((card) => card.band === band)
        .sort((a, b) => a.lane - b.lane || a.i - b.i)
        .forEach((card) => {
          const groupDate = card.t.dueDate || "later";
          if (!shownDates.has(groupDate)) {
            shownDates.add(groupDate);
            dateLeaders.add(card.t.id);
          }
        });
    });
    return cards.map(({ t, saved, band, lane }) => {
      const p = { x: saved.x, y: laneY(band, lane) };
      const d = due(t.dueDate) || "Later";
      const showDate = dateLeaders.has(t.id);
      return `<article class="lite-task task-${quadrant(t)}${compactBand(band) ? " is-compact" : ""}" data-task="${
        esc(t.id)
      }" style="--x:${p.x}%;--y:${p.y}%;--task-label-width:${labelWidth(p.x)}px"><button class="lite-task-dot" data-complete="${
        esc(t.id)
      }" aria-label="Mark ${
        esc(t.title)
      } complete"></button><button class="lite-task-label" data-select="${
        esc(t.id)
      }"><span class="lite-task-title" title="${esc(t.title)}">${esc(t.title)}</span>${
        showDate
          ? `<span class="lite-task-due ${
            d === "Today" || d === "Overdue" ? "is-today" : ""
          }${d === "Overdue" ? " is-overdue" : ""}">${d}</span>`
          : ""
      }</button></article>`;
    }).join("");
  }
  function panel(w) {
    const t = w.tasks.find((x) => x.id === state.selectedId);
    if (!t) {
      return `<section class="lite-notes"><div class="lite-notes-heading"><span class="notes-glyph">${
        icon("file")
      }</span>Notes</div><div class="lite-notes-input" contenteditable="true" role="textbox" aria-multiline="true" aria-label="${w.title} notes" data-placeholder="Write a note…">${
        noteHtml(w.notes)
      }</div></section>`;
    }
    const notesExpanded = state.editorNotesExpanded ?? Boolean(t.notes);
    return `<section class="lite-notes is-editing"><div class="lite-editor-grid"><label class="lite-editor-title-label"><span>Task editor</span><textarea id="task-title" class="lite-editor-title" aria-label="Task title" rows="2">${
      esc(t.title)
    }</textarea></label><label class="lite-editor-label">Due date<input id="task-due" class="lite-editor-field" type="date" value="${
      esc(t.dueDate || "")
    }"></label><label class="lite-editor-label">Importance<select id="task-importance" class="lite-editor-field"><option value="important" ${
      t.importance === "important" ? "selected" : ""
    }>Important</option>${urgencyFor(t.dueDate) === "urgent" ? `<option value="less-important" ${
      t.importance !== "important" ? "selected" : ""
    }>Not important</option>` : ""}</select></label></div><div class="lite-editor-notes-row"><span>Notes</span><button class="lite-editor-notes-toggle" data-action="toggle-task-notes" aria-expanded="${notesExpanded}">${notesExpanded ? "− Hide note" : "+ Add note"}</button></div>${notesExpanded ? `<div id="task-notes" class="lite-editor-notes" contenteditable="true" role="textbox" aria-multiline="true" data-placeholder="Write a note…">${noteHtml(t.notes || "")}</div>` : ""}<div class="lite-editor-actions"><button class="lite-editor-save" data-action="save-task">Save changes</button><button class="lite-editor-delete" data-action="delete-task">Delete task</button></div></section>`;
  }
  function welcome() {
    root.innerHTML = `<main class="lite-welcome"><div class="welcome-mark">${
      icon("file")
    }</div><h1>Open your Luma Markdown</h1><p>Your tasks and notes stay in this tab only. The website does not store or upload them.</p><label class="lite-file-action" for="markdown-file">${
      icon("upload")
    }Choose Markdown file</label>${
      window.showOpenFilePicker
        ? '<button class="lite-welcome-secondary" data-action="direct-open">Open for direct saving</button>'
        : '<p class="lite-file-hint">Your browser will download an updated Markdown copy when you save.</p>'
    }<button class="lite-welcome-secondary" data-action="new-workspace">Start a new Markdown file</button><p class="lite-file-hint">A new workspace stays in this tab until you save it as Markdown.</p><p class="lite-error" role="status">${esc(state.notice)}</p></main>`;
  }
  function render() {
    if (!active()) {
      welcome();
      bind();
      return;
    }
    const w = active(),
      date = new Date().toLocaleDateString(undefined, {
        weekday: "short",
        month: "short",
        day: "numeric",
        year: "numeric",
      });
    root.innerHTML =
      `<main class="lite-canvas"><header class="lite-topbar"><div class="lite-identity"><time class="lite-date">${date}</time><div class="lite-switcher" role="group" aria-label="Workspace"><button class="lite-switch ${
        w.id === "work" ? "active" : ""
      }" data-workspace="work">Work</button><button class="lite-switch ${
        w.id === "personal" ? "active" : ""
      }" data-workspace="personal">Personal</button></div>${w.dirty ? '<span class="lite-dirty" title="Unsaved changes" aria-label="Unsaved changes"></span>' : ""}</div><div class="lite-actions"><div class="lite-capture-wrap"><span class="lite-capture-icon">${
        icon("plus")
      }</span><input class="lite-capture" aria-label="${
        state.search ? "Search tasks" : "Add a task"
      }" placeholder="${
        state.search ? "Search tasks…" : "Add a task…"
      }" value="${
        esc(state.query)
      }"><button class="lite-mode-button" data-action="toggle-search" aria-label="${
        state.search ? "Exit search" : "Search tasks"
      }">${
        icon(state.search ? "close" : "search")
      }</button></div>${state.file.handle ? `<button class="lite-reconnect" data-action="reconnect" title="Reconnect ${esc(state.file.fileName)}">Reconnect</button>` : ""}<button class="lite-save" data-action="save" aria-label="Save current Markdown workspace">${
        icon("cloud")
      }</button><div class="menu-anchor"><button class="lite-menu-button" data-action="toggle-menu" aria-label="Open workspace menu" aria-expanded="${state.menuOpen}">${
        icon("more")
      }</button>${
        menu(w)
      }</div></div></header><section class="lite-stage lite-three-quadrant" aria-label="Three-area priority canvas"><div class="lite-today-guide" style="--today-x:${timelineX(0)}%" aria-hidden="true"><span>Today</span></div><div class="lite-axis lite-axis-y"><span class="axis-label axis-important">Important</span><span class="axis-label axis-not-important">Not Important</span></div><div class="lite-axis lite-axis-x"><span class="axis-label">Not Urgent</span><div class="timeline">${timeline(w).map((tick) => `<span class="${tick.showLabel ? "" : "is-label-hidden"}" style="--tick-x:${tick.x}%" title="${esc(tick.label)}">${esc(tick.label)}</span>`).join("")}</div><span class="axis-label">Urgent</span></div><div class="lite-task-layer">${
        tasks(w)
      }</div>${panel(w)}</section><p class="lite-toast" role="status">${
        esc(state.notice)
      }</p>${history(w)}${taskImportReview()}<div class="lite-conflict" ${state.conflict ? "" : "hidden"}><section class="lite-settings-card" role="dialog" aria-modal="true"><div class="lite-settings-header"><h2>File changed outside Luma</h2></div><p>Reload the selected file, or download your current in-memory changes. Nothing has been overwritten.</p><div class="lite-editor-actions"><button class="lite-editor-delete" data-action="conflict-download">Download current changes</button><button class="lite-editor-save" data-action="conflict-reload">Reload file</button></div></section></div>${settingsPanel()}</main>`;
    const notImportantLabel = root.querySelector(".axis-not-important");
    if (notImportantLabel) notImportantLabel.innerHTML = "<span>Not</span><span>Important</span>";
    bind();
  }
  function drag(node, t) {
    node.addEventListener("pointerdown", (e) => {
      const stage = node.closest(".lite-stage"), start = { x: e.clientX, y: e.clientY };
      let moved = false;
      const
        move = (ev) => {
          if (Math.hypot(ev.clientX - start.x, ev.clientY - start.y) < 6) return;
          moved = true;
          const r = stage.getBoundingClientRect(),
            x = Math.min(
              91,
              Math.max(9, (ev.clientX - r.left) / r.width * 100),
            ),
            y = Math.min(
              88,
              Math.max(10, (ev.clientY - r.top) / r.height * 100),
            );
          node.style.setProperty("--x", `${x}%`);
          node.style.setProperty("--y", `${y}%`);
        },
        end = (ev) => {
          const r = stage.getBoundingClientRect(),
            x = Math.min(
              91,
              Math.max(9, (ev.clientX - r.left) / r.width * 100),
            ),
            y = Math.min(
              88,
              Math.max(10, (ev.clientY - r.top) / r.height * 100),
          );
          if (moved) {
            const urgency = urgencyFor(t.dueDate);
            const constrainedY = urgency === "not-urgent" ? Math.min(42, y) : y;
            node.dataset.dragged = "true";
            update(t, { canvas: null, importance: constrainedY < 43 ? "important" : "less-important" });
          }
          document.removeEventListener("pointermove", move);
          if (moved) render();
        };
      document.addEventListener("pointermove", move);
      document.addEventListener("pointerup", end, { once: true });
    });
  }
  function bind() {
    const input = root.querySelector(".lite-capture");
    if (input) {
      input.addEventListener("input", () => {
        state.query = input.value;
        if (state.search) {
          const selectionStart = input.selectionStart;
          const selectionEnd = input.selectionEnd;
          render();
          const next = root.querySelector(".lite-capture");
          next?.focus();
          if (next && selectionStart !== null && selectionEnd !== null) {
            next.setSelectionRange(selectionStart, selectionEnd);
          }
        }
      });
      input.addEventListener("keydown", (e) => {
        if (!state.search && e.key.toLowerCase() === "i" && !input.value) {
          e.preventDefault();
          state.captureImportant = true;
          input.closest(".lite-capture-wrap")?.classList.add("is-important");
          input.placeholder = "Add an important task…";
          return;
        }
        if (!state.search && e.key === "Backspace" && !input.value && state.captureImportant) {
          state.captureImportant = false;
          input.closest(".lite-capture-wrap")?.classList.remove("is-important");
          input.placeholder = "Add a task…";
          return;
        }
        if (e.key === "Enter" && !state.search && input.value.trim()) {
          const time = new Date().toISOString();
          const captured = parseCapture(input.value);
          active().tasks.push({
            id: crypto.randomUUID(),
            title: captured.title,
            status: "open",
            ...priorityFor(captured.dueDate, state.captureImportant ? "important" : "less-important"),
            dueDate: captured.dueDate,
            notes: "",
            createdAt: time,
            updatedAt: time,
            completedAt: null,
            deletedAt: null,
            canvas: null,
          });
          dirty(active());
          state.query = "";
          state.captureImportant = false;
          render();
          root.querySelector(".lite-capture")?.focus();
        }
      });
    }
    const bindNoteEditor = (editor, onChange) => {
      if (!editor) return;
      const sync = () => onChange(noteMarkdown(editor));
      editor.addEventListener("input", sync);
      editor.addEventListener("keydown", (e) => {
        if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "b") {
          e.preventDefault();
          const selection = window.getSelection();
          const range = selection?.rangeCount ? selection.getRangeAt(0) : null;
          if (range && !range.collapsed && editor.contains(range.commonAncestorContainer)) {
            const boldParent = (node) => {
              const element = node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement;
              return element?.closest("strong, b");
            };
            const startBold = boldParent(range.startContainer);
            const endBold = boldParent(range.endContainer);
            const selectsWholeBold = startBold && startBold === endBold &&
              range.startContainer === startBold && range.startOffset === 0 &&
              range.endContainer === startBold && range.endOffset === startBold.childNodes.length;
            if (selectsWholeBold) {
              const children = [...startBold.childNodes];
              children.forEach((child) => startBold.parentNode.insertBefore(child, startBold));
              startBold.remove();
              const nextRange = document.createRange();
              nextRange.setStartBefore(children[0]);
              nextRange.setEndAfter(children[children.length - 1]);
              selection.removeAllRanges();
              selection.addRange(nextRange);
            } else if (startBold && startBold === endBold) {
              document.execCommand("bold");
            } else {
              const strong = document.createElement("strong");
              strong.append(range.extractContents());
              range.insertNode(strong);
              range.selectNodeContents(strong);
              selection.removeAllRanges();
              selection.addRange(range);
            }
          } else {
            document.execCommand("bold");
          }
          sync();
        }
      });
    };
    bindNoteEditor(root.querySelector(".lite-notes-input"), (value) => {
      active().notes = value;
      dirty(active());
    });
    bindNoteEditor(root.querySelector("#task-notes"), () => {});
    root.querySelectorAll("[data-workspace]").forEach((b) =>
      b.onclick = () => {
        state.activeId = b.dataset.workspace;
        state.selectedId = null;
        state.menuOpen = false;
        state.notice = "";
        queueLocalSave();
        render();
      }
    );
    root.querySelectorAll("[data-select]").forEach((b) =>
      b.onclick = () => {
        state.selectedId = b.dataset.select;
        state.editorNotesExpanded = null;
        render();
      }
    );
    root.querySelectorAll("[data-complete]").forEach((b) =>
      b.onclick = () => {
        const t = active().tasks.find((x) => x.id === b.dataset.complete);
        update(t, {
          status: "completed",
          completedAt: new Date().toISOString(),
        });
        state.undo = {
          workspaceId: active().id,
          taskId: t.id,
          kind: "completion",
        };
        state.selectedId = null;
        render();
      }
    );
    root.querySelectorAll(".lite-task").forEach((n) =>
      drag(n, active().tasks.find((t) => t.id === n.dataset.task))
    );
    root.querySelectorAll("[data-action]").forEach((b) =>
      b.onclick = () => {
        const a = b.dataset.action;
        if (a === "direct-open") picker(true);
        else if (a === "reconnect") void reconnect();
        else if (a === "import-tasks") {
          const input = document.getElementById("markdown-task-import");
          input.value = "";
          input.click();
        } else if (a === "cancel-task-import") {
          state.taskImport = null;
          render();
        } else if (a === "confirm-task-import") {
          const review = state.taskImport, workspace = active();
          if (!review || !workspace) return;
          const imported = review.tasks.map((task, index) => normalizeTaskPriority({
            ...task,
            selected: root.querySelector(`[data-import-selected="${index}"]`)?.checked,
            title: root.querySelector(`[data-import-title="${index}"]`)?.value.trim() || task.title,
            notes: root.querySelector(`[data-import-notes="${index}"]`)?.value || "",
            dueDate: root.querySelector(`[data-import-due="${index}"]`)?.value || null,
            importance: root.querySelector(`[data-import-priority="${index}"]`)?.value || "less-important",
          })).filter((task) => task.selected);
          if (!imported.length) return notice("Select at least one task to import.");
          const beforeTasks = workspace.tasks.map((task) => ({ ...task }));
          const beforeImportHistory = [...(workspace.importHistory || [])];
          workspace.tasks = review.mode === "replace" ? imported : [...workspace.tasks, ...imported];
          recordImportHistory(workspace, review, imported);
          dirty(workspace);
          state.undo = { workspaceId: workspace.id, kind: review.mode === "replace" ? "workspace replacement" : "task import", beforeTasks, beforeImportHistory };
          state.taskImport = null;
          state.notice = `${review.mode === "replace" ? "Replaced" : "Added"} ${imported.length} imported task${imported.length === 1 ? "" : "s"}.`;
          render();
        }
        else if (a === "new-workspace") {
          const workspace = blank("work");
          workspace.dirty = true;
          addWorkspace(workspace);
          state.notice = "New Work workspace — save when you are ready to create its Markdown file.";
          render();
        }
        else if (a === "save") save();
        else if (a === "open-workspace") { state.menuOpen = false; picker(Boolean(window.showOpenFilePicker)); }
        else if (a === "clear-browser") void clearBrowserWorkspace();
        else if (a === "history") { state.historyOpen = true; state.menuOpen = false; render(); }
        else if (a === "toggle-menu") {
          state.menuOpen = !state.menuOpen;
          render();
        } else if (a === "toggle-search") {
          state.search = !state.search;
          state.query = "";
          state.captureImportant = false;
          render();
          root.querySelector(".lite-capture")?.focus();
        } else if (a === "settings") {
          state.settingsOpen = true;
          state.menuOpen = false;
          render();
        } else if (a === "close-settings") {
          state.settingsOpen = false;
          render();
        } else if (a === "clear-import-history") {
          const workspace = active();
          if (!workspace) return;
          workspace.importHistory = [];
          dirty(workspace);
          state.notice = "Cleared local import history for this workspace.";
          render();
        } else if (a === "close-history") {
          state.historyOpen = false;
          render();
        } else if (a === "conflict-download") {
          state.conflict = null;
          save(true);
        } else if (a === "conflict-reload") {
          const conflict = state.conflict;
          state.conflict = null;
          importFile(new File([conflict.text], conflict.name, { type: "text/markdown" }), state.file.handle);
        } else if (a === "reset-layout") {
          active().tasks.forEach((t) => update(t, { canvas: null }));
          dirty(active());
          state.settingsOpen = false;
          render();
        } else if (a === "toggle-task-notes") {
          state.editorNotesExpanded = !state.editorNotesExpanded;
          render();
          if (state.editorNotesExpanded) root.querySelector("#task-notes")?.focus();
        } else if (a === "undo") {
          if (state.undo.kind === "workspace replacement" || state.undo.kind === "task import") {
            active().tasks = state.undo.beforeTasks;
            active().importHistory = state.undo.beforeImportHistory || [];
            dirty(active());
            state.undo = null;
            state.menuOpen = false;
            render();
            return;
          }
          const t = active().tasks.find((x) => x.id === state.undo.taskId);
          if (t) {
            update(t, { status: "open", completedAt: null, deletedAt: null });
            state.undo = null;
            state.menuOpen = false;
            render();
          }
        } else if (a === "delete-task") {
          const t = active().tasks.find((x) => x.id === state.selectedId);
          update(t, {
            status: "cancelled",
            deletedAt: new Date().toISOString(),
          });
          state.undo = {
            workspaceId: active().id,
            taskId: t.id,
            kind: "deletion",
          };
          state.selectedId = null;
          render();
        } else if (a === "save-task") {
          const t = active().tasks.find((x) => x.id === state.selectedId);
          update(t, {
            title: root.querySelector("#task-title").value.trim() || t.title,
            dueDate: root.querySelector("#task-due").value || null,
            importance: root.querySelector("#task-importance").value,
            urgency: urgencyFor(root.querySelector("#task-due").value || null),
            notes: root.querySelector("#task-notes") ? noteMarkdown(root.querySelector("#task-notes")) : t.notes,
          });
          state.selectedId = null;
          state.editorNotesExpanded = null;
          render();
        }
      }
    );
    root.querySelector("[data-setting=\"backup-name\"]")?.addEventListener("change", (e) => {
      state.preferences.backupName = e.target.value === "week" ? "week" : "date";
      queueLocalSave();
      render();
    });
    root.querySelector("[data-import-mode]")?.addEventListener("change", (e) => {
      state.taskImport.mode = e.target.value === "replace" ? "replace" : "add";
      render();
    });
    root.querySelector(".lite-stage")?.addEventListener("click", (e) => {
      if (e.target.classList.contains("lite-stage")) {
        state.selectedId = null;
        render();
      }
    });
  }
  document.getElementById("markdown-file").addEventListener("change", (e) => {
    const f = e.target.files?.[0];
    if (f) importFile(f);
  });
  document.getElementById("markdown-task-import").addEventListener("change", (e) => {
    const file = e.target.files?.[0];
    if (file) void importTasksFile(file);
  });
  document.addEventListener("click", (e) => {
    if (state.menuOpen && !e.target.closest(".menu-anchor")) {
      state.menuOpen = false;
      render();
    }
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "/" && active() && !state.search && !e.metaKey && !e.ctrlKey && !e.altKey) {
      const target = e.target;
      const emptyCapture = target instanceof HTMLInputElement && target.classList.contains("lite-capture") && !target.value;
      if (!emptyCapture && (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement || target?.isContentEditable)) return;
      e.preventDefault();
      state.query = "";
      state.captureImportant = false;
      render();
      root.querySelector(".lite-capture")?.focus();
      return;
    }
    if (e.key !== "Escape") return;
    if (state.conflict) state.conflict = null;
    else if (state.settingsOpen) state.settingsOpen = false;
    else if (state.historyOpen) state.historyOpen = false;
    else if (state.menuOpen) state.menuOpen = false;
    else if (state.search) {
      state.search = false;
      state.query = "";
    } else if (state.selectedId) state.selectedId = null;
    else return;
    render();
  });
  window.addEventListener("beforeunload", (event) => {
    if ([...state.workspaces.values()].some((workspace) => workspace.dirty)) {
      event.preventDefault();
      event.returnValue = "";
    }
  });
  void restoreLocal().then(() => render());
})();
