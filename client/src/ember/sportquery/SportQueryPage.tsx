import { useCallback, useEffect, useRef, useState } from 'react'
import { useLocation } from 'react-router-dom'
import LiveTicker, { type TickerGame } from '@/ember/components/LiveTicker'
import ChatPane from './ChatPane'
import DetailPane from './DetailPane'
import { GAMES, INTENTS, matchIntent, type GameId, type Msg, type Selection } from './data'

const SEED_QUERY = "Who's hot from three over the last 10 games?"

const TICKER_GAMES: TickerGame[] = (Object.keys(GAMES) as GameId[]).map((id) => ({
  id,
  away: GAMES[id].a,
  home: GAMES[id].b,
  status: GAMES[id].st,
  live: GAMES[id].live,
}))

export default function SportQueryPage() {
  const [messages, setMessages] = useState<Msg[]>([
    { role: 'user', text: SEED_QUERY },
    { role: 'ai', intent: 'tp', query: SEED_QUERY, text: INTENTS.tp.text },
  ])
  const [typing, setTyping] = useState(false)
  const [sel, setSel] = useState<Selection | null>(null)
  const timer = useRef<number | undefined>(undefined)

  const ask = useCallback((text: string) => {
    const intent = matchIntent(text)
    setMessages((m) => [...m, { role: 'user', text }])
    setTyping(true)
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => {
      setMessages((m) => [...m, { role: 'ai', intent, query: text, text: INTENTS[intent].text }])
      setTyping(false)
    }, 700)
  }, [])

  // clear the pending reply timeout on unmount
  useEffect(() => () => window.clearTimeout(timer.current), [])

  // auto-ask an inbound query passed via router state (Home/NBA ask bars);
  // ref guard prevents double-fire under StrictMode
  const location = useLocation()
  const autoAsked = useRef(false)
  useEffect(() => {
    const state = location.state as { query?: unknown } | null
    const q = typeof state?.query === 'string' ? state.query.trim() : ''
    if (q && !autoAsked.current) {
      autoAsked.current = true
      ask(q)
    }
  }, [location.state, ask])

  return (
    <div className="h-[calc(100vh-58px)] overflow-hidden flex flex-col">
      <LiveTicker
        label="NBA · TONIGHT"
        games={TICKER_GAMES}
        onGameClick={(g) =>
          setSel({ type: 'game', id: g.id as GameId, msg: -1, query: 'LIVE TICKER', gmetric: 'pts' })
        }
      />
      <div className="flex-1 min-h-0 flex">
        <ChatPane messages={messages} typing={typing} sel={sel} onAsk={ask} onSelect={setSel} />
        {sel && <DetailPane sel={sel} onClose={() => setSel(null)} onChange={setSel} />}
      </div>
    </div>
  )
}
