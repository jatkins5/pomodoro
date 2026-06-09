const ENDPOINT = "http://127.0.0.1:17234";
const root = document.getElementById("root");
const tasksPanel = document.getElementById("tasks");
const pendingList = document.getElementById("pending-list");
const longtermSection = document.getElementById("longterm-section");
const longtermList = document.getElementById("longterm-list");
const completedSection = document.getElementById("completed-section");
const completedList = document.getElementById("completed-list");
const completedToggle = document.getElementById("completed-toggle");
const emptyMsg = document.getElementById("empty-msg");
const addToggle = document.getElementById("add-toggle");
const addForm = document.getElementById("add-form");
const addCancel = document.getElementById("add-cancel");
const addSubmit = document.getElementById("add-submit");
const formMode = document.getElementById("form-mode");
const tagFilter = document.getElementById("tag-filter");
const parseHint = document.getElementById("parse-hint");
const titleInput = addForm.querySelector('input[name="title"]');

let countdownTimer = null;
let pomState = null;
let tasksCache = [];
let showCompleted = false;
let editingTask = false;
let idleTaskText = "";
let activeTag = null;
let editTaskId = null;

const TAG_RE = /(?:^|\s)#([A-Za-z0-9_-]+)/g;

function parseTags(title) {
  const tags = [];
  let m;
  TAG_RE.lastIndex = 0;
  while ((m = TAG_RE.exec(title)) !== null) {
    const t = m[1].toLowerCase();
    if (!tags.includes(t)) tags.push(t);
  }
  const clean = title.replace(TAG_RE, " ").replace(/\s+/g, " ").trim();
  return { clean, tags };
}

function fmtMmss(seconds) {
  const m = Math.floor(seconds / 60).toString().padStart(2, "0");
  const s = (seconds % 60).toString().padStart(2, "0");
  return `${m}:${s}`;
}

async function api(method, path, body) {
  const opts = { method, cache: "no-store" };
  if (body !== undefined) {
    opts.headers = { "Content-Type": "application/json" };
    opts.body = JSON.stringify(body);
  }
  const r = await fetch(`${ENDPOINT}${path}`, opts);
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}

function el(html) {
  const tmpl = document.createElement("template");
  tmpl.innerHTML = html.trim();
  return tmpl.content.firstChild;
}

function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
  );
}

function fmtChip(iso) {
  if (!iso) return null;
  const dateOnly = !iso.includes("T");
  let d;
  if (dateOnly) {
    const [y, m, day] = iso.split("-").map(Number);
    if (!y || !m || !day) return null;
    d = new Date(y, m - 1, day); // local midnight — avoid UTC day-shift
  } else {
    d = new Date(iso);
  }
  if (isNaN(d.getTime())) return null;
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const days = Math.round((new Date(d.getFullYear(), d.getMonth(), d.getDate()) - start) / 86400000);
  let datePart;
  if (days === 0) datePart = "today";
  else if (days === 1) datePart = "tmrw";
  else if (days === -1) datePart = "yest";
  else datePart = d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  // For a date with no time, "past" means the day itself has passed.
  const past = dateOnly ? days < 0 : d < now;
  if (dateOnly) return { text: datePart, past };
  const time = d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  return { text: `${datePart} ${time}`, past };
}

async function postAction(path, body) {
  try {
    const r = await api("POST", path, body);
    return r;
  } catch (e) {
    return { error: e.message };
  }
}

async function refresh() {
  try {
    pomState = await api("GET", "/status");
  } catch (e) {
    pomState = { error: e.message };
  }
  try {
    tasksCache = await api("GET", "/tasks?all=1");
  } catch (e) {
    tasksCache = [];
  }
  render();
  renderTasks();
}

