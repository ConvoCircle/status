const LABELS = {
  operational: "All systems operational",
  degraded: "Some systems degraded",
  down: "Service disruption",
  unknown: "Status unavailable",
};

const THEME_KEY = "cc-status-theme";

function $(sel) {
  return document.querySelector(sel);
}

function applyTheme(theme) {
  const next = theme || localStorage.getItem(THEME_KEY) || (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
  document.documentElement.classList.toggle("dark", next === "dark");
  const btn = $("#theme-toggle");
  if (btn) btn.textContent = next === "dark" ? "Light" : "Dark";
  return next;
}

function relTime(iso) {
  if (!iso) return "—";
  const ms = Date.now() - new Date(iso).getTime();
  const min = Math.round(ms / 60000);
  if (min < 1) return "just now";
  if (min < 60) return `${min} min ago`;
  const hr = Math.round(min / 60);
  if (hr < 36) return `${hr}h ago`;
  return `${Math.round(hr / 24)}d ago`;
}

function pct(value) {
  return value == null ? "—" : `${value.toFixed(1).replace(/\.0$/, "")}%`;
}

function ticksFor(id, history) {
  const index = (history.ids || []).indexOf(id);
  if (index < 0) return [];
  const names = ["operational", "degraded", "down"];
  const cutoff = Date.now() / 1000 - 86400;
  return (history.samples || [])
    .filter((row) => Number(row?.[0]) >= cutoff)
    .slice(-96)
    .map((row) => names[row[1]?.[index]] || "unknown");
}

function renderBanner(status) {
  const el = $("#banner");
  if (status.incident?.active) {
    el.hidden = false;
    el.className = "banner";
    el.textContent = status.incident.summary;
    return;
  }
  if (status.lastIncident?.resolvedAt) {
    const age = Date.now() - new Date(status.lastIncident.resolvedAt).getTime();
    if (age < 6 * 3600 * 1000) {
      el.hidden = false;
      el.className = "banner resolved";
      el.textContent = `Resolved: ${status.lastIncident.summary} · ${relTime(status.lastIncident.resolvedAt)}`;
      return;
    }
  }
  el.hidden = true;
  el.textContent = "";
}

function card(component, status, history) {
  const up = status.uptime?.[component.id] || {};
  const ticks = ticksFor(component.id, history);
  const reason = component.reason ? ` · ${component.reason}` : "";
  return `
    <article class="card">
      <div class="card-head">
        <div>
          <h2>${component.name}</h2>
          <p>${component.description || ""}${reason}</p>
        </div>
        <span class="pill ${component.status}">${component.status}</span>
      </div>
      <div class="ticks" title="Last 24 hours" aria-hidden="true">
        ${ticks.map((t) => `<span class="tick ${t}"></span>`).join("") || `<span class="tick"></span>`}
      </div>
      <div class="meta">
        <span>24h <b>${pct(up.h24)}</b></span>
        <span>7d <b>${pct(up.d7)}</b></span>
        <span>30d <b>${pct(up.d30)}</b></span>
        <span>Latency <b>${component.latencyMs != null ? `${component.latencyMs} ms` : "—"}</b></span>
      </div>
    </article>
  `;
}

async function loadJson(path) {
  const res = await fetch(`${path}?t=${Date.now()}`, { cache: "no-store" });
  if (!res.ok) throw new Error(`${path} HTTP ${res.status}`);
  return res.json();
}

async function render() {
  try {
    const [status, history] = await Promise.all([
      loadJson("./data/status.json"),
      loadJson("./data/history.json"),
    ]);
    $("#overall").textContent = LABELS[status.overall] || LABELS.unknown;
    $("#updated").textContent = `Updated ${relTime(status.generatedAt)} · ${status.generatedAt || ""}`;
    renderBanner(status);
    $("#components").innerHTML = (status.components || [])
      .map((c) => card(c, status, history))
      .join("");
    document.title =
      status.overall === "operational"
        ? "ConvoCircle Status"
        : `${LABELS[status.overall]} · ConvoCircle Status`;
  } catch (err) {
    $("#overall").textContent = LABELS.unknown;
    $("#updated").textContent = "";
    $("#components").innerHTML = `<div class="error">Could not load live status (${err.message}). The next GitHub Actions probe should refresh this page.</div>`;
  }
}

applyTheme();
$("#theme-toggle")?.addEventListener("click", () => {
  const now = document.documentElement.classList.contains("dark") ? "light" : "dark";
  localStorage.setItem(THEME_KEY, now);
  applyTheme(now);
});
render();
setInterval(render, 60_000);
