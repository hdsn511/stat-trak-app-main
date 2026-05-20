import { Request, Response } from 'express';
import { supabaseAdmin } from '../config/supabaseAdmin';
import { STAT_LABELS } from '../constants/stats';
import { findNearestPickDate } from '../utils/dateQueries';

const STAT_ROLLING_COL: Record<string, string> = {
  pts: 'rolling_pts_5g',
  reb: 'rolling_reb_5g',
  ast: 'rolling_ast_5g',
  fg3m: 'rolling_fg3m_5g',
};

function composeBullets(
  pick: any,
  dc: any,
  oppName: string | null,
): [string, string, string] {
  const stat = pick.stat ?? '';
  const statLabel = STAT_LABELS[stat] ?? stat.toUpperCase();
  const hitPct = Math.round((pick.hit_rate ?? 0) * 100);
  const mktPct = Math.round((pick.implied_prob ?? 0) * 100);
  const edgePct = Math.round((pick.edge ?? 0) * 100);
  const n = pick.sample_size ?? 0;
  const line = pick.recommended_line;
  const direction = (pick.hit_rate ?? 0) >= (pick.implied_prob ?? 0.5) ? 'OVER' : 'UNDER';
  const kc: Record<string, string> = pick.key_conditions ?? {};

  // ── Bullet 1: edge (always the same structure) ─────────────────────────────
  const bullet1 =
    `Hit ${direction} ${line} ${statLabel} in **${hitPct}%** of *${n} comparable games*` +
    ` — market prices it at *${mktPct}%*, a **+${edgePct}% edge**.`;

  // ── Bullet 2: recent form ──────────────────────────────────────────────────
  const rollingCol = STAT_ROLLING_COL[stat];
  const rollingRaw = dc?.[rollingCol];
  const usgRaw = dc?.rolling_usg_5g;
  const paceRaw = dc?.rolling_pace_5g;
  const usgActive = kc.usg_pct === 'active';
  const paceActive = kc.pace === 'active';

  let bullet2: string;
  if (rollingRaw != null) {
    const avg = Number(rollingRaw).toFixed(1);
    if (usgActive && paceActive && usgRaw != null && paceRaw != null) {
      const usg = Math.round(Number(usgRaw) * 100);
      const pace = Number(paceRaw).toFixed(1);
      bullet2 = `Averaging **${avg} ${statLabel}** over his last 5 games at *${usg}% usage* and *${pace} pace*.`;
    } else {
      bullet2 = `Averaging **${avg} ${statLabel}** over his last 5 games.`;
    }
  } else if (usgActive && paceActive && usgRaw != null && paceRaw != null) {
    const usg = Math.round(Number(usgRaw) * 100);
    const pace = Number(paceRaw).toFixed(1);
    bullet2 = `Playing at *${usg}% usage* and *${pace} pace* over his last 5 games.`;
  } else {
    bullet2 = `Cleared this line in **${hitPct}%** of *${n} comparable games*.`;
  }

  // ── Bullet 3: context (positive framing — describe active conditions) ──────
  const restActive = kc.rest === 'active';
  const homeActive = kc.home_away === 'active';
  const matchupActive = kc.matchup_rank === 'active';

  const daysRest: number | null = dc?.days_rest ?? null;
  const homeAway: string | null = dc?.home_away ?? null;
  const defRank: number | null = dc?.opp_def_rank_position ?? null;
  const posGroup: string | null = dc?.position_group ?? null;
  const opp = oppName ?? 'opponent';

  const court = homeAway === 'home' ? 'home' : 'away';
  const CourtCap = homeAway === 'home' ? 'Home' : 'Away';

  const posLabel =
    posGroup === 'G' ? 'Guards' :
    posGroup === 'F' ? 'Forwards' : 'Centers';

  let bullet3: string;
  if (restActive && homeActive && matchupActive && daysRest != null && defRank != null) {
    bullet3 = `Rested *(${daysRest} days)*, ${court} court, facing ${opp} ranked **#${defRank} vs ${posLabel}**.`;
  } else if (restActive && matchupActive && daysRest != null && defRank != null) {
    bullet3 = `Rested *(${daysRest} days)*, facing ${opp} ranked **#${defRank} vs ${posLabel}**.`;
  } else if (restActive && homeActive && daysRest != null) {
    bullet3 = `Rested *(${daysRest} days)*, ${court} court vs ${opp}.`;
  } else if (matchupActive && defRank != null) {
    bullet3 = `Facing ${opp} ranked **#${defRank} vs ${posLabel}**.`;
  } else if (homeActive) {
    bullet3 = `${CourtCap} court vs ${opp}.`;
  } else if (restActive && daysRest != null) {
    bullet3 = `Rested *(${daysRest} days)* heading into tonight.`;
  } else {
    // usg + pace only (3/5 minimum)
    const hits = Math.round(hitPct * n / 100);
    const usg = usgRaw != null ? Math.round(Number(usgRaw) * 100) : null;
    const pace = paceRaw != null ? Number(paceRaw).toFixed(1) : null;
    if (usg != null && pace != null) {
      bullet3 = `At **${usg}% usage** and **${pace} pace**, hit this line **${hits} of ${n}** times.`;
    } else {
      bullet3 = `Hit this line **${hits} of ${n}** times in comparable games.`;
    }
  }

  return [bullet1, bullet2, bullet3];
}