function renderActiveTask(task) {
  if (editingTask) {
    const initial = task?.text || "";
    const wrap = el(`<div class="task-edit"></div>`);
    const input = el(`<input type="text" placeholder="What are you working on?" value="${esc(initial)}">`);
    const save = el(`<button class="mini" title="Save">✓</button>`);
    const cancel = el(`<button class="mini" title="Cancel">✕</button>`);
    wrap.append(input, save, cancel);
    setTimeout(() => { input.focus(); input.select(); }, 0);
    const commit = async () => {
      const text = input.value.trim();
      editingTask = false;
      if (text) await postAction("/set-task", { task_text: text });
      else await postAction("/set-task", { clear: true });
      refresh();
    };
    const abort = () => { editingTask = false; render(); };
    save.addEventListener("click", commit);
    cancel.addEventListener("click", abort);
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") { e.preventDefault(); commit(); }
      else if (e.key === "Escape") { e.preventDefault(); abort(); }
    });
    return wrap;
  }
  if (!task) {
    const wrap = el(`<div class="task-row"><span class="label">no task</span><button class="mini" title="Set task">✎</button></div>`);
    wrap.querySelector("button").addEventListener("click", () => { editingTask = true; render(); });
    return wrap;
  }
  const title = task.title ?? task.text ?? "";
  const cls = task.deleted ? "task-row deleted" : "task-row";
  const wrap = el(`
    <div class="${cls}">
      <span class="label">working on</span>
      <span class="title">${esc(title)}</span>
      <button class="mini" data-action="edit" title="Change task">✎</button>
      <button class="mini" data-action="clear" title="Clear task">✕</button>
    </div>`);
  wrap.querySelector('[data-action="edit"]').addEventListener("click", () => { editingTask = true; render(); });
  wrap.querySelector('[data-action="clear"]').addEventListener("click", async () => {
    await postAction("/set-task", { clear: true });
    refresh();
  });
  return wrap;
}

async function onAction(event) {
  const path = event.currentTarget.dataset.action;
  if (!path) return;
  event.currentTarget.disabled = true;
  let body;
  if (path === "/toggle" && pomState?.status === "idle" && idleTaskText.trim()) {
    body = { task_text: idleTaskText.trim() };
  }
  pomState = await postAction(path, body);
  idleTaskText = "";
  render();
  await refresh();
}

function render() {
  if (countdownTimer) {
    clearInterval(countdownTimer);
    countdownTimer = null;
  }
  root.replaceChildren();

  if (!pomState) return;
  if (pomState.error) {
    const card = el(`
      <div class="card error">
        <h1>Pomodoro server unreachable</h1>
        <p class="hint">${esc(pomState.error)}</p>
        <p class="hint">Check that <code>pomodoro-server.service</code> is running:<br>
          <code>systemctl --user status pomodoro-server</code></p>
      </div>`);
    root.appendChild(card);
    return;
  }

  if (pomState.status === "idle") {
    const todays = pomState.focuses_today || 0;
    const heading = todays === 0
      ? "No pomodoro yet today.<br>Start one?"
      : `${todays} pomodoro${todays === 1 ? "" : "s"} done today.`;
    const card = el(`
      <div class="card prompt">
        <h1>${heading}</h1>
        <div class="idle-task">
          <input type="text" id="idle-task-input" placeholder="What will you work on? (optional)" autocomplete="off">
        </div>
        <button class="primary" data-action="/toggle">Start focus</button>
      </div>`);
    const input = card.querySelector("#idle-task-input");
    input.value = idleTaskText;
    input.addEventListener("input", (e) => { idleTaskText = e.target.value; });
    card.querySelector("button[data-action]").addEventListener("click", onAction);
    root.appendChild(card);
    return;
  }

  const phaseLabel = pomState.phase.replace("_", " ");
  const running = pomState.status === "running";
  const color = pomState.color || "#eee";
  const card = el(`
    <div class="card timer" style="border-color: ${color}">
      <div class="phase" style="color: ${color}">${phaseLabel}${running ? "" : " — paused"}</div>
      <div class="task-slot"></div>
      <div class="time-row">
        <div class="time" id="time" style="color: ${color}">${fmtMmss(pomState.remaining)}</div>
        <button class="icon" data-action="/reset" title="Reset timer" aria-label="Reset timer">↻</button>
      </div>
      <div class="meta">${pomState.focuses_today || 0} done today · cycle ${(pomState.completed_focuses % pomState.cycle_length) + (pomState.phase === "focus" ? 1 : 0)}/${pomState.cycle_length}</div>
      <div class="buttons">
        <button data-action="/toggle">${running ? "Pause" : "Resume"}</button>
        <button data-action="/skip">Skip</button>
        <button data-action="/stop">Stop</button>
      </div>
    </div>`);
  card.querySelector(".task-slot").appendChild(renderActiveTask(pomState.task));
  for (const b of card.querySelectorAll("button[data-action]")) {
    b.addEventListener("click", onAction);
  }
  root.appendChild(card);

  if (running) {
    let remaining = pomState.remaining;
    const timeEl = card.querySelector("#time");
    countdownTimer = setInterval(() => {
      remaining -= 1;
      if (remaining < 0) {
        clearInterval(countdownTimer);
        countdownTimer = null;
        refresh();
        return;
      }
      timeEl.textContent = fmtMmss(remaining);
    }, 1000);
  }
}

