import { Card, CardContent } from '@/components/ui/card'

type Props = { content: string }

export function UserMessage({ content }: Props) {
  return (
    <div className="flex justify-end animate-fade-up">
      <Card className="max-w-[75%] bg-[#141414] border-[#1e1e1e] rounded-2xl rounded-tr-sm shadow-none">
        <CardContent className="px-4 py-2 font-sans text-sm text-white">
          {content}
        </CardContent>
      </Card>
    </div>
  )
}
