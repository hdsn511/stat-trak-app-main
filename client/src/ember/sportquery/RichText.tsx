import type { ReactNode } from 'react'

/** **bold** inside a line. */
function inline(text: string): ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*)/g).map((part, i) =>
    part.startsWith('**') && part.endsWith('**') ? (
      <strong key={i} className="font-bold text-[#EFEBE9]">
        {part.slice(2, -2)}
      </strong>
    ) : (
      part
    )
  )
}

/**
 * Minimal markdown for model narratives: blank-line paragraphs, "- " bullets,
 * and **bold**. Anything else renders as plain text, so odd model output
 * degrades to readable prose rather than raw markup soup.
 */
export default function RichText({ text }: { text: string }) {
  const blocks = text
    .replace(/\r/g, '')
    .trim()
    .split(/\n{2,}/)
  return (
    <div className="flex flex-col gap-[10px]">
      {blocks.map((block, i) => {
        const lines = block.split('\n').filter((l) => l.trim())
        const bullets = lines.filter((l) => /^\s*[-*•]\s+/.test(l))
        if (bullets.length === lines.length && bullets.length > 0) {
          return (
            <ul key={i} className="flex flex-col gap-[5px]">
              {lines.map((l, j) => (
                <li key={j} className="flex gap-2">
                  <span className="text-[#FF6B3D] shrink-0">▸</span>
                  <span>{inline(l.replace(/^\s*[-*•]\s+/, ''))}</span>
                </li>
              ))}
            </ul>
          )
        }
        return (
          <p key={i}>
            {lines.map((l, j) => (
              <span key={j}>
                {j > 0 && <br />}
                {inline(l)}
              </span>
            ))}
          </p>
        )
      })}
    </div>
  )
}
