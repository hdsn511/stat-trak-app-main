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
};


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

  let { data, error } = await supabaseAdmin
    .from("nba_player_stats")
    .select("*")
    .in("player_id", playerIds)
    .gt("season", 2024)
    .order("game_date", { ascending: false });

  if (error) throw error;

  return data as PlayerGameStat[];
}

function groupByPlayer(
  stats: PlayerGameStat[]
): Map<number, PlayerGameStat[]> {
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
  windows: number[] = [3, 5, 10]
) {
  // Compute z-scores for player stats
  const values = games.map(statSelector);

  if (values.length < 5) return [];

  const seasonAvg = mean(values);
  const seasonStd = stdDev(values, seasonAvg);

  if (seasonStd === 0) return [];

  return windows
    .filter(w => games.length >= w)
    .map(w => {
      const rollingValues = values.slice(0, w);
      const rollingAvg = mean(rollingValues);
      const zScore = (rollingAvg - seasonAvg) / seasonStd;
      return {
        window: w,
        rollingAvg,
        seasonAvg,
        seasonStd,
        zScore
      };
    })
}

export async function computeTrends() {
  const playerIds = await loadPlayers();
  const stats  = await loadPlayerStats(playerIds);

  const statsByPlayer = groupByPlayer(stats);
  

  for(const playerId of playerIds) {
    const playerGames = statsByPlayer.get(playerId) || [];
    if(!playerGames || playerGames.length < 10) continue;
    // TODO: clean


    const pointTrends = computeZscores(
      playerGames,
      stat => stat.points
    );

    const assistTrends = computeZscores(
      playerGames,
      stat => stat.assists
    );

    const reboundTrends = computeZscores(
      playerGames,
      stat => stat.rebounds
    );

    const threePointMadeTrends = computeZscores(
      playerGames,
      stat => stat.three_points_made
    );

    const foulTrends = computeZscores(
      playerGames,
      stat => stat.fouls
    );

    const minuteTrends = computeZscores(
      playerGames,
      stat => stat.minutes_played
    );
  }
}