function compareTasks(a, b) {
  const ax = a.scheduled_at || a.due_at;
  const bx = b.scheduled_at || b.due_at;
  if (ax && bx) return ax.localeCompare(bx);
  if (ax) return -1;
  if (bx) return 1;
  return (a.created_at || "").localeCompare(b.created_at || "");
}

function renderTaskRow(t) {
  const active = pomState?.task?.id === t.id && pomState?.status !== "idle";
  const isCompleted = !!t.completed_at;
  const due = fmtChip(t.due_at);
  const sch = fmtChip(t.scheduled_at);
  const chips = [];
  if (due) chips.push(`<span class="chip due${due.past ? " overdue" : ""}">due ${esc(due.text)}</span>`);
  if (sch) chips.push(`<span class="chip scheduled${sch.past ? " past" : ""}">for ${esc(sch.text)}</span>`);
  for (const tag of (Array.isArray(t.tags) ? t.tags : [])) {
    chips.push(`<span class="chip tag">#${esc(tag)}</span>`);
  }
  const notes = t.notes ? `<div class="task-notes">${esc(t.notes)}</div>` : "";
  const meta = chips.length ? `<div class="task-meta">${chips.join("")}</div>` : "";
  const startBtn = isCompleted
    ? `<button class="uncomplete" data-act="uncomplete" title="Mark not completed">↩</button>`
    : `<button class="start" data-act="start" title="${pomState?.status === "idle" ? "Start focus on this task" : "Switch active task to this"}">▶</button>`;
  const completeBtn = isCompleted
    ? ""
    : `<button class="complete" data-act="complete" title="Mark complete">✓</button>`;
  const cls = `task${active ? " active" : ""}${isCompleted ? " completed" : ""}`;
  const li = el(`
    <li class="${cls}" data-id="${t.id}">
      <div class="task-body">
        <div class="task-title">${esc(t.title || "")}</div>
        ${meta}
        ${notes}
      </div>
      <div class="task-actions">
        ${startBtn}
        ${completeBtn}
        <button class="edit" data-act="edit" title="Edit task">✎</button>
        <button class="del" data-act="delete" title="Delete">✕</button>
      </div>
    </li>`);
  li.querySelectorAll("button[data-act]").forEach((btn) => {
    btn.addEventListener("click", () => onTaskAction(t.id, btn.dataset.act));
  });
  return li;
}

