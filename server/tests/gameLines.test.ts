import { describe, expect, it } from 'vitest';
import { parseEspnLines } from '../src/services/gameLines';

describe('parseEspnLines', () => {
  it('prefers DraftKings, reads the home spread and the total', () => {
    const lines = parseEspnLines([
      { provider: { name: 'Caesars Sportsbook' }, homeTeamOdds: { current: { pointSpread: { american: '-2.0' } } }, overUnder: 229 },
      { provider: { name: 'DraftKings' }, homeTeamOdds: { close: { pointSpread: { american: '-1.5' } } }, overUnder: 228.5 },
    ]);
    expect(lines).toEqual({ provider: 'DraftKings', spread_home: -1.5, total: 228.5 });
  });

  it('falls back to the bare spread, signed by the favourite flag, and skips live lines', () => {
    const lines = parseEspnLines([
      { provider: { name: 'ESPN BET - Live Odds' }, homeTeamOdds: { current: { pointSpread: { american: '+9' } } } },
      { provider: { name: 'ESPN BET' }, spread: 3.5, homeTeamOdds: { favorite: false }, overUnder: '44.5' },
    ]);
    expect(lines).toEqual({ provider: 'ESPN BET', spread_home: 3.5, total: 44.5 });
  });

  it('returns null with no usable book', () => {
    expect(parseEspnLines([])).toBeNull();
  });
});
