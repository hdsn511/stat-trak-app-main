import { ResultCardList } from './ResultCardList'
import type { ChatTurn } from './hooks/useSportQuery'

type Props = { turn: ChatTurn; showSuggestions: boolean }

export function AssistantMessage({ turn, showSuggestions }: Props) {
  const { content, rows, disambiguation, follow_up_suggestions, isStreaming } =
    turn

  return (
    <div className="flex justify-start animate-fade-up">
      <div className="max-w-[85%] bg-[#0D0D0D] border border-[#161616] rounded-2xl rounded-tl-sm px-4 py-3">
        <div className="font-sans text-sm text-gray-200 whitespace-pre-wrap">
          {content || (isStreaming ? '…' : '')}
          {isStreaming && (
            <span className="inline-block ml-1 w-1.5 h-1.5 rounded-full bg-mint animate-pulse-live align-middle" />
          )}
        </div>

        {disambiguation && disambiguation.candidates.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-2">
            {disambiguation.candidates.map((c) => (
              <span
                key={c}
                className="text-[10px] font-condensed uppercase tracking-[0.2em] text-mint bg-mint/10 border border-mint/30 rounded-full px-2 py-1"
              >
                {c}
              </span>
            ))}
          </div>
        )}

        {rows && rows.length > 0 && <ResultCardList rows={rows} />}

        {showSuggestions &&
          follow_up_suggestions &&
          follow_up_suggestions.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-2">
              {follow_up_suggestions.map((s) => (
                <span
                  key={s}
                  className="text-[10px] font-condensed uppercase tracking-[0.2em] text-gray-400 bg-[#141414] border border-[#1e1e1e] rounded-full px-2 py-1"
                >
                  {s}
                </span>
              ))}
            </div>
          )}
      </div>
    </div>
  )
}