async function onTaskAction(id, op) {
  if (op === "edit") {
    openEditForm(tasksCache.find((x) => x.id === id));
    return;
  }
  if (op === "start") {
    if (pomState?.status === "idle") {
      await postAction("/toggle", { task_id: id });
    } else {
      await postAction("/set-task", { task_id: id });
    }
  } else if (op === "complete") {
    if (pomState?.task?.id === id) await postAction("/set-task", { clear: true });
    await postAction(`/tasks/${id}/complete`);
  } else if (op === "uncomplete") {
    await postAction(`/tasks/${id}/uncomplete`);
  } else if (op === "delete") {
    if (!confirm("Delete this task?")) return;
    if (pomState?.task?.id === id) await postAction("/set-task", { clear: true });
    await postAction(`/tasks/${id}/delete`);
  }
  refresh();
}

function renderTagFilter(pending) {
  const counts = new Map();
  for (const t of pending) {
    for (const tag of (Array.isArray(t.tags) ? t.tags : [])) {
      counts.set(tag, (counts.get(tag) || 0) + 1);
    }
  }
  if (activeTag && !counts.has(activeTag)) activeTag = null;
  tagFilter.replaceChildren();
  if (counts.size === 0) {
    tagFilter.hidden = true;
    return;
  }
  tagFilter.hidden = false;
  const allBtn = el(`<button class="filter-chip${activeTag ? "" : " on"}">all</button>`);
  allBtn.addEventListener("click", () => { activeTag = null; renderTasks(); });
  tagFilter.appendChild(allBtn);
  for (const tag of [...counts.keys()].sort()) {
    const b = el(`<button class="filter-chip${activeTag === tag ? " on" : ""}">#${esc(tag)}</button>`);
    b.addEventListener("click", () => { activeTag = activeTag === tag ? null : tag; renderTasks(); });
    tagFilter.appendChild(b);
  }
}

function renderTasks() {
  tasksPanel.hidden = false;
  pendingList.replaceChildren();
  longtermList.replaceChildren();
  completedList.replaceChildren();

  const pending = tasksCache.filter((t) => !t.completed_at);
  renderTagFilter(pending);

  const match = (t) => !activeTag || (Array.isArray(t.tags) && t.tags.includes(activeTag));
  const shortTerm = pending.filter((t) => !t.long_term && match(t)).sort(compareTasks);
  const longTerm = pending.filter((t) => t.long_term && match(t)).sort(compareTasks);
  const completed = tasksCache.filter((t) => t.completed_at && match(t))
    .sort((a, b) => (b.completed_at || "").localeCompare(a.completed_at || ""));

  for (const t of shortTerm) pendingList.appendChild(renderTaskRow(t));
  for (const t of longTerm) longtermList.appendChild(renderTaskRow(t));
  for (const t of completed) completedList.appendChild(renderTaskRow(t));

  emptyMsg.textContent = activeTag ? `No pending tasks tagged #${activeTag}.` : "No pending tasks.";
  emptyMsg.classList.toggle("hidden", shortTerm.length + longTerm.length > 0);
  longtermSection.hidden = longTerm.length === 0;

  if (completed.length === 0) {
    completedSection.hidden = true;
  } else {
    completedSection.hidden = false;
    completedToggle.textContent = `${showCompleted ? "Hide" : "Show"} ${completed.length} completed`;
    completedList.hidden = !showCompleted;
  }
}

function combineDateTime(prefix, fd) {
  const date = (fd.get(`${prefix}_date`) || "").toString().trim();
  if (!date) return null;
  const time = (fd.get(`${prefix}_time`) || "").toString().trim();
  return time ? `${date}T${time}` : date;
}

function splitDateTime(iso) {
  if (!iso) return { date: "", time: "" };
  if (!iso.includes("T")) return { date: iso, time: "" };
  const d = new Date(iso);
  if (isNaN(d.getTime())) return { date: "", time: "" };
  const pad = (n) => String(n).padStart(2, "0");
  return {
    date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
    time: `${pad(d.getHours())}:${pad(d.getMinutes())}`,
  };
}

