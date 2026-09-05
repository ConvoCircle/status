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
import { classifyCi, pickNewer, workflowToComponent, CI_COMPONENTS } from "./ci.mjs";
import { scenarioChipsHtml, scenarioMechanicalPassed } from "./assets/scenario-chips.mjs";

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

  it("does not fail overall when CI has not run yet", () => {
    const http = COMPONENTS.map((c) => ({
      id: c.id,
      name: c.name,
      status: "operational",
      reason: null,
      latencyMs: 80,
      httpStatus: 200,
      checkedAt: "2026-09-05T15:00:00.000Z",
    }));
    const pending = workflowToComponent(CI_COMPONENTS[0], null, new Date("2026-09-05T15:00:00.000Z"));
    assert.equal(pending.status, "unknown");
    const snap = buildSnapshot({
      results: [...http, pending],
      history: { v: 1, ids: [], samples: [] },
      now: new Date("2026-09-05T15:00:00.000Z"),
    });
    assert.equal(snap.status.overall, "operational");
  });

  it("keeps overall operational when the engine worked but she said no", () => {
    const http = COMPONENTS.map((c) => ({
      id: c.id,
      name: c.name,
      status: "operational",
      reason: null,
      latencyMs: 80,
      httpStatus: 200,
      checkedAt: "2026-09-05T15:00:00.000Z",
    }));
    const hourly = workflowToComponent(
      CI_COMPONENTS[0],
      {
        conclusion: "success",
        updatedAt: "2026-09-05T14:55:00.000Z",
        url: "https://github.com/ConvoCircle/socialTrainer/actions/runs/8",
        outcomes: [
          { id: "rizz-invite-over", desiredOutcome: "invite_accepted", outcomeAchieved: false, mechanicalPass: true },
        ],
      },
      new Date("2026-09-05T15:00:00.000Z"),
    );
    assert.equal(hourly.status, "operational");
    // Feed may still carry social flags; public chips ignore them.
    assert.equal(hourly.outcomes[0].outcomeAchieved, false);
    assert.equal(scenarioMechanicalPassed(hourly.outcomes[0], hourly), true);
    const chips = scenarioChipsHtml(hourly);
    assert.match(chips, /rizz-invite-over · <b>Passed<\/b>/);
    assert.doesNotMatch(chips, /Invite accepted|accepted:|<\/b>yes|<\/b>no/i);
    const snap = buildSnapshot({
      results: [...http, hourly],
      history: { v: 1, ids: [], samples: [] },
      now: new Date("2026-09-05T15:00:00.000Z"),
    });
    assert.equal(snap.status.overall, "operational");
  });

  it("goes down when the latest hourly scenario job failed — not all-green", () => {
    const http = COMPONENTS.map((c) => ({
      id: c.id,
      name: c.name,
      description: c.description,
      status: "operational",
      reason: null,
      latencyMs: 80,
      httpStatus: 200,
      checkedAt: "2026-09-05T15:00:00.000Z",
    }));
    const hourly = workflowToComponent(
      CI_COMPONENTS[0],
      {
        conclusion: "failure",
        updatedAt: "2026-09-05T14:55:00.000Z",
        url: "https://github.com/ConvoCircle/socialTrainer/actions/runs/9",
      },
      new Date("2026-09-05T15:00:00.000Z"),
    );
    assert.equal(hourly.status, "down");
    const snap = buildSnapshot({
      results: [...http, hourly],
      history: { v: 1, ids: [...COMPONENTS.map((c) => c.id), hourly.id], samples: [] },
      now: new Date("2026-09-05T15:00:00.000Z"),
    });
    assert.equal(snap.status.overall, "down");
    assert.match(snap.status.incident.summary, /Hourly scenarios/);
  });
});

describe("public scenario chips", () => {
  it("renders Passed/Failed and never invite/date/come-on yes/no", () => {
    const html = scenarioChipsHtml({
      status: "operational",
      outcomes: [
        { id: "brash-come-on", desiredOutcome: "come_on_accepted", outcomeAchieved: false },
        { id: "meek-hesitant", desiredOutcome: "date_accepted", outcomeAchieved: true },
        { id: "rizz-invite-over", desiredOutcome: "invite_accepted", outcomeAchieved: false },
      ],
    });
    assert.match(html, /brash-come-on · <b>Passed<\/b>/);
    assert.match(html, /meek-hesitant · <b>Passed<\/b>/);
    assert.match(html, /rizz-invite-over · <b>Passed<\/b>/);
    assert.doesNotMatch(html, /Invite accepted|Come-on accepted|Date accepted|accepted:/i);
    assert.doesNotMatch(html, /<b>yes<\/b>|<b>no<\/b>/i);
  });

  it("uses mechanicalPass when present, even if the hourly card is down", () => {
    const html = scenarioChipsHtml({
      status: "down",
      outcomes: [
        { id: "rizz-invite-over", mechanicalPass: true, outcomeAchieved: false },
        { id: "meek-hesitant", mechanicalPass: false, outcomeAchieved: true },
      ],
    });
    assert.match(html, /rizz-invite-over · <b>Passed<\/b>/);
    assert.match(html, /meek-hesitant · <b>Failed<\/b>/);
  });
});

describe("prod CI feed", () => {
  it("classifies a failed hourly run as down", () => {
    const got = classifyCi({
      conclusion: "failure",
      updatedAt: "2026-09-05T14:50:00.000Z",
      now: new Date("2026-09-05T15:00:00.000Z"),
    });
    assert.equal(got.status, "down");
  });

  it("prefers the newer of Actions API vs committed feed", () => {
    const older = { id: "hourly-prod-scenarios", updatedAt: "2026-09-05T13:00:00.000Z", conclusion: "success" };
    const newer = { id: "hourly-prod-scenarios", updatedAt: "2026-09-05T14:50:00.000Z", conclusion: "failure" };
    assert.equal(pickNewer(older, newer).conclusion, "failure");
  });
});
