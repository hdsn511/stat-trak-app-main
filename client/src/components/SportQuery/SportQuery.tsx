import { useParams } from 'react-router-dom'
import Sidebar from '../Sidebar/Sidebar'
import { ChatColumn } from './ChatColumn'

export function SportQuery() {
  const { sessionId } = useParams<{ sessionId?: string }>()

  return (
    <div className="flex h-full">
      <Sidebar />
      <main className="flex-1 overflow-hidden">
        <ChatColumn sessionId={sessionId} />
      </main>
    </div>
  )
}

export default SportQuery
