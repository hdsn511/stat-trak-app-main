import PerformanceSection from "@/components/Performance/PerformanceSection";
import StreakPerformanceCard from "@/components/Performance/StreakPerformanceCard";
import ComingSoon from "@/components/ComingSoon/ComingSoon";
import Sidebar from "@/components/Sidebar/Sidebar";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import {
  BucketStats,
  PerformanceSummary,
  PickOutcome,
  SegmentStats,
  StreakOutcomeRow,
} from "@/services/api";
import { LEAGUES, getLeague, LeagueSlug } from "@/config/leagues";
import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";

const PERIOD_OPTIONS = [
  { label: "TODAY", days: 1 },
  { label: "7D", days: 7 },
  { label: "30D", days: 30 },
  { label: "90D", days: 90 },
];

function fmtPct(v: number | null): string {
  if (v == null) return "—";
  return `${Math.round(v * 100)}%`;
}

function fmtEdge(v: number | null): string {
  if (v == null) return "—";
  const sign = v >= 0 ? "+" : "";
  return `${sign}${Math.round(v * 100)}%`;
}

function RecordBadge({
  hits,
  misses,
  pending,
}: {
  hits: number;
  misses: number;
  pending: number;
}) {
  return (
    <div className="flex items-center gap-1.5 font-mono tabular-nums text-[12px]">
      <span className="text-over font-bold">{hits}W</span>
      <span className="text-gray-700">-</span>
      <span className="text-under font-bold">{misses}L</span>
      {pending > 0 && (
        <>
          <span className="text-gray-700">-</span>
          <span className="text-gray-500">{pending}P</span>
        </>
      )}
    </div>
  );
}

function SegmentCard({ label, stats }: { label: string; stats: SegmentStats }) {
  return (
    <div className="flex flex-col gap-1 px-4 py-3 border-b border-[#0F0F0F] last:border-0">
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-bold text-gray-500 uppercase tracking-wider font-condensed">
          {label}
        </span>
        <span
          className={cn(
            "text-[13px] font-black font-mono",
            stats.hitRate != null && stats.hitRate >= 0.6
              ? "text-over"
              : "text-gray-400",
          )}
        >
          {fmtPct(stats.hitRate)}
        </span>
      </div>
      <div className="flex items-center justify-between">
        <RecordBadge
          hits={stats.hits}
          misses={stats.misses}
          pending={stats.pending}
        />
        <span className="text-[10px] text-gray-700 font-condensed">
          {stats.total} picks
        </span>
      </div>
    </div>
  );
}

function BucketCard({ b }: { b: BucketStats }) {
  const edge = b.edgeVsMarket;
  const hasData = b.settled > 0;
  return (
    <div className="flex flex-col gap-2 p-4 border border-[#161616] rounded-xl bg-[#0A0A0A]">
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-bold text-gray-600 uppercase tracking-wider font-condensed">
          {b.label}
        </span>
        <span
          className={cn(
            "text-[11px] font-bold font-condensed uppercase tracking-wide border px-1.5 py-0.5 rounded",
            !hasData
              ? "text-gray-700 border-[#222] bg-[#111]"
              : edge != null && edge >= 0.05
                ? "text-over border-over/20 bg-over/5"
                : edge != null && edge <= -0.05
                  ? "text-under border-under/20 bg-under/5"
                  : "text-gray-500 border-[#222] bg-[#111]",
          )}
        >
          {hasData ? fmtEdge(edge) : "—"} edge
        </span>
      </div>

      <div className="text-[22px] font-black font-mono tabular-nums leading-none text-white">
        {hasData ? fmtPct(b.hitRate) : "—"}
      </div>
      <div className="text-[9px] text-gray-700 font-condensed">
        expected {fmtPct(b.expectedRate)}
      </div>

      <div className="h-px bg-[#161616] my-1" />

      <RecordBadge hits={b.hits} misses={b.misses} pending={b.pending} />
      <div className="text-[9px] text-gray-700 font-condensed">
        {b.total} picks total
      </div>
    </div>
  );
}

function OutcomeIcon({ didHit }: { didHit: boolean | null }) {
  if (didHit === null)
    return <span className="text-[10px] text-gray-600 font-mono">PEND</span>;
  return didHit ? (
    <span className="text-[11px] font-bold text-over">W</span>
  ) : (
    <span className="text-[11px] font-bold text-under">L</span>
  );
}

