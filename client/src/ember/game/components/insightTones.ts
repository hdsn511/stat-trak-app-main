// Shared colour language for the game view. Green = favourable (an over, a
// soft defense, a hit), red = unfavourable, ember = the app's accent, and each
// team's brand colour tags whose row it is.
export const GOOD = '#3FBF7F'
export const BAD = '#FF6B5C'
export const WARN = '#FFB020'
export const EMBER = '#FF6B3D'

export const pct = (v: number) => `${Math.round(v * 100)}%`
export const cents = (v: number | null | undefined) => (v == null ? null : `${Math.round(v * 100)}%`)
export const signedPct = (v: number) => `${v > 0 ? '+' : ''}${Math.round(v * 100)}%`
