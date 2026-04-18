type Props = { content: string }

export function UserMessage({ content }: Props) {
  return (
    <div className="flex justify-end animate-fade-up">
      <div className="max-w-[75%] bg-[#141414] border border-[#1e1e1e] rounded-2xl rounded-tr-sm px-4 py-2 font-sans text-sm text-white">
        {content}
      </div>
    </div>
  )
}