function PickHistoryRow({ pick }: { pick: PickOutcome }) {
  const isPlayer = pick.prop_type === "player";
  const nameEl =
    isPlayer && pick.player_id ? (
      <Link
        to={`/player/${pick.player_id}`}
        className="text-[12px] font-semibold text-white hover:text-mint transition-colors font-condensed truncate"
      >
        {pick.player_name ?? "—"}
      </Link>
    ) : (
      <span className="text-[12px] font-semibold text-white font-condensed truncate">
        {pick.player_name ?? "—"}
      </span>
    );

  return (
    <div className="grid grid-cols-[1fr_auto_auto_auto_auto_auto] gap-3 px-4 py-2.5 border-b border-[#0A0A0A] last:border-0 hover:bg-white/[0.01] items-center">
      <div className="min-w-0">
        {nameEl}
        <div className="text-[10px] text-gray-600 font-condensed">
          {pick.game_date}
          {pick.stat_label && ` · ${pick.stat_label}`}
          {pick.team && ` · ${pick.team}`}
        </div>
      </div>
      <span className="text-[11px] font-mono text-gray-400 tabular-nums">
        {pick.line != null
          ? pick.prop_type === "player"
            ? `${pick.line}+`
            : `${pick.line}`
          : "—"}
      </span>
      <span className="text-[11px] font-mono text-gray-600 tabular-nums">
        {pick.implied_prob != null
          ? `${Math.round(pick.implied_prob * 100)}%`
          : "—"}
      </span>
      <span
        className={cn(
          "text-[11px] font-mono tabular-nums font-bold",
          pick.edge != null && pick.edge >= 0.1 ? "text-mint" : "text-gray-500",
        )}
      >
        {pick.edge != null ? fmtEdge(pick.edge) : "—"}
      </span>
      <span className="text-[10px] font-mono text-gray-600 tabular-nums">
        {pick.actual_result != null ? pick.actual_result : "—"}
      </span>
      <OutcomeIcon didHit={pick.did_hit} />
    </div>
  );
}

type PickFilter = "all" | "hit" | "miss" | "pending";
// "all" or a league-specific streak stat key (e.g. "pts", "hits")
type StatFilter = string;
type BottomView = "streaks" | "picks";

