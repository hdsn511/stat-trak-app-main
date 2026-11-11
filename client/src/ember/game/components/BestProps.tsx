import { Link } from 'react-router-dom'
import type { GameProp, ProjectGame, ProjectPick, TeamRef } from '@/services/api'
import ModuleCard from '@/ember/components/ModuleCard'
import PlayerAvatar from '@/ember/components/PlayerAvatar'
import TeamLogo from '@/ember/components/TeamLogo'
import { EmptyState } from '@/ember/components/EntityState'
import { playerPath } from '@/lib/paths'
import { teamAccent } from '@/lib/teamBrand'
import { Th } from './insightUi'
import { BAD, GOOD } from './insightTones'
import { ImpliedOddsNote } from '../../components/PropVisuals'

const pct1 = (v: number) => `${(v * 100).toFixed(1)}%`
const COLS = 'grid-cols-[minmax(200px,1.2fr)_minmax(170px,1fr)_70px_64px_64px]'

function reason(p: ProjectPick): string {
  const c = p.context
  return [
    c.avg20 != null ? `L20 ${c.avg20}` : null,
    c.avg5 != null ? `L5 ${c.avg5}` : null,
    c.last != null ? `LAST ${c.last}` : null,
    c.hit10 != null ? `${Math.round(c.hit10 * 10)}/10 ${p.side === 'under' ? 'UNDER' : 'OVER'}` : null,
    c.b2b ? 'BACK-TO-BACK' : null,
  ]
    .filter(Boolean)
    .join(' · ')
}

function PropRow({ league, p }: { league: string; p: ProjectPick }) {
  const accent = teamAccent(league, p.team ?? '')
  const over = p.side !== 'under'
  const sideColor = over ? GOOD : BAD
  const edgePts = Math.round(p.edge * 1000) / 10
  return (
    <Link
      to={playerPath(league, p.entity_id)}
      className={`grid ${COLS} gap-3 items-center px-[18px] py-[9px] border-t border-[#221D1A] hover:bg-[#211C1A]`}
      style={{ boxShadow: `inset 3px 0 0 ${accent}` }}
    >
      <div className="flex items-center gap-[10px] min-w-0">
        <PlayerAvatar league={league} extId={p.ext_id} name={p.name} accent={accent} size={32} />
        <div className="min-w-0">
          <div className="font-schibsted font-bold text-[14px] text-[#EFEBE9] truncate flex items-center gap-[6px]">
            {p.team && <TeamLogo league={league} abbr={p.team} size={14} />}
            <span className="truncate">{p.name}</span>
          </div>
          <div className="font-martian text-[10px] text-[#8A827E] mt-[2px] truncate">{reason(p) || '—'}</div>
        </div>
      </div>
      <span className="inline-flex items-center gap-2 min-w-0">
        <span
          className="font-martian font-bold text-[10px] tracking-[1px] rounded-[3px] px-[6px] py-[3px] border shrink-0"
          style={{ color: sideColor, borderColor: `${sideColor}66`, background: `${sideColor}14` }}
        >
          {over ? 'OVER' : 'UNDER'}
        </span>
        <span className="font-martian font-bold text-[13px] text-[#EFEBE9] tabular-nums whitespace-nowrap">
          {p.line} <span className="text-[11px] text-[#C9C2BE] font-normal">{p.stat_label}</span>
        </span>
      </span>
      <span className="font-martian font-bold text-[13px] text-[#EFEBE9] text-right tabular-nums">{pct1(p.model_prob)}</span>
      <span className="font-martian text-[12px] text-[#C9C2BE] text-right tabular-nums">{Math.round(p.implied_prob * 100)}%</span>
      <span
        className="font-martian font-bold text-[12px] text-right tabular-nums"
        style={{ color: edgePts > 0 ? GOOD : edgePts < 0 ? BAD : '#A8A09C' }}
      >
        {edgePts > 0 ? '+' : ''}
        {edgePts.toFixed(1)}
      </span>
    </Link>
  )
}

/**
 * The Projects picks for this game: the model's winner and its best player
 * props, each tagged with its team. Comes from GET /{league}/projects, which
 * covers the league's projects window. NBA picks are final an hour before tip and
 * stay visible once the game starts.
 */
