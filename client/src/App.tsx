import { Route, Routes } from 'react-router-dom'

export default function App() {
  return (
    <div className="bg-[#0A0A0A] min-h-screen text-white">
      <Routes>
        <Route path="*" element={<div className="p-8">StatTrak — refactor in progress</div>} />
      </Routes>
    </div>
  )
}