export default function Performance() {
  const [league, setLeague] = useState<LeagueSlug>("nba");
  const def = getLeague(league);
  const [days, setDays] = useState(1);
  const [data, setData] = useState<PerformanceSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [pickFilter, setPickFilter] = useState<PickFilter>("all");
  const [streakFilter, setStreakFilter] = useState<PickFilter>("all");
  const [streakStatFilter, setStreakStatFilter] = useState<StatFilter>("all");
  const [bottomView, setBottomView] = useState<BottomView>("picks");
  const [streakOutcomes, setStreakOutcomes] = useState<StreakOutcomeRow[]>([]);
  const [streakLoading, setStreakLoading] = useState(true);
  const [streakError, setStreakError] = useState<string | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchData = (d: number, silent = false) => {
    const api = def.perfApi;
    if (!api) return; // league not yet available (NHL/NFL)
    if (!silent) setLoading(true);
    setError(null);
    api
      .getSummary(d)
      .then((res) => {
        setData(res);
        setLastUpdated(new Date());
      })
      .catch((e) => setError(e.message))
      .finally(() => {
        if (!silent) setLoading(false);
      });

    if (!silent) setStreakLoading(true);
    setStreakError(null);
    api
      .getStreakOutcomes(d)
      .then((res) => setStreakOutcomes(res.rows))
      .catch((e) => setStreakError(e.message))
      .finally(() => {
        if (!silent) setStreakLoading(false);
      });
  };

  // Switching leagues resets the table/filter state so stale rows never bleed
  // across sports.
  useEffect(() => {
    setPickFilter("all");
    setStreakFilter("all");
    setStreakStatFilter("all");
    setStreakOutcomes([]);
    setData(null);
  }, [league]);

  useEffect(() => {
    if (!def.available) return; // coming-soon leagues have no data to fetch
    fetchData(days);

    // Poll every 60s on TODAY view — picks get reconciled as games finish
    if (intervalRef.current) clearInterval(intervalRef.current);
    if (days === 1) {
      intervalRef.current = setInterval(() => fetchData(days, true), 60_000);
    }
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [days, league]);

  return (
    <div className="flex h-full">
      <Sidebar />
      <main className="flex-1 overflow-y-auto p-5 space-y-4">
        {/* League toggle — NBA / MLB live, NHL / NFL coming soon */}
        <div className="flex items-center gap-1">
          {LEAGUES.map((l) => {
            const isActive = league === l.slug;
            return (
              <button
                key={l.slug}
                onClick={() => setLeague(l.slug)}
                className={cn(
                  "relative px-4 py-1.5 rounded-lg text-[11px] font-bold font-condensed tracking-widest uppercase transition-colors",
                  isActive
                    ? "bg-mint text-black"
                    : "bg-[#141414] text-gray-500 hover:text-white border border-[#222]",
                )}
              >
                {l.label}
                {!l.available && (
                  <span className="ml-1.5 text-[8px] text-gray-600 tracking-normal align-top">
                    soon
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {!def.available ? (
          <ComingSoon league={def.label} />
        ) : (
          <>
        {/* Page header + period selector */}
        <div className="flex items-center justify-between">
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-[11px] font-bold text-gray-500 uppercase tracking-[0.2em] font-condensed">
                Performance
              </h1>
              {days === 1 && (
                <span className="flex items-center gap-1 text-[9px] text-over font-condensed uppercase tracking-wide">
                  <span className="w-1.5 h-1.5 rounded-full bg-over animate-pulse-live" />
                  live
                </span>
              )}
            </div>
            <p className="text-[10px] text-gray-700 font-condensed mt-0.5">
              {lastUpdated
                ? `updated ${lastUpdated.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`
                : data
                  ? `${data.period.from} → ${data.period.to}`
                  : ""}
            </p>
          </div>
          <div className="flex gap-1">
            {PERIOD_OPTIONS.map((opt) => (
              <button
                key={opt.days}
                onClick={() => setDays(opt.days)}
                className={cn(
                  "px-3 py-1.5 rounded-lg text-[11px] font-bold font-condensed transition-colors",
                  days === opt.days
                    ? "bg-mint text-black"
                    : "bg-[#141414] text-gray-600 hover:text-white border border-[#222]",
                )}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        {loading && (
          <div className="space-y-4">
            <Skeleton className="h-28 bg-[#0D0D0D] rounded-2xl" />
            <Skeleton className="h-48 bg-[#0D0D0D] rounded-2xl" />
            <Skeleton className="h-96 bg-[#0D0D0D] rounded-2xl" />
          </div>
        )}

        {error && (
          <div className="bg-[#0D0D0D] border border-[#161616] rounded-2xl px-4 py-8 text-center text-[11px] text-gray-700 font-condensed">
            {error}
          </div>
        )}

        {!loading && !error && data && (
          <>
            {/* ── Overall summary */}
            <PerformanceSection
              title="Overall"
              subtitle={`${data.overall.total} picks`}
            >
              <div className="grid grid-cols-2 sm:grid-cols-4 divide-x divide-[#111]">
                {[
                  {
                    label: "Hit Rate",
                    value: fmtPct(data.overall.hitRate),
                    sub: `${data.overall.settled} settled`,
                  },
                  {
                    label: "Record",
                    value: `${data.overall.hits}–${data.overall.misses}`,
                    sub: `${data.overall.pending} pending`,
                  },
                  {
                    label: "Player Props",
                    value: fmtPct(data.playerProps.hitRate),
                    sub: `${data.playerProps.total} picks`,
                  },
                  {
                    label: "Game Props",
                    value: fmtPct(data.gameProps.hitRate),
                    sub: `${data.gameProps.total} picks`,
                  },
                ].map((item) => (
                  <div
                    key={item.label}
                    className="flex flex-col gap-1 px-4 py-4"
                  >
                    <span className="text-[9px] font-bold text-gray-700 uppercase tracking-widest font-condensed">
                      {item.label}
                    </span>
                    <span className="text-[20px] font-black text-white font-mono tabular-nums leading-none">
                      {item.value}
                    </span>
                    <span className="text-[10px] text-gray-700 font-condensed">
                      {item.sub}
                    </span>
                  </div>
                ))}
              </div>
            </PerformanceSection>

            {/* ── Bucket breakdown */}
            <PerformanceSection
              title="By Market Bucket"
              subtitle="vs expected hit rate"
            >
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 p-4">
                {data.buckets.map((b) => (
                  <BucketCard key={b.bucket} b={b} />
                ))}
              </div>
            </PerformanceSection>

            {/* ── Streak tier tracker */}
            <StreakPerformanceCard
              days={days}
              api={def.perfApi}
              stats={(def.streakStats ?? []).map((s) => s.key)}
            />

            {/* ── Segments */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <PerformanceSection
                title="Pick of the Day"
                subtitle="top safe pick per slate"
              >
                <SegmentCard label="POTD Record" stats={data.potd} />
              </PerformanceSection>
              <PerformanceSection title="By Pick Type">
                <SegmentCard label="Player Props" stats={data.playerProps} />
                <SegmentCard label="Game Props" stats={data.gameProps} />
              </PerformanceSection>
            </div>

        

            {/* ── Streaks / Picks combined card */}
            {(() => {
              const FILTERS: { key: PickFilter; label: string }[] = [
                { key: "all", label: "All" },
                { key: "hit", label: "Hit" },
                { key: "miss", label: "Miss" },
                { key: "pending", label: "Pending" },
              ];
              const COL_W = "w-14" as const;

              // ── Helpers ───────────────────────────────────────────────
              function countByFilter<T extends { did_hit: boolean | null }>(
                rows: T[], k: PickFilter,
              ): number {
                if (k === "hit") return rows.filter(r => r.did_hit === true).length;
                if (k === "miss") return rows.filter(r => r.did_hit === false).length;
                if (k === "pending") return rows.filter(r => r.did_hit === null).length;
                return rows.length;
              }

              function applyPickFilter(rows: PickOutcome[], f: PickFilter): PickOutcome[] {
                if (f === "hit") return rows.filter(r => r.did_hit === true);
                if (f === "miss") return rows.filter(r => r.did_hit === false);
                if (f === "pending") return rows.filter(r => r.did_hit === null);
                return rows;
              }

              function applyStreakFilter(rows: StreakOutcomeRow[], f: PickFilter, sf: StatFilter): StreakOutcomeRow[] {
                let out = rows;
                if (f === "hit") out = out.filter(r => r.did_hit === true);
                else if (f === "miss") out = out.filter(r => r.did_hit === false);
                else if (f === "pending") out = out.filter(r => r.did_hit === null);
                if (sf !== "all") out = out.filter(r => r.stat === sf);
                return out;
              }

              const STAT_FILTERS: { key: StatFilter; label: string }[] = [
                { key: "all", label: "All" },
                ...(def.streakStats ?? []).map((s) => ({ key: s.key, label: s.label })),
              ];

              function renderStatFilterRow(outcomeFilteredRows: StreakOutcomeRow[]) {
                return (
                  <div className="flex items-center gap-1 px-3 py-2 border-b border-[#0F0F0F] bg-[#080808]">
                    {STAT_FILTERS.map((sf) => {
                      const count = sf.key === "all"
                        ? outcomeFilteredRows.length
                        : outcomeFilteredRows.filter(r => r.stat === sf.key).length;
                      const isActive = streakStatFilter === sf.key;
                      return (
                        <button
                          key={sf.key}
                          onClick={() => setStreakStatFilter(sf.key)}
                          className={cn(
                            "flex items-center gap-1 px-2.5 py-1 rounded-md text-[10px] font-bold font-condensed uppercase tracking-wide transition-colors",
                            isActive
                              ? "bg-[#1a1a1a] text-white border border-[#2a2a2a]"
                              : "text-gray-600 hover:text-gray-400",
                          )}
                        >
                          {sf.label}
                          <span className="text-[9px] font-mono text-gray-700">{count}</span>
                        </button>
                      );
                    })}
                  </div>
                );
              }

              function renderFilterTabs<T extends { did_hit: boolean | null }>(
                rows: T[],
                active: PickFilter,
                setActive: (f: PickFilter) => void,
              ) {
                return (
                  <div className="flex items-center border-b border-[#111]">
                    {FILTERS.map((f) => {
                      const isActive = active === f.key;
                      return (
                        <button
                          key={f.key}
                          onClick={() => setActive(f.key)}
                          className={cn(
                            "flex items-center gap-1.5 px-4 py-2.5 text-[10px] font-bold font-condensed uppercase tracking-wide relative transition-colors",
                            isActive ? "text-white" : "text-gray-600 hover:text-gray-400",
                          )}
                        >
                          <span className={cn(
                            f.key === "hit" ? "text-over" : "",
                            f.key === "miss" ? "text-under" : "",
                            f.key === "pending" ? "text-gray-500" : "",
                            !isActive && "opacity-60",
                          )}>
                            {f.label}
                          </span>
                          <span className="text-gray-700 text-[9px] font-mono">
                            {countByFilter(rows, f.key)}
                          </span>
                          {isActive && (
                            <span className="absolute bottom-0 left-1 right-1 h-0.5 bg-mint rounded-t-full" />
                          )}
                        </button>
                      );
                    })}
                  </div>
                );
              }

              // ── Picks table ───────────────────────────────────────────
              const filteredPicks = applyPickFilter(data.recentPicks, pickFilter);

              function renderPicksTable() {
                if (filteredPicks.length === 0) {
                  return (
                    <div className="px-4 py-8 text-center text-[11px] text-gray-700 font-condensed">
                      No picks in this period
                    </div>
                  );
                }
                return (
                  <>
                    <div className="grid grid-cols-[1fr_auto_auto_auto_auto_auto] gap-3 px-4 py-2 border-b border-[#111]">
                      {["Player / Prop", "Line", "Mkt", "Edge", "Result", ""].map((h) => (
                        <span key={h} className="text-[9px] font-bold text-gray-700 uppercase tracking-wider font-condensed">
                          {h}
                        </span>
                      ))}
                    </div>
                    {filteredPicks.map((p) => <PickHistoryRow key={p.id} pick={p} />)}
                  </>
                );
              }

              // ── Streaks table ─────────────────────────────────────────
              // outcome filter applied first, then stat filter
              const outcomeFilteredStreaks = applyStreakFilter(streakOutcomes, streakFilter, "all");
              const filteredStreaks = streakStatFilter === "all"
                ? outcomeFilteredStreaks
                : outcomeFilteredStreaks.filter(r => r.stat === streakStatFilter);

              function tierColor(hit: boolean | null): string {
                if (hit === null) return "text-gray-600";
                return hit ? "text-over" : "text-under";
              }

              function renderStreaksTable() {
                if (streakLoading) {
                  return (
                    <div className="p-4 space-y-2">
                      {Array.from({ length: 5 }).map((_, i) => (
                        <Skeleton key={i} className="h-[52px] bg-[#141414] rounded" />
                      ))}
                    </div>
                  );
                }
                if (streakError) {
                  return (
                    <div className="px-4 py-8 text-center text-[11px] text-gray-700 font-condensed">
                      {streakError}
                    </div>
                  );
                }
                if (filteredStreaks.length === 0) {
                  return (
                    <div className="px-4 py-8 text-center text-[11px] text-gray-700 font-condensed">
                      No streaks in this period
                    </div>
                  );
                }
                return (
                  <>
                    {/* Column headers — match StreaksCard layout */}
                    <div className="flex items-center px-4 py-2 border-b border-[#111]">
                      <div className="flex-1 min-w-0 text-[9px] font-bold text-gray-700 font-condensed uppercase tracking-widest">
                        Player / Stat
                      </div>
                      <div className="flex flex-shrink-0 ml-3">
                        {["100%", "90%", "80%", "70%"].map((label) => (
                          <span key={label} className={cn("text-[9px] font-bold text-gray-700 font-condensed uppercase tracking-widest text-right", COL_W)}>
                            {label}
                          </span>
                        ))}
                      </div>
                      <div className="ml-4 w-16 text-right text-[9px] font-bold text-gray-700 font-condensed uppercase tracking-widest">
                        Result
                      </div>
                    </div>

                    {filteredStreaks.map((row, i) => (
                      <Link
                        key={`${row.player_id}|${row.stat}|${row.game_date}|${i}`}
                        to={`/player/${row.player_id}`}
                        className="flex items-center px-4 py-2.5 border-b border-[#0A0A0A] last:border-0 hover:bg-white/[0.01] transition-colors group"
                      >
                        {/* Left: player name + stat badge + team + date */}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-1.5 min-w-0">
                            <span className="text-[12px] font-semibold text-white font-condensed truncate group-hover:text-mint transition-colors">
                              {row.player_name ?? "—"}
                            </span>
                            <span className="flex-shrink-0 text-[8px] font-bold font-condensed uppercase tracking-wide px-1 py-0.5 rounded bg-[#1a1a1a] text-gray-500 border border-[#252525]">
                              {row.stat_label}
                            </span>
                          </div>
                          <div className="text-[10px] text-gray-600 font-condensed mt-0.5">
                            {row.team} · {row.game_date}
                          </div>
                        </div>

                        {/* 4 tier line values — colored by outcome */}
                        <div className="flex flex-shrink-0 ml-3">
                          {[
                            { line: row.line_100, hit: row.hit_100 },
                            { line: row.line_90,  hit: row.hit_90  },
                            { line: row.line_80,  hit: row.hit_80  },
                            { line: row.line_70,  hit: row.hit_70  },
                          ].map(({ line, hit }, idx) => (
                            <span
                              key={idx}
                              className={cn(
                                "text-[15px] font-black font-mono tabular-nums text-right leading-none",
                                COL_W,
                                tierColor(hit),
                              )}
                            >
                              {Math.round(line)}+
                            </span>
                          ))}
                        </div>

                        {/* Outcome badge */}
                        <div className="ml-4 w-16 flex-shrink-0 flex flex-col items-end justify-center">
                          {row.did_hit === null ? (
                            <span className="text-[10px] text-gray-600 font-condensed uppercase tracking-widest">
                              PEND
                            </span>
                          ) : row.did_hit ? (
                            <>
                              <span className="text-[11px] font-black text-over tracking-wide">HIT</span>
                              {row.actual != null && (
                                <span className="text-[9px] text-over/60 font-mono">got {row.actual}</span>
                              )}
                            </>
                          ) : (
                            <>
                              <span className="text-[11px] font-black text-under tracking-wide">MISS</span>
                              {row.actual != null && (
                                <span className="text-[9px] text-under/60 font-mono">got {row.actual}</span>
                              )}
                            </>
                          )}
                        </div>
                      </Link>
                    ))}
                  </>
                );
              }

              // ── Card shell ────────────────────────────────────────────
              return (
                <div className="bg-[#0D0D0D] border border-[#161616] rounded-2xl overflow-hidden">
                  {/* Top-level STREAKS / PICKS tabs */}
                  <div className="flex items-center border-b border-[#111]">
                    {(["streaks", "picks"] as BottomView[]).map((v) => (
                      <button
                        key={v}
                        onClick={() => setBottomView(v)}
                        className={cn(
                          "px-5 py-3.5 text-[11px] font-bold font-condensed tracking-[0.12em] uppercase transition-colors relative",
                          bottomView === v ? "text-white" : "text-gray-600 hover:text-gray-400",
                        )}
                      >
                        {v}
                        {bottomView === v && (
                          <span className="absolute bottom-0 left-1 right-1 h-0.5 bg-mint rounded-t-full" />
                        )}
                      </button>
                    ))}
                    <div className="flex-1 flex justify-end pr-4">
                      <span className="text-[9px] text-gray-700 font-condensed uppercase tracking-widest">
                        {bottomView === "streaks" ? "10-game window · next game outcome" : "most recent first"}
                      </span>
                    </div>
                  </div>

                  {bottomView === "streaks" && (
                    <>
                      {renderFilterTabs(streakOutcomes, streakFilter, setStreakFilter)}
                      {renderStatFilterRow(outcomeFilteredStreaks)}
                      {renderStreaksTable()}
                    </>
                  )}

                  {bottomView === "picks" && (
                    <>
                      {renderFilterTabs(data.recentPicks, pickFilter, setPickFilter)}
                      {renderPicksTable()}
                    </>
                  )}
                </div>
              );
            })()}
          </>
        )}
          </>
        )}
      </main>
    </div>
  );
}
