#!/usr/bin/env node
/**
 * Public status probes for convocircle.ai + App Runner proxies.
 * Zero npm deps. Writes data/status.json and data/history.json.
 * Does not send owner alerts (CON-25 / prod-alert.sh stays the pager).
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { collectCiComponents } from "./ci.mjs";

export const UA = "convocircle-status-probe";
export const TIMEOUT_MS = 15_000;
export const DEGRADED_MS = 5_000;
export const HISTORY_DAYS = 30;
export const RETRY_WAIT_MS = 5_000;

export const COMPONENTS = [
  {
    id: "web",
    name: "Web",
    description: "https://convocircle.ai",
    url: "https://convocircle.ai",
    kind: "web",
  },
  {
    id: "gemini-proxy",
    name: "Gemini",
    description: "Conversation / LLM proxy",
    url: "https://aw5fewwcba.us-east-1.awsapprunner.com/health",
    kind: "proxy",
  },
  {
    id: "elevenlabs-proxy",
    name: "ElevenLabs",
    description: "Voice / TTS proxy",
    url: "https://d3v6ck6pnt.us-east-1.awsapprunner.com/health",
    kind: "proxy",
  },
  {
    id: "stripe-proxy",
    name: "Stripe",
    description: "Checkout / billing proxy",
    url: "https://xjmupy2vgu.us-east-1.awsapprunner.com/health",
    kind: "proxy",
  },
  {
    id: "openrouter-proxy",
    name: "OpenRouter",
    description: "OpenRouter proxy",
    url: "https://x43vfkbj3d.us-east-1.awsapprunner.com/health",
    kind: "proxy",
  },
];

export const STATUS = { operational: 0, degraded: 1, down: 2 };
export const STATUS_NAME = ["operational", "degraded", "down"];

const WEB_BUNDLE = /assets\/index-[A-Za-z0-9_-]+\.js/;
const PROXY_BODY = /ok|true|healthy|status/i;

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function trimHistory(samples, nowSec, keepDays = HISTORY_DAYS) {
  const cutoff = nowSec - keepDays * 86_400;
  return samples.filter((row) => Number(row?.[0]) >= cutoff);
}

/**
 * Remap one [ts, codes] row onto `toIds`. Missing ids stay undefined so
 * uptimePct skips them instead of counting a fake operational sample.
 */
export function remapSample(sample, fromIds, toIds) {
  const ts = Number(sample?.[0]);
  const codes = sample?.[1];
  if (!Number.isFinite(ts) || !Array.isArray(codes)) return null;
  if (!fromIds.length || fromIds.join("\0") === toIds.join("\0")) {
    return [ts, codes.slice()];
  }
  return [ts, toIds.map((id) => {
    const i = fromIds.indexOf(id);
    return i >= 0 ? codes[i] : undefined;
  })];
}

/**
 * Union two history snapshots after a git race.
 * `ours` is this run (wins ids / incident / same-timestamp samples).
 * `theirs` is origin after reset (keep its other samples).
 */
export function mergeHistories(ours, theirs, nowSec = Math.floor(Date.now() / 1000)) {
  const ids = Array.isArray(ours?.ids) && ours.ids.length ? ours.ids : (theirs?.ids || []);
  const byTs = new Map();
  for (const src of [theirs, ours]) {
    const fromIds = src?.ids || [];
    for (const row of src?.samples || []) {
      const remapped = remapSample(row, fromIds, ids);
      if (remapped) byTs.set(remapped[0], remapped);
    }
  }
  const samples = trimHistory(
    [...byTs.values()].sort((a, b) => a[0] - b[0]),
    nowSec,
  );
  return {
    v: 1,
    ids,
    incident: ours && "incident" in ours ? ours.incident : (theirs?.incident ?? null),
    lastIncident: ours && "lastIncident" in ours ? ours.lastIncident : (theirs?.lastIncident ?? null),
    samples,
  };
}

export async function mergeHistoryFiles(oursPath, theirsPath, outPath, nowSec) {
  const ours = await readJson(oursPath, { v: 1, ids: [], samples: [] });
  const theirs = await readJson(theirsPath, { v: 1, ids: [], samples: [] });
  const merged = mergeHistories(ours, theirs, nowSec);
  await writeFile(outPath, `${JSON.stringify(merged)}\n`);
  return merged;
}

export function overallFromCodes(codes) {
  if (codes.some((c) => c === STATUS.down)) return "down";
  if (codes.some((c) => c === STATUS.degraded)) return "degraded";
  return "operational";
}

export function uptimePct(samples, index, nowSec, windowSec) {
  const cutoff = nowSec - windowSec;
  let up = 0;
  let total = 0;
  for (const row of samples) {
    const t = Number(row?.[0]);
    const codes = row?.[1];
    if (!Number.isFinite(t) || t < cutoff || !Array.isArray(codes)) continue;
    const code = codes[index];
    if (code === undefined) continue;
    total += 1;
    if (code !== STATUS.down) up += 1;
  }
  if (total === 0) return null;
  return Math.round((up / total) * 1000) / 10;
}

export function incidentFrom(results, prevIncident, nowIso) {
  const down = results.filter((r) => r.status === "down").map((r) => r.name);
  if (down.length === 0) return null;
  const startedAt =
    prevIncident && Array.isArray(prevIncident.components) && prevIncident.active
      ? prevIncident.startedAt
      : nowIso;
  const list = down.join(", ");
  return {
    active: true,
    startedAt,
    components: down,
    summary: down.length === 1 ? `${list} is down` : `${list} are down`,
  };
}

