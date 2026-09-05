import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  STATUS,
  classify,
  overallFromCodes,
  trimHistory,
  uptimePct,
  incidentFrom,
  buildSnapshot,
  COMPONENTS,
} from "./probe.mjs";

describe("classify", () => {
  it("marks web operational when HTML + hashed bundle are present", () => {
    const got = classify({
      kind: "web",
      httpStatus: 200,
      body: '<!DOCTYPE html><script src="/assets/index-AbC123.js"></script>',
      latencyMs: 120,
    });
    assert.equal(got.status, "operational");
  });

  it("marks web down without a hashed bundle", () => {
    const got = classify({
      kind: "web",
      httpStatus: 200,
      body: "<!DOCTYPE html><p>maintenance</p>",
      latencyMs: 80,
    });
    assert.equal(got.status, "down");
    assert.match(got.reason, /bundle/i);
  });

  it("marks proxy operational on {ok:true}", () => {
    const got = classify({
      kind: "proxy",
      httpStatus: 200,
      body: '{"ok":true,"keyConfigured":true}',
      latencyMs: 90,
    });
    assert.equal(got.status, "operational");
  });

  it("marks slow 2xx as degraded", () => {
    const got = classify({
      kind: "proxy",
      httpStatus: 200,
      body: '{"status":"ok"}',
      latencyMs: 6000,
    });
    assert.equal(got.status, "degraded");
  });

  it("marks HTTP 503 as down", () => {
    const got = classify({
      kind: "proxy",
      httpStatus: 503,
      body: "unavailable",
      latencyMs: 40,
    });
    assert.equal(got.status, "down");
  });
});

describe("history + uptime", () => {
  it("trims samples older than 30d", () => {
    const now = 1_700_000_000;
    const old = [now - 40 * 86400, [0, 0, 0, 0, 0]];
    const keep = [now - 2 * 86400, [0, 0, 2, 0, 0]];
    assert.deepEqual(trimHistory([old, keep], now), [keep]);
  });

  it("counts non-down samples as uptime", () => {
    const now = 1_000_000;
    const samples = [
      [now - 10, [0, 2, 0, 0, 0]],
      [now - 5, [0, 1, 0, 0, 0]],
      [now - 1, [0, 0, 0, 0, 0]],
    ];
    assert.equal(uptimePct(samples, 0, now, 3600), 100);
    assert.equal(uptimePct(samples, 1, now, 3600), 66.7);
  });
});

describe("incident + snapshot", () => {
  it("opens an incident when any component is down and clears it on recovery", () => {
    const down = incidentFrom(
      [{ name: "Web", status: "down" }, { name: "Gemini", status: "operational" }],
      null,
      "2026-09-05T10:00:00.000Z",
    );
    assert.equal(down.active, true);
    assert.equal(down.summary, "Web is down");
    assert.equal(incidentFrom([{ name: "Web", status: "operational" }], down, "2026-09-05T10:10:00.000Z"), null);
  });

  it("keeps the original startedAt while the incident stays active", () => {
    const prev = {
      active: true,
      startedAt: "2026-09-05T09:00:00.000Z",
      components: ["Web"],
      summary: "Web is down",
    };
    const next = incidentFrom(
      [{ name: "Web", status: "down" }],
      prev,
      "2026-09-05T10:00:00.000Z",
    );
    assert.equal(next.startedAt, "2026-09-05T09:00:00.000Z");
  });

  it("builds a public snapshot without leaking proxy bodies", () => {
    const results = COMPONENTS.map((c, i) => ({
      id: c.id,
      name: c.name,
      description: c.description,
      status: i === 0 ? "down" : "operational",
      reason: i === 0 ? "HTTP 503" : null,
      latencyMs: 100,
      httpStatus: i === 0 ? 503 : 200,
      checkedAt: "2026-09-05T10:00:00.000Z",
    }));
    const snap = buildSnapshot({
      results,
      history: { v: 1, ids: COMPONENTS.map((c) => c.id), samples: [] },
      now: new Date("2026-09-05T10:00:00.000Z"),
    });
    assert.equal(snap.status.overall, "down");
    assert.equal(snap.status.incident.summary, "Web is down");
    const dumped = JSON.stringify(snap);
    assert.equal(dumped.includes("keyConfigured"), false);
    assert.equal(dumped.includes("hasStripeKey"), false);
    assert.equal(overallFromCodes([STATUS.operational, STATUS.degraded]), "degraded");
  });
});