function updateParseHint() {
  const { clean, tags } = parseTags(titleInput.value);
  if (!tags.length) {
    parseHint.hidden = true;
    return;
  }
  parseHint.hidden = false;
  const chips = tags.map((t) => `<span class="chip tag">#${esc(t)}</span>`).join("");
  parseHint.innerHTML = `${chips}<span class="parse-clean">${esc(clean || "(no title)")}</span>`;
}

// Reset all fields to a blank add-task state (does not change visibility).
function clearForm() {
  addForm.reset();
  addForm.querySelectorAll(".dt-time").forEach((t) => { t.value = ""; t.hidden = true; });
  addForm.querySelectorAll(".dt-time-toggle").forEach((b) => { b.textContent = "+ time"; });
  parseHint.hidden = true;
  parseHint.replaceChildren();
  editTaskId = null;
  formMode.hidden = true;
  addSubmit.textContent = "Add task";
}

function resetAddForm() {
  clearForm();
  addForm.setAttribute("hidden", "");
}

function setDateField(prefix, iso) {
  const field = addForm.querySelector(`input[name="${prefix}_date"]`).closest(".dt-field");
  const dateInput = field.querySelector('input[type="date"]');
  const timeInput = field.querySelector(".dt-time");
  const toggle = field.querySelector(".dt-time-toggle");
  const { date, time } = splitDateTime(iso);
  dateInput.value = date;
  timeInput.value = time;
  timeInput.hidden = !time;
  toggle.textContent = time ? "✕" : "+ time";
}

function openEditForm(task) {
  if (!task) return;
  clearForm();
  editTaskId = task.id;
  // Re-append tags to the title so they stay editable (the title is the source of truth).
  const tagSuffix = (Array.isArray(task.tags) ? task.tags : []).map((t) => `#${t}`).join(" ");
  titleInput.value = [task.title || "", tagSuffix].filter(Boolean).join(" ");
  setDateField("due_at", task.due_at);
  setDateField("scheduled_at", task.scheduled_at);
  addForm.querySelector('textarea[name="notes"]').value = task.notes || "";
  addForm.querySelector('input[name="long_term"]').checked = !!task.long_term;
  updateParseHint();
  formMode.hidden = false;
  addSubmit.textContent = "Save";
  addForm.removeAttribute("hidden");
  titleInput.focus();
  titleInput.setSelectionRange(titleInput.value.length, titleInput.value.length);
  addForm.scrollIntoView({ block: "nearest" });
}

titleInput.addEventListener("input", updateParseHint);

addForm.querySelectorAll(".dt-time-toggle").forEach((btn) => {
  btn.addEventListener("click", () => {
    const time = btn.closest(".dt-field").querySelector(".dt-time");
    if (time.hidden) {
      time.hidden = false;
      btn.textContent = "✕";
      time.focus();
    } else {
      time.value = "";
      time.hidden = true;
      btn.textContent = "+ time";
    }
  });
});

addToggle.addEventListener("click", () => {
  if (addForm.hasAttribute("hidden")) {
    clearForm();
    addForm.removeAttribute("hidden");
    titleInput.focus();
  } else {
    resetAddForm();
  }
});
addCancel.addEventListener("click", resetAddForm);
addForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const fd = new FormData(addForm);
  const body = {
    title: (fd.get("title") || "").toString(),
    due_at: combineDateTime("due_at", fd),
    scheduled_at: combineDateTime("scheduled_at", fd),
    long_term: !!fd.get("long_term"),
    notes: (fd.get("notes") || "").toString() || null,
  };
  const path = editTaskId ? `/tasks/${editTaskId}/update` : "/tasks";
  const result = await postAction(path, body);
  if (result.error) { alert(`Error: ${result.error}`); return; }
  resetAddForm();
  refresh();
});
completedToggle.addEventListener("click", () => {
  showCompleted = !showCompleted;
  renderTasks();
});

refresh();
setInterval(refresh, 30000);
document.addEventListener("visibilitychange", () => {
  if (!document.hidden) refresh();
});
