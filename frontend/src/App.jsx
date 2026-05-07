import { BrowserRouter, Routes, Route, Link } from 'react-router-dom'
import ConversationList from './pages/ConversationList'
import ConversationView from './pages/ConversationView'
// {/* DEV-B: import SearchPage and add its route below */}

export default function App() {
  return (
    <BrowserRouter>
      <div className="min-h-screen flex flex-col">
        <header className="border-b border-neutral-200 bg-white px-6 py-3">
          <Link to="/" className="font-semibold text-lg tracking-tight">
            Graft
          </Link>
        </header>
        <main className="flex-1">
          <Routes>
            <Route path="/" element={<ConversationList />} />
            <Route path="/conversations/:id" element={<ConversationView />} />
            {/* DEV-B: add SearchPage route */}
          </Routes>
        </main>
      </div>
    </BrowserRouter>
  )
}
