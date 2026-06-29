// Spread picks store the run line in the model's "team wins by more than L"
// convention: L > 0 = favorite laying runs (e.g. stored 1.5 → team -1.5), and
// L < 0 = underdog getting a cushion (e.g. stored -1.5 → team +1.5). The
// bettor-facing line for the team is the negation. Render with an explicit
// sign so it is never ambiguous: "ATL -1.5" (lays) vs "COL +1.5" (gets runs).
export function formatSpreadLine(team: string | null | undefined, storedLine: number): string {
  const betting = -storedLine
  const body = `${betting > 0 ? '+' : '-'}${Math.abs(betting)}`
  return team ? `${team} ${body}` : body
}
