/**
 * Public status chips: mechanical Passed / Failed only.
 * Social outcome flags (invite / come-on / date accepted) stay in the feed
 * for analytics and must never be rendered on the public page.
 */

export function scenarioMechanicalPassed(row, component) {
  if (row?.mechanicalPass === true) return true;
  if (row?.mechanicalPass === false) return false;
  // Outcomes may only carry social flags; presence on a healthy hourly card is Passed.
  return component?.status === "operational";
}

export function scenarioChipsHtml(component) {
  const rows = component?.outcomes;
  if (!Array.isArray(rows) || !rows.length) return "";
  return `
    <div class="outcomes" aria-label="Mechanical scenario results">
      ${rows
        .map((row) => {
          const passed = scenarioMechanicalPassed(row, component);
          const id = row?.id || "scenario";
          return `<span class="outcome-chip ${passed ? "pass" : "fail"}">${id} · <b>${passed ? "Passed" : "Failed"}</b></span>`;
        })
        .join("")}
    </div>
  `;
}
