import { supabaseAdmin } from "../config/supabaseAdmin";

// MLB trends: z-score of a player's rolling batting average vs their season
// baseline, mirroring computeNBATrends.ts but for baseball. MLB seasons are a
// single calendar year, so the season boundary is Jan 1 of the current year.
function currentSeasonStart(): string {
  return `${new Date().getFullYear()}-01-01`;
}

type PlayerGameStat = {
  game_id: number;
  player_id: number;
  hits: number;
  total_bases: number;
  rbi: number;
  runs: number;
  home_runs: number;
  plate_appearances: number;
  game_date: string | null;
};

type TrendRow = {
  player_id: number;
  stat: number;
  window_size: number;
  trend_val: number;
  rolling_avg: number;
  season_avg: number;
  season_std: number;
};

// MLB stat mapping + data-quality thresholds. statIds are MLB-local.
const STAT_CONFIGS = [
  { statId: 0, name: "hits",        selector: (g: PlayerGameStat) => g.hits,        minSeasonStd: 0.6, minRollingAvg: 0.5 },
  { statId: 1, name: "total_bases", selector: (g: PlayerGameStat) => g.total_bases, minSeasonStd: 0.8, minRollingAvg: 0.8 },
  { statId: 2, name: "rbi",         selector: (g: PlayerGameStat) => g.rbi,         minSeasonStd: 0.6, minRollingAvg: 0.4 },
  { statId: 3, name: "runs",        selector: (g: PlayerGameStat) => g.runs,        minSeasonStd: 0.5, minRollingAvg: 0.4 },
  { statId: 4, name: "home_runs",   selector: (g: PlayerGameStat) => g.home_runs,   minSeasonStd: 0.3, minRollingAvg: 0.1 },
] as const;

async function loadPlayers(): Promise<number[]> {
  const { data, error } = await supabaseAdmin
    .from("players")
    .select("id")
    .eq("league", "mlb")
    .eq("is_active", true);
  if (error) throw error;
  return data.map((p) => p.id);
}

async function loadPlayerStats(playerIds: number[]): Promise<PlayerGameStat[]> {
  if (playerIds.length === 0) return [];
  const seasonStart = currentSeasonStart();
  const CHUNK_SIZE = 50;
  const all: PlayerGameStat[] = [];
  for (let i = 0; i < playerIds.length; i += CHUNK_SIZE) {
    const chunk = playerIds.slice(i, i + CHUNK_SIZE);
    const { data, error } = await supabaseAdmin
      .from("mlb_player_stats")
      .select(
        "game_id, player_id, hits, total_bases, rbi, runs, home_runs, plate_appearances, game_date, games!inner(game_type)"
      )
      .in("player_id", chunk)
      .gte("game_date", seasonStart)
      .in("games.game_type", ["regular", "postseason"])
      .gt("plate_appearances", 0)
      .order("game_date", { ascending: false });
    if (error) throw error;
    if (data) all.push(...(data as unknown as PlayerGameStat[]));
  }
  return all;
}

function groupByPlayer(stats: PlayerGameStat[]): Map<number, PlayerGameStat[]> {
  const map = new Map<number, PlayerGameStat[]>();
  for (const s of stats) {
    if (!map.has(s.player_id)) map.set(s.player_id, []);
    map.get(s.player_id)!.push(s);
  }
  return map;
}

function mean(values: number[]): number {
  return values.reduce((s, v) => s + v, 0) / values.length;
}
function stdDev(values: number[], avg: number): number {
  const variance = values.reduce((s, v) => s + Math.pow(v - avg, 2), 0) / values.length;
  return Math.sqrt(variance);
}

function computeZscores(
  games: PlayerGameStat[],
  statSelector: (s: PlayerGameStat) => number,
  windows: number[] = [3, 5, 10],
  opts?: { minSeasonGames?: number; minSeasonStd?: number; minRollingAvg?: number; zCap?: number }
) {
  const minSeasonGames = opts?.minSeasonGames ?? 10;
  const minSeasonStd = opts?.minSeasonStd ?? 0;
  const minRollingAvg = opts?.minRollingAvg ?? -Infinity;
  const zCap = opts?.zCap;

  const values = games.map(statSelector);
  if (values.length < minSeasonGames) return [];

  const seasonAvg = mean(values);
  const seasonStd = stdDev(values, seasonAvg);
  if (seasonStd === 0 || seasonStd < minSeasonStd) return [];

  return windows
    .filter((w) => games.length >= w)
    .map((w) => {
      const rollingAvg = mean(values.slice(0, w));
      if (rollingAvg < minRollingAvg) return null;
      let zScore = (rollingAvg - seasonAvg) / seasonStd;
      if (zCap !== undefined) zScore = Math.max(Math.min(zScore, zCap), -zCap);
      return { window: w, rollingAvg, seasonAvg, seasonStd, zScore };
    })
    .filter((x): x is NonNullable<typeof x> => x !== null);
}

export async function computeMLBTrends() {
  const playerIds = await loadPlayers();
  const stats = await loadPlayerStats(playerIds);
  const statsByPlayer = groupByPlayer(stats);

  const trendRows: TrendRow[] = [];
  for (const playerId of playerIds) {
    const games = statsByPlayer.get(playerId) || [];
    if (games.length < 10) continue;

    const WINDOWS = [3, 5, 10];
    const BASE_OPTS = { minSeasonGames: 10, zCap: 4 };

    for (const config of STAT_CONFIGS) {
      const zResults = computeZscores(games, config.selector, WINDOWS, {
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

  if (trendRows.length === 0) return;
  await supabaseAdmin.from("mlb_trends").delete().neq("player_id", 0);
  await supabaseAdmin.from("mlb_trends").insert(trendRows);
}

// Allow running standalone: `ts-node src/jobs/computeMLBTrends.ts`
if (require.main === module) {
  computeMLBTrends()
    .then(() => {
      console.log("MLB trends computed.");
      process.exit(0);
    })
    .catch((err) => {
      console.error("MLB trends failed:", err);
      process.exit(1);
    });
}