/** Main spread and implied win probability from the listed game markets. */
function LinesStrip({ gameProps, home, away }: { gameProps: GameProp[]; home: TeamRef; away: TeamRef }) {
  const spread = gameProps.find((g) => g.prop_type === 'spread' && g.line != null)
  const ml = (id: number) => gameProps.find((g) => g.prop_type === 'winner' && g.team_id === id)?.implied_prob
  const awayMl = ml(away.id)
  const homeMl = ml(home.id)
  if (!spread && awayMl == null && homeMl == null) return null
  const spreadTeam = spread ? (spread.team_id === away.id ? away : home) : null
  const item = (label: string, value: string) => (
    <span className="font-martian text-[11px] text-[#C9C2BE] tabular-nums">
      <span className="text-[#8A827E] tracking-[1px]">{label} </span>
      <span className="font-bold text-[#EFEBE9]">{value}</span>
    </span>
  )
  return (
    <div className="flex flex-wrap items-center gap-x-6 gap-y-1 px-[18px] py-[10px] border-b border-[#221D1A]">
      {spread && spreadTeam && item('SPREAD', `${spreadTeam.abbreviation} ${spread.line! > 0 ? '+' : ''}${spread.line}${spread.implied_prob != null ? ` · ${Math.round(spread.implied_prob * 100)}%` : ''}`)}
      {awayMl != null && item(`${away.abbreviation} WIN`, `${Math.round(awayMl * 100)}%`)}
      {homeMl != null && item(`${home.abbreviation} WIN`, `${Math.round(homeMl * 100)}%`)}
    </div>
  )
}

export default function BestProps({ league, game, supported, windowLabel, gameProps, home, away }: {
  league: string
  game: ProjectGame | null
  supported: boolean
  windowLabel: string
  gameProps?: GameProp[]
  home?: TeamRef
  away?: TeamRef
}) {
  let body
  if (!supported) {
    body = <EmptyState compact label={`NO PROJECTS MODEL FOR ${league.toUpperCase()} YET`} />
  } else if (!game) {
    body = <EmptyState compact label={`NO PICKS FOR THIS GAME · MODEL COVERS ${windowLabel}`} />
  } else {
    const w = game.winner
    // Only props the model rates above the market price; the rest are not picks.
    const best = game.props.filter((p) => p.edge >= 0)
    body = (
      <>
        {w && (
          <div
            className="flex items-center gap-3 px-[18px] py-[11px] border-b border-[#221D1A]"
            style={{ boxShadow: `inset 3px 0 0 ${teamAccent(league, w.team ?? '')}` }}
          >
            <TeamLogo league={league} abbr={w.team ?? ''} size={30} />
            <div className="min-w-0 flex-1">
              <div className="font-martian text-[10px] text-[#8A827E] tracking-[1px]">BOOK FAVORITE</div>
              <div className="font-schibsted font-bold text-[15px] text-[#EFEBE9] truncate">{w.name}</div>
            </div>
            <div className="text-right">
              <div className="font-martian font-bold text-[15px] tabular-nums" style={{ color: GOOD }}>{pct1(w.model_prob)}</div>
              <div className="font-martian text-[10px] text-[#A8A09C] tabular-nums">
                IMPLIED {Math.round(w.implied_prob * 100)}%
                {w.context.elo_agrees != null && (
                  <span style={{ color: w.context.elo_agrees ? GOOD : BAD }}>
                    {' · '}RATINGS {w.context.elo_agrees ? 'AGREE' : 'DISAGREE'}
                  </span>
                )}
              </div>
            </div>
          </div>
        )}
        {best.length > 0 ? (
          <div className="overflow-x-auto">
            <div className="min-w-[560px]">
              <div className={`grid ${COLS} gap-3 px-[18px] py-2`}>
                <Th>PLAYER</Th>
                <Th>PICK</Th>
                <Th align="right">HIT</Th>
                <Th align="right">IMPLIED</Th>
                <Th align="right">EDGE</Th>
              </div>
              {best.map((p) => (
                <PropRow key={p.id} league={league} p={p} />
              ))}
            </div>
          </div>
        ) : (
          <EmptyState compact label="NO PROP WITH AN EDGE OVER THE KALSHI PRICE YET" />
        )}
      </>
    )
  }
  return (
    <ModuleCard title="BEST PROPS" meta="MODEL HIT % VS KALSHI PRICE · EDGE IN PTS">
      {gameProps && home && away && <LinesStrip gameProps={gameProps} home={home} away={away} />}
      {body}
      <ImpliedOddsNote />
    </ModuleCard>
  )
}
