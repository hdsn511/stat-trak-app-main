import { useSportQuery } from './hooks/useSportQuery'
import { MessageList } from './MessageList'
import { ChatInput } from './ChatInput'
import { EmptyState } from './EmptyState'
import { SessionSwitcher } from './SessionSwitcher'
import { SuggestionsToggle } from './SuggestionsToggle'
import { useShowSuggestions } from './hooks/useShowSuggestions'

type Props = { sessionId?: string }

export function ChatColumn({ sessionId }: Props) {
  const { turns, isSending, send } = useSportQuery(sessionId)
  const [showSuggestions, setShowSuggestions] = useShowSuggestions()

  return (
    <div className="flex flex-col h-full max-w-3xl mx-auto w-full">
      <div className="flex items-center justify-between px-6 py-3 border-b border-[#161616]">
        <div className="font-condensed text-[10px] uppercase tracking-[0.3em] text-gray-600">
          SportQuery
        </div>
        <div className="flex items-center gap-4">
          <SuggestionsToggle show={showSuggestions} onChange={setShowSuggestions} />
          <SessionSwitcher />
        </div>
      </div>

      {turns.length === 0 ? (
        <EmptyState onPick={send} />
      ) : (
        <MessageList turns={turns} showSuggestions={showSuggestions} />
      )}

      <ChatInput onSend={send} disabled={isSending} />
    </div>
  )
}
