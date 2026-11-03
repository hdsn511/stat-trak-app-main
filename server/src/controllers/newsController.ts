import { Request, Response } from 'express';
import { supabaseAdmin } from '../config/supabaseAdmin';
import { league as resolveLeague } from '../config/leagues';

// Latest roster news (trades, signings, injuries, returns) from ESPN's public news
// feed. The feed mixes in highlights, recaps and previews, which are dropped; what
// is left is classified by keyword. Cached per league so a page view never waits
// on ESPN more than once every few minutes.

const SPORT: Record<string, string> = {
  nba: 'basketball/nba', nfl: 'football/nfl', nhl: 'hockey/nhl', mlb: 'baseball/mlb',
};
const KEEP_TYPES = new Set(['HeadlineNews', 'Story']);
const TRADE = /\b(trade[sd]?|trading|acquir\w*|deal|sign(s|ed|ing)?|waive[sd]?|releas\w*|claim(s|ed)?|extension|option|free agen\w*|roster move\w*)\b/i;
const INJURY = /\b(injur\w*|out|ruled out|missing|miss(es)?|sidelin\w*|questionable|doubtful|day-to-day|sprain\w*|strain\w*|surgery|fractur\w*|mri|return(s|ed|ing)?|week-to-week|concussion|illness|il|suspend\w*)\b/i;
const TTL_MS = 5 * 60 * 1000;
const cache = new Map<string, { at: number; items: NewsItem[] }>();

export interface NewsItem {
  id: string;
  kind: 'trade' | 'injury';
  headline: string;
  description: string | null;
  published: string;
  url: string | null;
  teams: string[];
  athlete: { name: string; headshot: string } | null;
}

/** Map ESPN team names ("LA Clippers") to our abbreviations by nickname. */
function teamMatcher(teams: { abbreviation: string; name: string }[]) {
  const byNick = teams.map((t) => ({ abbr: t.abbreviation, nick: (t.name ?? '').toLowerCase().split(' ').slice(-1)[0] }));
  return (espnName: string) => {
    const n = espnName.toLowerCase();
    return byNick.find((t) => t.nick && n.endsWith(t.nick))?.abbr ?? null;
  };
}

/** Headline only: features and recaps mention injuries in passing in their descriptions. */
export function classify(headline: string): NewsItem['kind'] | null {
  if (TRADE.test(headline)) return 'trade';
  if (INJURY.test(headline)) return 'injury';
  return null;
}

async function load(slug: string, leagueId: number): Promise<NewsItem[]> {
  const hit = cache.get(slug);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.items;
  const r = await fetch(`https://site.api.espn.com/apis/site/v2/sports/${SPORT[slug]}/news?limit=50`);
  if (!r.ok) throw new Error(`ESPN news ${r.status}`);
  const body: any = await r.json();
  const { data: teams } = await supabaseAdmin.from('teams').select('abbreviation,name').eq('league_id', leagueId);
  const toAbbr = teamMatcher((teams ?? []) as any[]);
  const sport = SPORT[slug]!.split('/')[1];
  const items: NewsItem[] = [];
  for (const a of body.articles ?? []) {
    if (!KEEP_TYPES.has(a.type)) continue;
    const kind = classify(a.headline ?? '');
    if (!kind) continue;
    const cats: any[] = a.categories ?? [];
    const ath = cats.find((c) => c.type === 'athlete' && c.athleteId);
    items.push({
      id: String(a.id),
      kind,
      headline: a.headline,
      description: a.description ?? null,
      published: a.published,
      url: a.links?.web?.href ?? null,
      teams: [...new Set(cats.filter((c) => c.type === 'team').map((c) => toAbbr(c.description ?? '')).filter(Boolean))] as string[],
      athlete: ath
        ? { name: ath.description, headshot: `https://a.espncdn.com/i/headshots/${sport}/players/full/${ath.athleteId}.png` }
        : null,
    });
  }
  items.sort((x, y) => y.published.localeCompare(x.published));
  cache.set(slug, { at: Date.now(), items });
  return items;
}

export async function getNews(_req: Request, res: Response) {
  try {
    const lg = resolveLeague(res);
    if (!SPORT[lg.slug]) return res.json({ success: true, data: { items: [] } });
    const items = await load(lg.slug, lg.leagueId);
    return res.json({ success: true, data: { items: items.slice(0, 12) } });
  } catch (err: any) {
    console.error('[getNews]', err);
    return res.status(502).json({ success: false, error: 'News is unavailable right now' });
  }
}
