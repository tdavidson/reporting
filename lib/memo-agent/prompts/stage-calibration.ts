/**
 * Stage-calibration guidance injected into ingest, research, draft, and score
 * prompts so the agent's expectations match the company's funding stage.
 *
 * Partner feedback (2026-05): memos read far too harsh for pre-seed/seed —
 * like a late-stage or public-market investor demanding data a company at
 * that stage cannot reasonably be expected to have. This block recalibrates
 * the agent to judge stage-appropriately.
 */
export function stageCalibrationBlock(stage: string | null | undefined): string {
  const s = (stage ?? '').toLowerCase()
  // 'seed' also matches 'pre_seed' — both are early; that's intended.
  const isEarly =
    s === '' ||
    s.includes('seed') ||
    s.includes('angel') ||
    s.includes('pre')
  const label = stage ? stage.replace(/_/g, ' ') : 'early-stage'

  if (isEarly) {
    return `=== INVESTMENT STAGE CALIBRATION (${label}) ===
This is an early-stage (${label}) company. Calibrate every expectation to that:
- The company will NOT have audited financials, cohort retention curves,
  detailed unit economics, a multi-year operating history, or a large
  customer base. Their absence is NORMAL. Do not flag it as a gap, a
  weakness, or a blocker, and do not score the company down for it.
- Judge what a company at this stage genuinely should have: a clear thesis,
  evidence of founder-market fit, early signal (design partners, a prototype,
  letters of intent, a waitlist, hand-built traction), and a credible plan.
  Evaluate the quality of the thinking and the team — not the completeness of
  the data room.
- A memo at this stage is an argument about a few high-conviction bets made
  under genuine uncertainty — not an audit. Treat uncertainty as expected.
  Focus on whether the upside case is credible and whether this team can
  execute it, not on what is unknowable today.`
  }

  return `=== INVESTMENT STAGE CALIBRATION (${label}) ===
This is a ${label} company. Hold it to stage-appropriate expectations —
metrics, traction, and operating history should be evaluated against what a
${label} company should realistically have demonstrated by now, neither
lenient nor demanding beyond the stage.`
}
