import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import type { TeamDetail, TeamGameEntry, TeamRecord } from "@/services/api";
import ModuleCard from "@/ember/components/ModuleCard";
import { EmptyState } from "@/ember/components/EntityState";
import { gamePath, playerPath } from "@/lib/paths";
import { formatGameDate, formatRecord } from "@/ember/game/format";
import TeamLogo from "@/ember/components/TeamLogo";
import { teamAccent } from "@/lib/teamBrand";

const RESULT_COLOR: Record<"W" | "L" | "T", string> = {
  W: "text-[#4ADE80]",
  L: "text-[#FF6B5C]",
  T: "text-[#C9C2BE]",
};

function RecordCell({ label, record }: { label: string; record: TeamRecord }) {
  return (
    <div className="px-[18px] py-[14px] text-center">
      <div className="font-martian font-bold text-[18px] text-[#EFEBE9] tabular-nums">
        {formatRecord(record)}
      </div>
      <div className="font-martian text-[10px] text-[#A8A09C] tracking-[1px] mt-[5px]">
        {label}
      </div>
    </div>
  );
}

function GameRow({ league, game }: { league: string; game: TeamGameEntry }) {
  const opp = game.is_home ? game.away_team : game.home_team;
  const played = game.result != null;

  return (
    <Link
      to={gamePath(league, game.id)}
      className="grid grid-cols-[74px_18px_1fr_auto_28px] gap-3 items-center px-[18px] py-[10px] border-b border-[#221D1A] last:border-b-0 hover:bg-[#211C1A]"
    >
      <span className="font-martian text-[10px] text-[#A8A09C] tracking-[1px]">
        {formatGameDate(game.game_date)}
      </span>
      <span className="font-martian text-[11px] text-[#8A827E]">
        {game.is_home ? "vs" : "@"}
      </span>
      <span className="font-schibsted font-bold text-[14px] text-[#EFEBE9] whitespace-nowrap overflow-hidden text-ellipsis">
        {opp.abbreviation}
      </span>
      {played ? (
        <span className="font-martian text-[13px] text-[#C9C2BE] tabular-nums">
          {game.team_score}–{game.opp_score}
        </span>
      ) : (
        <span className="font-martian text-[11px] text-[#FF6B3D] tracking-[1px]">
          UPCOMING
        </span>
      )}
      <span
        className={`font-martian font-bold text-[13px] text-center ${
          game.result ? RESULT_COLOR[game.result] : "text-[#8A827E]"
        }`}
      >
        {game.result ?? "–"}
      </span>
    </Link>
  );
}

function Tile({
  label,
  value,
  sub,
  accent,
}: {
  label: string;
  value: string;
  sub?: string;
  accent?: string;
}) {
  return (
    <div className="px-[18px] py-[14px]">
      <div className="font-martian text-[10px] text-[#A8A09C] tracking-[1px]">
        {label}
      </div>
      <div
        className="font-martian font-bold text-[22px] tabular-nums mt-[4px]"
        style={{ color: accent ?? "#EFEBE9" }}
      >
        {value}
      </div>
      {sub && (
        <div className="font-martian text-[11px] text-[#C9C2BE] mt-[2px]">
          {sub}
        </div>
      )}
    </div>
  );
}

const avg = (xs: number[]) =>
  xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
const f1 = (v: number | null) =>
  v == null ? "—" : (Math.round(v * 10) / 10).toFixed(1);
const signed = (v: number | null) =>
  v == null ? "—" : `${v > 0 ? "+" : ""}${f1(v)}`;

