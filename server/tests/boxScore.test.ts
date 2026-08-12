import { describe, it, expect } from 'vitest';
import { LEAGUES, LeagueSlug } from '../src/config/leagues';

// The game controller is fully driven by these descriptors — it never names a
// sport-specific column — so a malformed entry here silently produces an empty
// or wrong box score rather than a crash.

const SLUGS = Object.keys(LEAGUES) as LeagueSlug[];

describe('box score registry', () => {
  it.each(SLUGS)('%s declares at least one group', (slug) => {
    expect(LEAGUES[slug].boxScore.groups.length).toBeGreaterThan(0);
  });

  it.each(SLUGS)('%s selects every column its groups render', (slug) => {
    const cfg = LEAGUES[slug];
    // The select list is a comma-joined SQL projection.
    const selected = new Set(cfg.boxScore.select.split(',').map((c) => c.trim()));

    for (const group of cfg.boxScore.groups) {
      expect(selected, `${slug}/${group.id} gate`).toContain(group.gate);
      expect(selected, `${slug}/${group.id} sortBy`).toContain(group.sortBy);
      for (const col of group.columns) {
        expect(selected, `${slug}/${group.id} column ${col.key}`).toContain(col.key);
      }
    }
  });

  it.each(SLUGS)('%s uses unique group ids', (slug) => {
    const ids = LEAGUES[slug].boxScore.groups.map((g) => g.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it.each(SLUGS)('%s gives every column a label', (slug) => {
    for (const group of LEAGUES[slug].boxScore.groups) {
      for (const col of group.columns) {
        expect(col.label.length, `${slug}/${group.id}/${col.key}`).toBeGreaterThan(0);
      }
    }
  });

  it('splits mlb into batting and pitching', () => {
    expect(LEAGUES.mlb.boxScore.groups.map((g) => g.id)).toEqual(['batting', 'pitching']);
  });

  it('splits nfl by phase of play', () => {
    expect(LEAGUES.nfl.boxScore.groups.map((g) => g.id)).toEqual([
      'passing',
      'rushing',
      'receiving',
      'defense',
      'kicking',
    ]);
  });

  it('marks only nba and mlb as having a betting pipeline', () => {
    expect(LEAGUES.nba.hasMarkets).toBe(true);
    expect(LEAGUES.mlb.hasMarkets).toBe(true);
    expect(LEAGUES.nhl.hasMarkets).toBe(false);
    expect(LEAGUES.nfl.hasMarkets).toBe(false);
  });
});

describe('regular season type', () => {
  it.each(SLUGS)('%s regularSeasonType is one of its gameTypes', (slug) => {
    expect(LEAGUES[slug].gameTypes).toContain(LEAGUES[slug].regularSeasonType);
  });

  it("uses ESPN's 'other' label for the leagues ingested without game types", () => {
    // Standings would be empty for these if they filtered on 'regular'.
    expect(LEAGUES.nhl.regularSeasonType).toBe('other');
    expect(LEAGUES.nfl.regularSeasonType).toBe('other');
    expect(LEAGUES.nba.regularSeasonType).toBe('regular');
    expect(LEAGUES.mlb.regularSeasonType).toBe('regular');
  });
});
