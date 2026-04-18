import { useEffect, useRef } from 'react'
import type { ChatTurn } from './hooks/useSportQuery'
import { UserMessage } from './UserMessage'
import { AssistantMessage } from './AssistantMessage'

type Props = { turns: ChatTurn[]; showSuggestions: boolean }

export function MessageList({ turns, showSuggestions }: Props) {
  const endRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [turns])

  return (
    <div className="flex-1 overflow-y-auto px-6 py-6 space-y-4">
      {turns.map((t) =>
        t.role === 'user' ? (
          <UserMessage key={t.id} content={t.content} />
        ) : (
          <AssistantMessage
            key={t.id}
            turn={t}
            showSuggestions={showSuggestions}
          />
        )
      )}
      <div ref={endRef} />
    </div>
  )
}
