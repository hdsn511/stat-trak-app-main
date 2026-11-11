import { Link } from 'react-router-dom'
import { SUPPORT_EMAIL } from '@/lib/site'

/** Every page: where the data comes from, the trademark notice, and how to reach us. */
export default function SiteFooter() {
  return (
    <footer className="mt-auto border-t border-[#221D1A] bg-[#0D0B0A]">
      <div className="max-w-[1280px] mx-auto px-8 py-7 flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div className="max-w-[640px] font-schibsted text-[12px] leading-relaxed text-[#8A827E]">
          <p>
            Data from ESPN, the MLB Stats API, NBA.com and Kalshi. Weather by{' '}
            <a href="https://open-meteo.com/" className="underline" target="_blank" rel="noopener noreferrer">Open-Meteo</a>{' '}
            (CC BY 4.0).
          </p>
          <p className="mt-1">
            Team names and logos are trademarks of their respective teams and leagues. StatTrak is not affiliated with or
            endorsed by them. For information only, not betting advice. 18+. Problem gambling? Call 1-800-GAMBLER.
          </p>
        </div>
        <nav className="flex gap-5 font-martian text-[11px] tracking-[0.5px] text-[#C9C2BE]">
          <Link to="/about" className="hover:text-[#FF6B3D]">
            About
          </Link>
          <Link to="/terms" className="hover:text-[#FF6B3D]">
            Terms
          </Link>
          <Link to="/privacy" className="hover:text-[#FF6B3D]">
            Privacy
          </Link>
          <a href={`mailto:${SUPPORT_EMAIL}`} className="hover:text-[#FF6B3D]">
            {SUPPORT_EMAIL}
          </a>
        </nav>
      </div>
    </footer>
  )
}
