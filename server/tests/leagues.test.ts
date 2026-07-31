import { describe, it, expect } from 'vitest';
import type { Response } from 'express';
import { LEAGUES, league } from '../src/config/leagues';

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

  it('has no trends table for nfl and nhl', () => {
    expect(LEAGUES.nfl.trendsTable).toBeNull();
    expect(LEAGUES.nhl.trendsTable).toBeNull();
    expect(LEAGUES.nba.trendsTable).toBe('nba_trends');
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
});