/** Scoring margin of the last games, oldest left: green up = won, red down = lost. */
function MarginChart({ games }: { games: TeamGameEntry[] }) {
  const last = games
    .filter((g) => g.result != null)
    .slice(0, 10)
    .reverse();
  if (last.length === 0) return null;
  const margins = last.map((g) => (g.team_score ?? 0) - (g.opp_score ?? 0));
  const max = Math.max(...margins.map(Math.abs), 1);
  return (
    <div className="px-[18px] py-[14px]">
      <div className="font-martian text-[10px] text-[#A8A09C] tracking-[1px] mb-2">
        MARGIN · LAST {last.length}
      </div>
      <div className="relative flex items-center gap-[6px] h-[84px]">
        <div className="absolute left-0 right-0 top-1/2 border-t border-[#2C2624]" />
        {last.map((g, i) => {
          const m = margins[i]!;
          const h = Math.max(4, (Math.abs(m) / max) * 38);
          const opp = g.is_home ? g.away_team : g.home_team;
          return (
            <div
              key={g.id}
              className="relative flex-1 h-full"
              title={`${opp.abbreviation} ${g.team_score}-${g.opp_score}`}
            >
              <div
                className={`absolute left-[10%] right-[10%] rounded-[2px] ${m >= 0 ? "bg-[#4ADE80]" : "bg-[#FF6B5C]"}`}
                style={
                  m >= 0
                    ? { bottom: "50%", height: h }
                    : { top: "50%", height: h }
                }
              />
            </div>
          );
        })}
      </div>
      <div className="flex gap-[6px] mt-1">
        {last.map((g) => {
          const opp = g.is_home ? g.away_team : g.home_team;
          return (
            <div
              key={g.id}
              className="flex-1 text-center font-martian text-[9px] text-[#A8A09C] truncate"
            >
              {opp.abbreviation}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function PlayerTable({
  league,
  stats,
}: {
  league: string;
  stats: TeamDetail["player_stats"];
}) {
  const { columns, players } = stats;
  // Default sort: the first scoring-like column after minutes for NBA, else the first column.
  const [sortKey, setSortKey] = useState<string>(
    columns[league === "nba" ? 1 : 0]?.key ?? "",
  );
  const [showAll, setShowAll] = useState(false);
  const sorted = useMemo(
    () =>
      [...players].sort(
        (a, b) => (b.avgs[sortKey] ?? 0) - (a.avgs[sortKey] ?? 0),
      ),
    [players, sortKey],
  );
  const shown = showAll ? sorted : sorted.slice(0, 10);
  const maxOf = (k: string) =>
    Math.max(...players.map((p) => p.avgs[k] ?? 0), 1);
  const grid = `minmax(140px,1fr) 34px repeat(${columns.length}, 54px)`;

  if (players.length === 0)
    return <EmptyState label="NO PLAYER STATS YET THIS SEASON" compact />;
  return (
    <>
      <div className="overflow-x-auto">
        <div className="min-w-max">
          <div
            className="grid gap-2 items-center px-[18px] py-[9px] border-b border-[#27221F]"
            style={{ gridTemplateColumns: grid }}
          >
            <span className="font-martian text-[10px] text-[#A8A09C] tracking-[1px]">
              PLAYER
            </span>
            <span className="font-martian text-[10px] text-[#A8A09C] tracking-[1px] text-right">
              GP
            </span>
            {columns.map((c) => (
              <button
                key={c.key}
                type="button"
                onClick={() => setSortKey(c.key)}
                aria-pressed={sortKey === c.key}
                className={`font-martian text-[11px] tracking-[1px] text-right cursor-pointer ${
                  sortKey === c.key
                    ? "text-[#FF6B3D] font-bold"
                    : "text-[#A8A09C] hover:text-[#EFEBE9]"
                }`}
              >
                {c.label}
                {sortKey === c.key ? " ↓" : ""}
              </button>
            ))}
          </div>
          {shown.map((p) => (
            <Link
              key={p.id}
              to={playerPath(league, p.id)}
              className="grid gap-2 items-center px-[18px] py-[9px] border-b border-[#221D1A] last:border-b-0 hover:bg-[#211C1A]"
              style={{ gridTemplateColumns: grid }}
            >
              <div className="min-w-0">
                <div className="font-schibsted font-bold text-[14px] text-[#EFEBE9] whitespace-nowrap overflow-hidden text-ellipsis">
                  {p.name}
                </div>
                {p.position && (
                  <div className="font-martian text-[10px] text-[#A8A09C]">
                    {p.position}
                  </div>
                )}
              </div>
              <span className="font-martian text-[12px] text-[#C9C2BE] text-right tabular-nums">
                {p.gp}
              </span>
              {columns.map((c) => {
                const v = p.avgs[c.key] ?? 0;
                const hot = sortKey === c.key;
                return (
                  <div key={c.key} className="text-right">
                    <div
                      className={`font-martian text-[13px] tabular-nums ${hot ? "font-bold text-[#EFEBE9]" : "text-[#D8D2CE]"}`}
                    >
                      {v}
                    </div>
                    <div className="h-[3px] rounded-full bg-[#2C2624] mt-[3px] overflow-hidden">
                      <div
                        className="h-full rounded-full"
                        style={{
                          width: `${(v / maxOf(c.key)) * 100}%`,
                          background: hot ? "#FF6B3D" : "#665F5D",
                        }}
                      />
                    </div>
                  </div>
                );
              })}
            </Link>
          ))}
        </div>
      </div>
      {sorted.length > 10 && (
        <button
          type="button"
          onClick={() => setShowAll((v) => !v)}
          className="block w-full text-center p-3 border-t border-[#27221F] font-martian font-bold text-[12px] text-[#FF6B3D] tracking-[1.5px] hover:text-[#FFD9C9] cursor-pointer"
        >
          {showAll ? "SHOW TOP 10 ↑" : `SHOW ALL ${sorted.length} PLAYERS ↓`}
        </button>
      )}
    </>
  );
}

/** Rows shown before the schedule needs a "show all". A full season is 80+. */
const SCHEDULE_PREVIEW = 20;

export default function TeamView({ data }: { data: TeamDetail }) {
  const { league, team, record } = data;
  const [allGames, setAllGames] = useState(false);

  const upcoming = data.games.filter((g) => g.result == null);
  const played = data.games.filter((g) => g.result != null);
  // Next games first, then most recent results.
  const ordered = [...upcoming].reverse().concat(played);
  const shown = allGames ? ordered : ordered.slice(0, SCHEDULE_PREVIEW);
  const accent = teamAccent(league, team.abbreviation);
  const scored = played.filter(
    (g) => g.team_score != null && g.opp_score != null,
  );
  const pf = avg(scored.map((g) => g.team_score as number));
  const pa = avg(scored.map((g) => g.opp_score as number));

  return (
    <div className="w-full max-w-[1280px] mx-auto flex flex-col gap-[14px] px-8 pt-6 pb-11">
      {/* Identity */}
      <div
        className="flex items-center gap-5 flex-wrap rounded-lg border border-[#2C2624] px-[22px] py-[18px]"
        style={{
          background: `linear-gradient(100deg, ${accent}33 0%, #1B1715 55%)`,
          borderLeft: `4px solid ${accent}`,
        }}
      >
        <TeamLogo league={league} abbr={team.abbreviation} size={72} />
        <div className="min-w-0">
          <div className="font-chakra italic font-bold text-[clamp(24px,3.2vw,36px)] tracking-[-1px] leading-none text-[#EFEBE9]">
            {team.name}
          </div>
          <div className="font-martian text-[12px] text-[#C9C2BE] mt-[7px] tracking-[0.5px]">
            {[
              team.abbreviation,
              league.toUpperCase(),
              `${formatRecord(record.overall)} OVERALL`,
            ]
              .filter(Boolean)
              .join(" · ")}
          </div>
        </div>
      </div>

      <ModuleCard title="TEAM FORM" meta="SEASON TO DATE">
        <div className="grid lg:grid-cols-[1fr_1.1fr] divide-y lg:divide-y-0 lg:divide-x divide-[#27221F]">
          <div className="grid grid-cols-2 divide-x divide-[#27221F]">
            <Tile label="FOR / GAME" value={f1(pf)} accent={accent} />
            <Tile label="AGAINST / GAME" value={f1(pa)} />
            <div className="col-span-2 border-t border-[#27221F] grid grid-cols-2 divide-x divide-[#27221F]">
              <Tile
                label="MARGIN / GAME"
                value={signed(pf != null && pa != null ? pf - pa : null)}
                sub={`${formatRecord(record.last10)} LAST 10`}
              />
              <Tile
                label="HOME / AWAY"
                value={`${formatRecord(record.home)}`}
                sub={`${formatRecord(record.away)} away`}
              />
            </div>
          </div>
          <MarginChart games={data.games} />
        </div>
      </ModuleCard>

      <ModuleCard title="RECORD" meta="SEASON TO DATE">
        <div
          className="grid divide-x divide-[#27221F]"
          style={{
            gridTemplateColumns: "repeat(auto-fit, minmax(110px, 1fr))",
          }}
        >
          <RecordCell label="OVERALL" record={record.overall} />
          <RecordCell label="HOME" record={record.home} />
          <RecordCell label="AWAY" record={record.away} />
          <RecordCell label="LAST 10" record={record.last10} />
        </div>
      </ModuleCard>

      <ModuleCard
        title="PLAYER STATS"
        meta="SEASON PER GAME · CLICK A COLUMN TO SORT"
      >
        <PlayerTable league={league} stats={data.player_stats} />
      </ModuleCard>

      <div className="grid gap-[14px] lg:grid-cols-[1fr_380px] items-start">
        <ModuleCard
          title="SCHEDULE"
          meta={`${played.length} PLAYED · ${upcoming.length} UPCOMING`}
        >
          {data.games.length === 0 ? (
            <EmptyState label="NO GAMES FOUND THIS SEASON" compact />
          ) : (
            shown.map((g) => <GameRow key={g.id} league={league} game={g} />)
          )}
          {ordered.length > SCHEDULE_PREVIEW && (
            <button
              type="button"
              onClick={() => setAllGames((v) => !v)}
              className="block w-full text-center p-3 border-t border-[#27221F] font-martian font-bold text-[12px] text-[#FF6B3D] tracking-[1.5px] hover:text-[#FFD9C9] cursor-pointer"
            >
              {allGames
                ? `SHOW ${SCHEDULE_PREVIEW} ↑`
                : `SHOW ALL ${ordered.length} GAMES ↓`}
            </button>
          )}
        </ModuleCard>

        <ModuleCard title="ROSTER" meta={`${data.roster.length} ACTIVE`}>
          {data.roster.length === 0 ? (
            <EmptyState label="NO ACTIVE PLAYERS LISTED" compact />
          ) : (
            data.roster.map((p) => (
              <Link
                key={p.id}
                to={playerPath(league, p.id)}
                className="flex items-center gap-3 px-[18px] py-[9px] border-b border-[#221D1A] last:border-b-0 hover:bg-[#211C1A]"
              >
                <span className="font-schibsted font-bold text-[14px] text-[#EFEBE9] flex-1 min-w-0 whitespace-nowrap overflow-hidden text-ellipsis">
                  {p.name}
                </span>
                <span className="font-martian text-[11px] text-[#A8A09C] shrink-0">
                  {p.position}
                </span>
              </Link>
            ))
          )}
        </ModuleCard>
      </div>
    </div>
  );
}
