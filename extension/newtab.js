const ENDPOINT = "http://127.0.0.1:17234";
const root = document.getElementById("root");
let countdownTimer = null;

function fmtMmss(seconds) {
  const m = Math.floor(seconds / 60).toString().padStart(2, "0");
  const s = (seconds % 60).toString().padStart(2, "0");
  return `${m}:${s}`;
}

async function getStatus() {
  try {
    const r = await fetch(`${ENDPOINT}/status`, { cache: "no-store" });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return await r.json();
  } catch (e) {
    return { error: e.message };
  }
}

async function postAction(path) {
  try {
    const r = await fetch(`${ENDPOINT}${path}`, { method: "POST", cache: "no-store" });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return await r.json();
  } catch (e) {
    return { error: e.message };
  }
}

function el(html) {
  const tmpl = document.createElement("template");
  tmpl.innerHTML = html.trim();
  return tmpl.content.firstChild;
}

function bind(node, selector, handler) {
  for (const b of node.querySelectorAll(selector)) {
    b.addEventListener("click", handler);
  }
}

async function onAction(event) {
  const path = event.currentTarget.dataset.action;
  if (!path) return;
  event.currentTarget.disabled = true;
  const state = await postAction(path);
  render(state);
}

function render(state) {
  if (countdownTimer) {
    clearInterval(countdownTimer);
    countdownTimer = null;
  }
  root.replaceChildren();

  if (state.error) {
    const card = el(`
      <div class="card error">
        <h1>Pomodoro server unreachable</h1>
        <p class="hint">${state.error}</p>
        <p class="hint">Check that <code>pomodoro-server.service</code> is running:<br>
          <code>systemctl --user status pomodoro-server</code></p>
      </div>`);
    root.appendChild(card);
    return;
  }

  if (state.status === "idle") {
    const todays = state.focuses_today || 0;
    if (todays === 0) {
      const card = el(`
        <div class="card prompt">
          <h1>No pomodoro yet today.<br>Start one?</h1>
          <button class="primary" data-action="/toggle">Start focus</button>
        </div>`);
      bind(card, "button[data-action]", onAction);
      root.appendChild(card);
    } else {
      const card = el(`
        <div class="card done">
          <h1>${todays} pomodoro${todays === 1 ? "" : "s"} done today.</h1>
          <button data-action="/toggle">Start another</button>
        </div>`);
      bind(card, "button[data-action]", onAction);
      root.appendChild(card);
    }
    return;
  }

  const phaseLabel = state.phase.replace("_", " ");
  const running = state.status === "running";
  const color = state.color || "#eee";
  const card = el(`
    <div class="card timer" style="border-color: ${color}">
      <div class="phase" style="color: ${color}">${phaseLabel}${running ? "" : " — paused"}</div>
      <div class="time-row">
        <div class="time" id="time" style="color: ${color}">${fmtMmss(state.remaining)}</div>
        <button class="icon" data-action="/reset" title="Reset timer" aria-label="Reset timer">↻</button>
      </div>
      <div class="meta">${state.focuses_today || 0} done today · cycle ${(state.completed_focuses % state.cycle_length) + (state.phase === "focus" ? 1 : 0)}/${state.cycle_length}</div>
      <div class="buttons">
        <button data-action="/toggle">${running ? "Pause" : "Resume"}</button>
        <button data-action="/skip">Skip</button>
        <button data-action="/stop">Stop</button>
      </div>
    </div>`);
  bind(card, "button[data-action]", onAction);
  root.appendChild(card);

  if (running) {
    let remaining = state.remaining;
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

async function refresh() {
  render(await getStatus());
}

refresh();
setInterval(refresh, 30000);
document.addEventListener("visibilitychange", () => {
  if (!document.hidden) refresh();
});