export async function getPotd(_req: Request, res: Response) {
  try {
    const today = new Date().toISOString().slice(0, 10);
    const pickDate = await findNearestPickDate(today);

    const { data: pick, error } = await supabaseAdmin
      .from('pick_results')
      .select(
        'id,entity_id,stat,prop_type,pick_type,recommended_line,hit_rate,' +
        'sample_size,confidence_score,implied_prob,edge,conditions_matched,' +
        'total_conditions,key_conditions'
      )
      .eq('game_date', pickDate)
      .order('confidence_score', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) throw error;
    if (!pick) return res.json({ success: true, data: null });

    const p = pick as any;
    let dailyConditions: any = null;
    let playerInfo: any = null;
    let opponent: { team: string | null; team_name: string | null } | null = null;
    let oppDisplayName: string | null = null;

    if (p.prop_type === 'player') {
      const { data: dc } = await supabaseAdmin
        .from('daily_conditions')
        .select(
          'rolling_pts_5g,rolling_reb_5g,rolling_ast_5g,rolling_fg3m_5g,' +
          'rolling_usg_5g,rolling_pace_5g,days_rest,home_away,' +
          'opp_def_rank_position,position_group'
        )
        .eq('player_id', p.entity_id)
        .eq('game_date', pickDate)
        .maybeSingle();
      dailyConditions = dc;

      const { data: pl } = await supabaseAdmin
        .from('players')
        .select('id,name,team,position')
        .eq('id', p.entity_id)
        .maybeSingle();
      playerInfo = pl;

      if (playerInfo?.team) {
        const { data: allTeams } = await supabaseAdmin
          .from('teams')
          .select('id,abbreviation,name');

        const abbrToId = new Map<string, number>(
          (allTeams ?? []).map((t: any) => [t.abbreviation.toUpperCase(), t.id as number])
        );
        const idToInfo = new Map<number, any>(
          (allTeams ?? []).map((t: any) => [t.id as number, t])
        );

        const teamId = abbrToId.get(playerInfo.team.toUpperCase());
        if (teamId != null) {
          const { data: game } = await supabaseAdmin
            .from('games')
            .select('home_team_id,away_team_id')
            .eq('game_date', pickDate)
            .or(`home_team_id.eq.${teamId},away_team_id.eq.${teamId}`)
            .maybeSingle();

          if (game) {
            const g = game as any;
            const oppId = g.home_team_id === teamId ? g.away_team_id : g.home_team_id;
            const oppInfo = idToInfo.get(oppId);
            opponent = {
              team: oppInfo?.abbreviation ?? null,
              team_name: oppInfo?.name ?? null,
            };
            oppDisplayName = oppInfo?.abbreviation ?? null;
          }
        }
      }
    }

    const direction: 'over' | 'under' =
      (p.hit_rate ?? 0) >= (p.implied_prob ?? 0.5) ? 'over' : 'under';

    const bullets = p.prop_type === 'player'
      ? composeBullets(p, dailyConditions, oppDisplayName)
      : ['', '', ''] as [string, string, string];

    res.json({
      success: true,
      data: {
        game_date: pickDate,
        prop_type: p.prop_type,
        player_id: p.prop_type === 'player' ? p.entity_id : null,
        player_name: playerInfo?.name ?? null,
        team: playerInfo?.team ?? null,
        position: playerInfo?.position ?? null,
        opponent,
        stat: p.stat,
        stat_label: STAT_LABELS[p.stat] ?? (p.stat ?? '').toUpperCase(),
        line: p.recommended_line,
        direction,
        hit_rate: p.hit_rate,
        confidence: p.confidence_score,
        edge: p.edge,
        implied_prob: p.implied_prob,
        sample_size: p.sample_size,
        conditions_matched: p.conditions_matched,
        total_conditions: p.total_conditions,
        condition_breakdown: p.key_conditions ?? null,
        bullets,
      },
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
}
