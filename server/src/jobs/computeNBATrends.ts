import { supabaseAdmin } from "../config/supabaseAdmin";

//globals
type PlayerGameStat = {
  game_id: number;
  player_id: number;
  team_id: number;
  points: number;
  rebounds: number;
  assists: number;
  three_points_made: number;
  fouls: number;
  minutes_played: number;
  game_date: string | null;
};

type TrendRow = {
  player_id: number;
  stat: number; // smallint in DB
  window_size: number; // smallint in DB
  trend_val: number; // z-score
  rolling_avg: number;
  season_avg: number;
  season_std: number;
  // computed_at omitted because DB default now()
};

//stat mapping + min thresholds for data quality
const STAT_CONFIGS = [
  {
    statId: 0,
    name: "points",
    selector: (g: PlayerGameStat) => g.points,
    minSeasonStd: 2,
    minRollingAvg: 8,
    minAvgMinutes: 16,
  },
  {
    statId: 1,
    name: "rebounds",
    selector: (g: PlayerGameStat) => g.rebounds,
    minSeasonStd: 1,
    minRollingAvg: 3,
    minAvgMinutes: 16,
  },
  {
    statId: 2,
    name: "assists",
    selector: (g: PlayerGameStat) => g.assists,
    minSeasonStd: 1,
    minRollingAvg: 2,
    minAvgMinutes: 16,
  },
  {
    statId: 3,
    name: "threes",
    selector: (g: PlayerGameStat) => g.three_points_made,
    minSeasonStd: 0.5,
    minRollingAvg: 1,
    minAvgMinutes: 16,
  },
  {
    statId: 4,
    name: "fouls",
    selector: (g: PlayerGameStat) => g.fouls,
    minSeasonStd: 0.5,
    minRollingAvg: 1,
    minAvgMinutes: 16,
  },
  {
    statId: 5,
    name: "minutes",
    selector: (g: PlayerGameStat) => g.minutes_played,
    minSeasonStd: 3,
    minRollingAvg: 10,
    minAvgMinutes: 0,
  },
] as const;

//ETL
async function loadPlayers(): Promise<number[]> {
  const { data, error } = await supabaseAdmin
    .from("players")
    .select("id")
    .eq("league", "nba")
    .eq("is_active", true);
  if (error) throw error;

  return data.map((player) => player.id);
}

async function loadPlayerStats(playerIds: number[]): Promise<PlayerGameStat[]> {
  if (playerIds.length === 0) return [];

  const CHUNK_SIZE = 50;
  const allStats: PlayerGameStat[] = [];

  for (let i = 0; i < playerIds.length; i += CHUNK_SIZE) {
    const chunk = playerIds.slice(i, i + CHUNK_SIZE);
    const { data, error } = await supabaseAdmin
      .from("nba_player_stats")
      .select("*")
      .in("player_id", chunk)
      .order("game_date", { ascending: false });

    if (error) throw error;
    if (data) allStats.push(...(data as PlayerGameStat[]));
  }

  return allStats;
}

function groupByPlayer(stats: PlayerGameStat[]): Map<number, PlayerGameStat[]> {
  const map = new Map<number, PlayerGameStat[]>();

  for (const stat of stats) {
    if (!map.has(stat.player_id)) {
      map.set(stat.player_id, []);
    }
    map.get(stat.player_id)!.push(stat);
  }

  return map;
}

//computation functions
function mean(values: number[]): number {
  const total = values.reduce((sum, val) => sum + val, 0);
  return total / values.length;
}

function stdDev(values: number[], avg: number): number {
  const variance =
    values.reduce((sum, v) => sum + Math.pow(v - avg, 2), 0) / values.length;

  return Math.sqrt(variance);
}

function computeZscores(
  games: PlayerGameStat[],
  statSelector: (stat: PlayerGameStat) => number,
  windows: number[] = [3, 5, 10],
  opts?: {
    minSeasonGames?: number;
    minSeasonStd?: number;
    minRollingAvg?: number;
    zCap?: number;
  }
) {
  const minSeasonGames = opts?.minSeasonGames ?? 10;
  const minSeasonStd = opts?.minSeasonStd ?? 0; // 0 = no std floor
  const minRollingAvg = opts?.minRollingAvg ?? -Infinity; // allow any by default
  const zCap = opts?.zCap; // undefined = no cap

  // Compute z-scores for player stats
  const values = games.map(statSelector);

  if (values.length < minSeasonGames) return [];

  const seasonAvg = mean(values);
  const seasonStd = stdDev(values, seasonAvg);

  if (seasonStd === 0) return [];
  if (seasonStd < minSeasonStd) return [];

  return windows
    .filter((w) => games.length >= w)
    .map((w) => {
      const rollingValues = values.slice(0, w);
      const rollingAvg = mean(rollingValues);
      if (rollingAvg < minRollingAvg) {
        return null;
      }
      let zScore = (rollingAvg - seasonAvg) / seasonStd;
      if (zCap !== undefined) {
        zScore = Math.max(Math.min(zScore, zCap), -zCap);
      }
      return {
        window: w,
        rollingAvg,
        seasonAvg,
        seasonStd,
        zScore,
      };
    })
    .filter((x): x is NonNullable<typeof x> => x !== null); //remove skipped windows
}

export async function computeTrends() {
  const playerIds = await loadPlayers();
  const stats = await loadPlayerStats(playerIds);
  const statsByPlayer = groupByPlayer(stats);

  const trendRows: TrendRow[] = [];

  //for each player, compute trends for each stat with min thresholds
  for (const playerId of playerIds) {
    const playerGames = statsByPlayer.get(playerId) || [];
    //skip players with less than 10 games
    if (!playerGames || playerGames.length < 10) continue;

    const avgMinLast5 = mean(
      playerGames.slice(0, 5).map((g) => g.minutes_played)
    );

    const WINDOWS = [3, 5, 10];
    const BASE_OPTS = { minSeasonGames: 10, zCap: 4 };

    for (const config of STAT_CONFIGS) {
      if (avgMinLast5 < config.minAvgMinutes) continue;

      const zResults = computeZscores(playerGames, config.selector, WINDOWS, {
        ...BASE_OPTS,
        minSeasonStd: config.minSeasonStd,
        minRollingAvg: config.minRollingAvg,
      });

      for (const r of zResults) {
        trendRows.push({
          player_id: playerId,
          stat: config.statId,
          window_size: r.window,
          trend_val: r.zScore,
          rolling_avg: r.rollingAvg,
          season_avg: r.seasonAvg,
          season_std: r.seasonStd,
        });
      }
    }
  }


  //upsert to DB
  if (trendRows.length === 0) return;

  await supabaseAdmin.from("nba_trends").upsert(trendRows, {
    onConflict: "player_id,stat,window_size",
  });
}
