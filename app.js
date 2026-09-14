(() => {
  "use strict";
  // The application shell may work offline; user content is never cached or retained.
  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => navigator.serviceWorker.register("./sw.js").catch(() => {}));
  }
  const { parseWorkspaceMarkdown, serializeWorkspaceMarkdown, normalizeWorkspace } =
    window.NorthstarMarkdown;
  const root = document.getElementById("root");
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
    undo: null,
    notice: "",
    captureImportant: false,
    file: { handle: null, fileName: "northstar.md", revision: null },
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
  const active = () => state.workspaces.get(state.activeId);
  const profiles = () => [...state.workspaces.values()];
  const dirty = (w) => { w.dirty = true; queueLocalSave(); };
  const hash = async (text) => {
    if (crypto.subtle) {
      const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
      return [...new Uint8Array(bytes)].map((x) => x.toString(16).padStart(2, "0")).join("");
    }
    return `${text.length}:${text.slice(0, 64)}:${text.slice(-64)}`;
  };
  const localDb = (() => {
    const open = () => new Promise((resolve, reject) => {
      if (!window.indexedDB) return reject(new Error("IndexedDB is unavailable."));
      const request = indexedDB.open("northstar-lite", 1);
      request.onupgradeneeded = () => request.result.createObjectStore("workspace");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const read = async () => {
      const db = await open();
      return new Promise((resolve, reject) => {
        const request = db.transaction("workspace").objectStore("workspace").get("current");
        request.onsuccess = () => resolve(request.result || null);
        request.onerror = () => reject(request.error);
      });
    };
    const write = async (value) => {
      const db = await open();
      return new Promise((resolve, reject) => {
        const request = db.transaction("workspace", "readwrite").objectStore("workspace").put(value, "current");
        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
      });
    };
    const clear = async () => {
      const db = await open();
      return new Promise((resolve, reject) => {
        const request = db.transaction("workspace", "readwrite").objectStore("workspace").delete("current");
        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
      });
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
      fileName: "northstar.md",
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
  function loadProfiles(items, file = state.file, activeId = "personal") {
    state.workspaces.clear();
    items.forEach((item) => {
      item.tasks.forEach(normalizeTaskPriority);
      addWorkspace(item);
    });
    if (!state.workspaces.has("personal")) state.workspaces.set("personal", blank("personal"));
    if (!state.workspaces.has("work")) state.workspaces.set("work", blank("work"));
    state.file = { handle: file?.handle || null, fileName: file?.fileName || "northstar.md", revision: file?.revision || null };
    profiles().forEach((profile) => { profile.fileName = state.file.fileName; profile.handle = state.file.handle; profile.revision = state.file.revision; });
    state.activeId = state.workspaces.has(activeId) ? activeId : "personal";
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
  function parseCapture(value) {
    let title = value.trim(), dueDate = null;
    const base = new Date(`${today()}T12:00:00`);
    const iso = title.match(/\b(\d{4}-\d{2}-\d{2})\b/);
    const named = title.match(/\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sept?(?:ember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+(\d{1,2})(?:st|nd|rd|th)?(?:,?\s+(\d{4}))?\b/i);
    const relative = title.match(/\b(today|tomorrow|next\s+(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday))\b/i);
    if (iso && !Number.isNaN(new Date(`${iso[1]}T12:00:00`).getTime())) {
      dueDate = iso[1]; title = title.replace(iso[0], " ").replace(/\s+/g, " ").trim();
    } else if (named) {
      const month = monthNames.findIndex((pattern) => pattern.test(named[1]));
      let year = named[3] ? Number(named[3]) : base.getFullYear();
      let candidate = new Date(year, month, Number(named[2]), 12);
      const valid = candidate.getMonth() === month && candidate.getDate() === Number(named[2]);
      if (valid) {
        // A month/day without a year means the next occurrence of that date.
        if (!named[3] && candidate < base) candidate = new Date(++year, month, Number(named[2]), 12);
        dueDate = localDate(candidate);
        title = title.replace(named[0], " ").replace(/\s+/g, " ").trim();
      }
    } else if (relative) {
      const token = relative[1].toLowerCase();
      if (token === "tomorrow") base.setDate(base.getDate() + 1);
      else if (token !== "today") {
        const days = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
        const target = days.indexOf(token.replace("next ", ""));
        base.setDate(base.getDate() + ((target - base.getDay() + 7) % 7 || 7));
      }
      dueDate = base.toLocaleDateString("en-CA");
      title = title.replace(relative[0], " ").replace(/\s+/g, " ").trim();
    }
    return { title: title || value.trim(), dueDate };
  }
  function dayOffset(date) {
    if (!date) return null;
    return Math.round(
      (new Date(`${date}T12:00:00`) - new Date(`${today()}T12:00:00`)) / 86400000,
    );
  }
  function oldestOverdueDay(w = active()) {
    return Math.min(
      0,
      ...(w?.tasks || [])
        .filter((t) => !["completed", "cancelled", "deleted"].includes(t.status))
        .map((t) => dayOffset(t.dueDate))
        .filter((days) => days !== null && days < 0),
    );
  }
  function urgentX(days, oldestOverdue) {
    if (oldestOverdue < 0) {
      // Reserve the urgent end for overdue work: older overdue dates sit farther right.
      if (days < 0) return 74 + (-days / -oldestOverdue) * 14;
      return 58 + (7 - days) * (16 / 7);
    }
    return 88 - days * (30 / 7);
  }
  function timeline(w = active()) {
    const activeDays = (w?.tasks || [])
      .filter((t) => !["completed", "cancelled", "deleted"].includes(t.status))
      .map((t) => dayOffset(t.dueDate))
      .filter((days) => days !== null);
    const futureDays = activeDays.filter((days) => days > 7);
    const overdueDays = activeDays.filter((days) => days < 0);
    const oldestOverdue = Math.min(0, ...overdueDays);
    const taskDays = new Set(activeDays);
    // Show reference dates on the non-urgent side, plus every active due date.
    const farthest = Math.max(28, ...futureDays);
    const days = [...new Set([0, 1, 2, 3, 4, 5, 6, 7, 8, 14, 21, 28, ...overdueDays, ...futureDays])]
      .filter((offset) => offset <= farthest)
      .sort((a, b) => b - a);
    const base = new Date(`${today()}T12:00:00`);
    const ticks = days.map((offset) => {
      const d = new Date(base);
      d.setDate(base.getDate() + offset);
      const x = offset <= 7
        ? urgentX(offset, oldestOverdue)
        : 42 - ((offset - 7) / (farthest - 7)) * 30;
      return {
        offset,
        label: d.toLocaleDateString(undefined, { month: "short", day: "numeric" }),
        x,
        isTaskDate: taskDays.has(offset),
      };
    });
    // Keep dots for every date, but only render labels that have enough room.
    const visible = [];
    return ticks.sort((a, b) => a.x - b.x).map((tick) => {
      const previous = visible[visible.length - 1];
      if (!previous || tick.x - previous.x >= 7) {
        const labeled = { ...tick, showLabel: true };
        visible.push(labeled);
        return labeled;
      }
      if (tick.isTaskDate && !previous.isTaskDate) {
        previous.showLabel = false;
        visible.pop();
        const labeled = { ...tick, showLabel: true };
        visible.push(labeled);
        return labeled;
      }
      return { ...tick, showLabel: false };
    });
  }
  function quadrant(t) {
    const priority = priorityFor(t.dueDate, t.importance);
    return priority.importance === "important"
      ? (priority.urgency === "urgent" ? "do-first" : "schedule")
      : "reconsider";
  }
  function position(t, i, w = active()) {
    if (!t.dueDate) return { x: 18, y: 22 + (i % 4) * 7 };
    const days = dayOffset(t.dueDate);
    const farthest = Math.max(
      28,
      ...(w?.tasks || []).map((task) => dayOffset(task.dueDate)).filter((offset) => offset !== null && offset > 7),
    );
    const oldestOverdue = oldestOverdueDay(w);
    const x = days > 7
      ? 42 - ((days - 7) / (farthest - 7)) * 30
      : Math.max(58, Math.min(88, urgentX(days, oldestOverdue)));
    return { x, y: t.importance === "important" ? 22 : 66 };
  }
  function notice(m) {
    state.notice = m;
    render();
  }
  async function importFile(file, handle = null) {
    try {
      const text = await file.text();
      const parsed = parseWorkspaceMarkdown(text, file.name);
      loadProfiles(parsed.profiles, { handle, fileName: file.name || "northstar.md", revision: await hash(text) }, state.activeId || "personal");
      state.selectedId = null;
      state.notice = parsed.warnings.join(" ") || "Opened one NorthStar workspace file.";
      queueLocalSave();
      render();
    } catch (e) {
      notice(`Could not read Markdown: ${e.message}`);
    }
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
          state.notice = "The Markdown file changed outside NorthStar. Choose Reload file or Download current changes.";
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
        a.download = state.file.fileName || "northstar.md";
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
    if (!window.confirm("Clear this browser's NorthStar workspace? This removes only the local recovery copy. Your Markdown file will not be changed.")) {
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
      state.file = { handle: null, fileName: "northstar.md", revision: null };
      state.notice = "Cleared this browser's NorthStar workspace. Your Markdown files were not changed.";
      render();
    } catch (e) {
      notice(`Could not clear this browser workspace: ${e.message}`);
    }
  }
  function menu(w) {
    const undo = state.undo?.workspaceId === w.id;
    return `<div class="lite-menu" ${
      state.menuOpen ? "" : "hidden"
    } role="menu"><div class="lite-menu-section">Workspace</div><button class="lite-menu-item" data-action="open-workspace">${
      icon("upload")
    }Open / replace Markdown workspace</button><button class="lite-menu-item" data-action="history">${
      icon("restore")
    }History</button>${
      undo
        ? `<div class="lite-menu-separator"></div><button class="lite-menu-item" data-action="undo">${
          icon("restore")
        }Undo ${state.undo.kind}</button>`
        : ""
    }<button class="lite-menu-item lite-menu-danger" data-action="clear-browser">${
      icon("clear")
    }Clear browser workspace</button><div class="lite-menu-separator"></div><div class="lite-menu-section">Settings</div><button class="lite-menu-item" data-action="settings">${
      icon("settings")
    }Settings</button></div>`;
  }
  function tasks(w) {
    const q = state.query.trim().toLowerCase();
    const lanes = {
      important: [12, 20, 28, 36],
      "less-important": [60, 68, 76, 84],
    };
    const occupied = { important: [[], [], [], []], "less-important": [[], [], [], []] };
    const width = Math.min(25, Math.max(16, 210 / Math.max(root.clientWidth, 1) * 100));
    return w.tasks.filter((t) =>
      !["completed", "cancelled", "deleted"].includes(t.status) &&
      (!state.search || `${t.title} ${t.notes} ${(t.tags || []).join(" ")} ${t.project || ""}`.toLowerCase().includes(q))
    ).map((t, i) => {
      const saved = position(t, i, w);
      const band = t.importance === "important" ? "important" : "less-important";
      const lane = occupied[band].findIndex((items) =>
        !items.some((item) => saved.x < item.x + item.width + 1 && item.x < saved.x + width + 1),
      );
      const laneIndex = lane === -1 ? occupied[band].length - 1 : lane;
      // Cards may move vertically into a free lane, never away from their date.
      occupied[band][laneIndex].push({ x: saved.x, width });
      const p = { x: saved.x, y: lanes[band][laneIndex] };
      const d = due(t.dueDate);
      return `<article class="lite-task task-${quadrant(t)}" data-task="${
        esc(t.id)
      }" style="--x:${p.x}%;--y:${p.y}%"><button class="lite-task-dot" data-complete="${
        esc(t.id)
      }" aria-label="Mark ${
        esc(t.title)
      } complete"></button><button class="lite-task-label" data-select="${
        esc(t.id)
      }"><span class="lite-task-title" title="${esc(t.title)}">${esc(t.title)}</span>${
        d
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
      }</span>Notes</div><textarea class="lite-notes-input" aria-label="${w.title} notes" placeholder="Write a note…">${
        esc(w.notes)
      }</textarea></section>`;
    }
    return `<section class="lite-notes is-editing"><div class="lite-editor-kicker">Task editor</div><input id="task-title" class="lite-editor-title" aria-label="Task title" value="${
      esc(t.title)
    }"><label class="lite-editor-label">Due date<input id="task-due" class="lite-editor-field" type="date" value="${
      esc(t.dueDate || "")
    }"></label><label class="lite-editor-label">Importance<select id="task-importance" class="lite-editor-field"><option value="important" ${
      t.importance === "important" ? "selected" : ""
    }>Important</option>${urgencyFor(t.dueDate) === "urgent" ? `<option value="less-important" ${
      t.importance !== "important" ? "selected" : ""
    }>Not important</option>` : ""}</select></label><label class="lite-editor-label">Notes<textarea id="task-notes" class="lite-editor-notes">${
      esc(t.notes || "")
    }</textarea></label><div class="lite-editor-actions"><button class="lite-editor-save" data-action="save-task">Save changes</button><button class="lite-editor-delete" data-action="delete-task">Delete task</button></div></section>`;
  }
  function welcome() {
    root.innerHTML = `<main class="lite-welcome"><div class="welcome-mark">${
      icon("file")
    }</div><h1>Open your NorthStar Markdown</h1><p>Your tasks and notes stay in this tab only. The website does not store or upload them.</p><label class="lite-file-action" for="markdown-file">${
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
      }</div></div></header><section class="lite-stage lite-three-quadrant" aria-label="Three-area priority canvas"><div class="lite-axis lite-axis-y"><span class="axis-label axis-important">Important</span><span class="axis-label axis-not-important">Not Important</span></div><div class="lite-axis lite-axis-x"><span class="axis-label">Not Urgent</span><div class="timeline">${timeline(w).map((tick) => `<span class="${tick.showLabel ? "" : "is-label-hidden"}" style="--tick-x:${tick.x}%" title="${esc(tick.label)}">${esc(tick.label)}</span>`).join("")}</div><span class="axis-label">Urgent</span></div><div class="lite-task-layer">${
        tasks(w)
      }</div>${panel(w)}</section><p class="lite-toast" role="status">${
        esc(state.notice)
      }</p><div class="lite-history" ${state.historyOpen ? "" : "hidden"}><section class="lite-history-card" role="dialog" aria-modal="true"><div class="lite-settings-header"><h2>${w.title} history</h2><button data-action="close-history" aria-label="Close history">${icon("close")}</button></div><div class="lite-history-list">${w.tasks.filter((t) => ["completed", "cancelled", "deleted"].includes(t.status)).map((t) => `<p><strong>${esc(t.title)}</strong><span>${esc(t.status)}</span></p>`).join("") || "<p>No completed or cancelled tasks yet.</p>"}</div></section></div><div class="lite-conflict" ${state.conflict ? "" : "hidden"}><section class="lite-settings-card" role="dialog" aria-modal="true"><div class="lite-settings-header"><h2>File changed outside NorthStar</h2></div><p>Reload the selected file, or download your current in-memory changes. Nothing has been overwritten.</p><div class="lite-editor-actions"><button class="lite-editor-delete" data-action="conflict-download">Download current changes</button><button class="lite-editor-save" data-action="conflict-reload">Reload file</button></div></section></div><div class="lite-settings" ${
        state.settingsOpen ? "" : "hidden"
      }><section class="lite-settings-card" role="dialog" aria-modal="true"><div class="lite-settings-header"><h2>Settings</h2><button data-action="close-settings" aria-label="Close settings">${
        icon("close")
      }</button></div><p>NorthStar Lite saves a private recovery copy in this browser. Save to Markdown when you want to update your file.</p><button class="lite-reset-layout" data-action="reset-layout">Reset current layout</button></section></div></main>`;
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
    root.querySelector(".lite-notes-input")?.addEventListener("input", (e) => {
      active().notes = e.target.value;
      dirty(active());
    });
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
        else if (a === "new-workspace") {
          const workspace = blank("personal");
          workspace.dirty = true;
          addWorkspace(workspace);
          state.notice = "New Personal workspace — save when you are ready to create its Markdown file.";
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
        } else if (a === "undo") {
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
            notes: root.querySelector("#task-notes").value,
          });
          state.selectedId = null;
          render();
        }
      }
    );
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
