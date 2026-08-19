import { describe, it, expect } from 'vitest';
import type { Response } from 'express';
import { LEAGUES, league, seasonStartFor } from '../src/config/leagues';

describe('league registry', () => {
  it('registers all four leagues', () => {
    expect(Object.keys(LEAGUES).sort()).toEqual(['mlb', 'nba', 'nfl', 'nhl']);
  });

  it('maps each league to its own stats table and league id', () => {
    expect(LEAGUES.nba.statsTable).toBe('nba_player_stats');
    expect(LEAGUES.mlb.statsTable).toBe('mlb_player_stats');
    expect(LEAGUES.nhl.statsTable).toBe('nhl_player_stats');
    expect(LEAGUES.nfl.statsTable).toBe('nfl_player_stats');
    expect(LEAGUES.nba.leagueId).toBe(1);
    expect(LEAGUES.mlb.leagueId).toBe(2);
    expect(LEAGUES.nfl.leagueId).toBe(3);
    expect(LEAGUES.nhl.leagueId).toBe(4);
  });

  it('maps every league to its own trends table', () => {
    expect(LEAGUES.nba.trendsTable).toBe('nba_trends');
    expect(LEAGUES.mlb.trendsTable).toBe('mlb_trends');
    // NFL and NHL trends are produced by analytics/batch/compute_trends.py.
    expect(LEAGUES.nfl.trendsTable).toBe('nfl_trends');
    expect(LEAGUES.nhl.trendsTable).toBe('nhl_trends');
  });

  it('declares trend stat names for every valid stat id', () => {
    for (const cfg of Object.values(LEAGUES)) {
      if (!cfg.trendsTable) continue;
      for (const id of cfg.validStatIds) {
        expect(cfg.trendStatNames[id], `${cfg.slug} stat ${id}`).toBeTruthy();
      }
    }
  });

  it('encodes trend stat ids consistently with statConfig', () => {
    // The batch jobs write `stat` using the statConfig ids, so a mismatch here
    // means the API would label a trend with the wrong stat.
    for (const cfg of Object.values(LEAGUES)) {
      if (!cfg.trendsTable) continue;
      const configured = Object.values(cfg.statConfig).map((s) => s.statId);
      for (const id of cfg.validStatIds) {
        expect(configured, `${cfg.slug} stat ${id}`).toContain(id);
      }
    }
  });

  it('gates nhl on time on ice and nfl on no gate column', () => {
    expect(LEAGUES.nhl.playedGate?.col).toBe('toi_seconds');
    expect(LEAGUES.nfl.playedGate).toBeNull();
  });

  it('selects game_date and team_id in every playerGameSelect', () => {
    for (const cfg of Object.values(LEAGUES)) {
      expect(cfg.playerGameSelect).toContain('game_date');
      expect(cfg.playerGameSelect).toContain('team_id');
    }
  });

  it('falls back to nba when no league is on res.locals', () => {
    expect(league({ locals: {} } as Response).slug).toBe('nba');
  });

  // NHL and NFL rows were ingested with game_type 'other'; NBA/MLB use their own
  // vocabularies. Hardcoding one list in the controller silently returns zero
  // games for the leagues that do not share it.
  it('declares the game types each league actually stores', () => {
    expect(LEAGUES.nba.gameTypes).toEqual(['regular', 'playoff', 'playin']);
    expect(LEAGUES.mlb.gameTypes).toEqual(['regular', 'postseason']);
    expect(LEAGUES.nhl.gameTypes).toContain('other');
    expect(LEAGUES.nfl.gameTypes).toContain('other');
  });

  it('declares the calendar month each season starts in', () => {
    expect(LEAGUES.nba.seasonStartMonth).toBe(10);
    expect(LEAGUES.mlb.seasonStartMonth).toBe(1);
    expect(LEAGUES.nhl.seasonStartMonth).toBe(10);
    // NFL kicks off in September; an October floor drops week 1-4.
    expect(LEAGUES.nfl.seasonStartMonth).toBe(9);
  });
});

describe('seasonStartFor', () => {
  // 2026-07-31: NBA/NHL/NFL are between seasons, MLB is mid-season.
  const summer = new Date('2026-07-31T12:00:00Z');

  it('rolls back to last autumn for leagues whose season has not started', () => {
    expect(seasonStartFor(LEAGUES.nba, summer)).toBe('2025-10-01');
    expect(seasonStartFor(LEAGUES.nhl, summer)).toBe('2025-10-01');
    expect(seasonStartFor(LEAGUES.nfl, summer)).toBe('2025-09-01');
  });

  it('uses the current calendar year for mlb', () => {
    expect(seasonStartFor(LEAGUES.mlb, summer)).toBe('2026-01-01');
  });

  it('uses the current year once the season has begun', () => {
    const november = new Date('2026-11-15T12:00:00Z');
    expect(seasonStartFor(LEAGUES.nba, november)).toBe('2026-10-01');
    expect(seasonStartFor(LEAGUES.nfl, november)).toBe('2026-09-01');
  });
});