function publicReason(kind, httpStatus, body, err) {
  if (err) {
    if (err.name === "TimeoutError" || /abort|timeout/i.test(String(err.message))) {
      return "Timed out";
    }
    return "Unreachable";
  }
  if (httpStatus < 200 || httpStatus >= 400) return `HTTP ${httpStatus}`;
  if (kind === "web") {
    if (!body.toLowerCase().includes("<!doctype html")) return "Missing HTML doctype";
    if (!WEB_BUNDLE.test(body)) return "Missing hashed JS bundle";
  } else if (!PROXY_BODY.test(body)) {
    return "Unexpected health body";
  }
  return null;
}

export function classify({ kind, httpStatus, body, latencyMs, error }) {
  const reason = publicReason(kind, httpStatus ?? 0, body ?? "", error);
  if (reason) return { status: "down", reason };
  if (latencyMs >= DEGRADED_MS) {
    return { status: "degraded", reason: `Slow response (${Math.round(latencyMs)} ms)` };
  }
  return { status: "operational", reason: null };
}

export async function fetchOnce(url) {
  const started = Date.now();
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      redirect: "follow",
      signal: ac.signal,
      headers: { "user-agent": UA, accept: "*/*" },
    });
    const body = await res.text();
    return { httpStatus: res.status, body, latencyMs: Date.now() - started, error: null };
  } catch (error) {
    return { httpStatus: 0, body: "", latencyMs: Date.now() - started, error };
  } finally {
    clearTimeout(timer);
  }
}

export async function probeComponent(component, { retry = true } = {}) {
  let attempt = await fetchOnce(component.url);
  let classified = classify({ kind: component.kind, ...attempt });
  if (classified.status === "down" && retry) {
    await sleep(RETRY_WAIT_MS);
    attempt = await fetchOnce(component.url);
    classified = classify({ kind: component.kind, ...attempt });
  }
  return {
    id: component.id,
    name: component.name,
    description: component.description,
    status: classified.status,
    reason: classified.reason,
    latencyMs: attempt.latencyMs,
    httpStatus: attempt.httpStatus || null,
    checkedAt: new Date().toISOString(),
  };
}

async function readJson(path, fallback) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch {
    return fallback;
  }
}

export function buildSnapshot({ results, history, now }) {
  const nowIso = now.toISOString();
  const nowSec = Math.floor(now.getTime() / 1000);
  const ids = results.map((r) => r.id);
  const codes = results.map((r) => (r.status === "unknown" ? STATUS.operational : STATUS[r.status] ?? STATUS.down));
  const samples = trimHistory(
    [...(history.samples || []), [nowSec, codes]],
    nowSec,
  );
  const prevIncident = history.incident || null;
  const incident = incidentFrom(results, prevIncident, nowIso);
  const lastIncident =
    !incident && prevIncident
      ? { ...prevIncident, active: false, resolvedAt: nowIso }
      : history.lastIncident || null;

  const uptime = {};
  for (let i = 0; i < ids.length; i++) {
    uptime[ids[i]] = {
      h24: uptimePct(samples, i, nowSec, 86_400),
      d7: uptimePct(samples, i, nowSec, 7 * 86_400),
      d30: uptimePct(samples, i, nowSec, 30 * 86_400),
    };
  }

  const overall = overallFromCodes(codes);
  return {
    status: {
      generatedAt: nowIso,
      overall,
      components: results,
      incident,
      lastIncident: incident ? null : lastIncident,
      uptime,
    },
    history: {
      v: 1,
      ids,
      incident,
      lastIncident: incident ? lastIncident : lastIncident,
      samples,
    },
  };
}

export async function runProbe({ dataDir, retry = true, includeCi = true, now = new Date() } = {}) {
  const dir = dataDir || join(dirname(fileURLToPath(import.meta.url)), "data");
  await mkdir(dir, { recursive: true });
  const prevHistory = await readJson(join(dir, "history.json"), { v: 1, ids: [], samples: [] });
  const results = [];
  for (const component of COMPONENTS) {
    const row = await probeComponent(component, { retry });
    console.log(
      `[status-probe] ${row.id} ${row.status} http=${row.httpStatus ?? "—"} ${row.latencyMs}ms${
        row.reason ? ` (${row.reason})` : ""
      }`,
    );
    results.push({ ...row, kind: component.kind });
  }
  if (includeCi) {
    const ci = await collectCiComponents({ dataDir: dir, now });
    results.push(...ci);
  }
  const snapshot = buildSnapshot({ results, history: prevHistory, now });
  await writeFile(join(dir, "status.json"), `${JSON.stringify(snapshot.status, null, 2)}\n`);
  await writeFile(join(dir, "history.json"), `${JSON.stringify(snapshot.history)}\n`);
  return snapshot;
}

const isMain =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMain) {
  const cmd = process.argv[2];
  if (cmd === "merge-history") {
    const ours = process.argv[3];
    const theirs = process.argv[4];
    const out = process.argv[5] || ours;
    if (!ours || !theirs) {
      console.error("usage: probe.mjs merge-history <ours.json> <theirs.json> [out.json]");
      process.exit(2);
    }
    mergeHistoryFiles(ours, theirs, out).then((merged) => {
      console.log(`[status-probe] merged history ${theirs} + ${ours} -> ${out} (${merged.samples.length} samples)`);
    }).catch((err) => {
      console.error("[status-probe] merge-history failed", err);
      process.exit(1);
    });
  } else {
    const retry = process.env.STATUS_PROBE_RETRY !== "0";
    runProbe({ retry }).catch((err) => {
      console.error("[status-probe] fatal", err);
      process.exit(1);
    });
  }
}
