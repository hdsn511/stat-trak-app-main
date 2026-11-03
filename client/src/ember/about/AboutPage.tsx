import { SUPPORT_EMAIL } from '@/lib/site'

/** Who we are, where the data comes from, and how to reach us. Deliberately short. */
export default function AboutPage() {
  return (
    <main className="w-full max-w-[720px] mx-auto px-8 pt-14 pb-16">
      <h1 className="font-chakra italic font-bold text-[34px] leading-none text-[#EFEBE9]">
        About StatTrak<span className="text-[#FF6B3D]">.</span>
      </h1>
      <p className="mt-6 font-schibsted text-[16px] leading-[1.65] text-[#D8D2CE]">
        StatTrak tracks player and team performance across the NBA, NFL, MLB and NHL, and surfaces the trends, streaks
        and picks behind each slate.
      </p>

      <h2 className="mt-10 font-chakra italic font-bold text-[18px] text-[#EFEBE9]">Data</h2>
      <p className="mt-3 font-schibsted text-[15px] leading-[1.65] text-[#D8D2CE]">
        Scores, schedules, box scores and news come from ESPN and the MLB Stats API. Market prices come from Kalshi.
      </p>

      <h2 className="mt-10 font-chakra italic font-bold text-[18px] text-[#EFEBE9]">Trademarks</h2>
      <p className="mt-3 font-schibsted text-[15px] leading-[1.65] text-[#D8D2CE]">
        Team names, logos and player likenesses belong to their respective teams, leagues and owners. StatTrak is not
        affiliated with or endorsed by the NBA, NFL, MLB, NHL, ESPN or Kalshi. Everything here is for information only
        and is not betting advice.
      </p>

      <h2 className="mt-10 font-chakra italic font-bold text-[18px] text-[#EFEBE9]">Contact</h2>
      <p className="mt-3 font-schibsted text-[15px] leading-[1.65] text-[#D8D2CE]">
        Questions or takedown requests:{' '}
        <a href={`mailto:${SUPPORT_EMAIL}`} className="text-[#FF6B3D] underline underline-offset-2">
          {SUPPORT_EMAIL}
        </a>
      </p>
    </main>
  )
}
