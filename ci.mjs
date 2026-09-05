/**
 * Latest socialTrainer prod CI → status components (CON-27).
 * Public JSON only. Polls GitHub Actions when SOCIALTRAINER_ACTIONS_TOKEN
 * (or GH_TOKEN with actions:read on socialTrainer) is set; otherwise uses
 * data/ci-feed.json committed by socialTrainer after each prod run.
 */
import { readFile } from "node:fs/promises";
import { join } from "node:path";

export const SOCIALTRAINER_REPO = "ConvoCircle/socialTrainer";
export const GH_API = "https://api.github.com";

export const CI_COMPONENTS = [
  {
    id: "hourly-prod-scenarios",
    name: "Hourly scenarios",
    description: "Mechanical LLM health (rizz / brash / meek) — not whether she said yes",
    workflowFile: "hourly-prod-scenarios.yml",
    staleAfterMs: 3 * 3600 * 1000,
  },
  {
    id: "nightly-prod",
    name: "Nightly LLM probe",
    description: "Scheduled production conversation",
    workflowFile: "nightly-prod.yml",
    staleAfterMs: 36 * 3600 * 1000,
  },
  {
    id: "prod-health",
    name: "Health probe (Actions)",
    description: "socialTrainer production health workflow",
    workflowFile: "prod-health.yml",
    staleAfterMs: 45 * 60 * 1000,
  },
];

export function classifyCi({ conclusion, updatedAt, now = new Date(), staleAfterMs = 3 * 3600 * 1000 }) {
  const updated = updatedAt ? new Date(updatedAt).getTime() : 0;
  const stale = updated > 0 && now.getTime() - updated > staleAfterMs;
  if (conclusion === "failure") {
    return { status: "down", reason: stale ? "Latest run failed (and is stale)" : "Latest run failed" };
  }
  if (conclusion === "success") {
    if (stale) return { status: "degraded", reason: "Last successful run is stale" };
    return { status: "operational", reason: null };
  }
  if (!conclusion) return { status: "unknown", reason: "No completed run yet" };
  if (stale) return { status: "degraded", reason: `Last run ${conclusion} (stale)` };
  return { status: "degraded", reason: `Last run ${conclusion}` };
}

export function pickNewer(a, b) {
  const ta = a?.updatedAt ? new Date(a.updatedAt).getTime() : 0;
  const tb = b?.updatedAt ? new Date(b.updatedAt).getTime() : 0;
  if (tb > ta) return b;
  if (ta > tb) return a;
  if (b && !a) return b;
  return a || b || null;
}

export async function readCiFeed(dataDir) {
  try {
    const raw = JSON.parse(await readFile(join(dataDir, "ci-feed.json"), "utf8"));
    return Array.isArray(raw.workflows) ? raw.workflows : [];
  } catch {
    return [];
  }
}

export async function fetchWorkflowRun(component, { token, fetchImpl = fetch } = {}) {
  const url = `${GH_API}/repos/${SOCIALTRAINER_REPO}/actions/workflows/${component.workflowFile}/runs?per_page=5&status=completed`;
  const headers = {
    accept: "application/vnd.github+json",
    "user-agent": "convocircle-status-probe",
  };
  if (token) headers.authorization = `Bearer ${token}`;
  const res = await fetchImpl(url, { headers });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`GitHub ${res.status} ${component.workflowFile}: ${body.slice(0, 160)}`);
  }
  const data = await res.json();
  const run = (data.runs || []).find((r) => r.conclusion && r.conclusion !== "cancelled") || data.runs?.[0];
  if (!run) return null;
  return {
    id: component.id,
    name: component.name,
    description: component.description,
    conclusion: run.conclusion,
    updatedAt: run.updated_at || run.created_at,
    url: run.html_url,
    summary: run.display_title || run.name || null,
  };
}

export function workflowToComponent(meta, row, now = new Date()) {
  const classified = classifyCi({
    conclusion: row?.conclusion ?? null,
    updatedAt: row?.updatedAt ?? null,
    now,
    staleAfterMs: meta.staleAfterMs,
  });
  return {
    id: meta.id,
    name: meta.name,
    description: meta.description,
    kind: "ci",
    status: classified.status,
    reason: row?.reason || classified.reason,
    latencyMs: null,
    httpStatus: null,
    checkedAt: now.toISOString(),
    updatedAt: row?.updatedAt || null,
    url: row?.url || `https://github.com/${SOCIALTRAINER_REPO}/actions/workflows/${meta.workflowFile}`,
    conclusion: row?.conclusion || null,
    summary: row?.summary || null,
    outcomes: row?.outcomes || null,
  };
}

export async function collectCiComponents({
  dataDir,
  token = process.env.SOCIALTRAINER_ACTIONS_TOKEN || "",
  fetchImpl = fetch,
  now = new Date(),
  log = console.log,
} = {}) {
  const fromFile = await readCiFeed(dataDir);
  const fromApi = [];
  if (token) {
    for (const meta of CI_COMPONENTS) {
      try {
        const row = await fetchWorkflowRun(meta, { token, fetchImpl });
        if (row) fromApi.push(row);
      } catch (err) {
        log(`[status-probe] ci ${meta.id} github: ${err.message}`);
      }
    }
  } else {
    log("[status-probe] ci: no SOCIALTRAINER_ACTIONS_TOKEN — using ci-feed.json only");
  }

  return CI_COMPONENTS.map((meta) => {
    const fileRow = fromFile.find((w) => w.id === meta.id);
    const apiRow = fromApi.find((w) => w.id === meta.id);
    const newer = pickNewer(fileRow, apiRow);
    const row = newer
      ? { ...newer, outcomes: newer.outcomes || fileRow?.outcomes || apiRow?.outcomes || null }
      : null;
    const component = workflowToComponent(meta, row, now);
    log(
      `[status-probe] ${component.id} ${component.status} conclusion=${component.conclusion || "—"}`,
    );
    return component;
  });
}
