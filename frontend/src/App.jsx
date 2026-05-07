import { BrowserRouter, Routes, Route, Link } from "react-router-dom";
import ConversationList from "./pages/ConversationList";
import ConversationView from "./pages/ConversationView";
import SearchPage from "./pages/SearchPage";

export default function App() {
  return (
    <BrowserRouter>
      <nav className="border-b px-4 py-2 flex gap-4 text-sm bg-white">
        <Link to="/" className="font-semibold">Graft</Link>
        <Link to="/" className="text-blue-600 hover:underline">Conversations</Link>
        <Link to="/search" className="text-blue-600 hover:underline">Search</Link>
      </nav>
      <Routes>
        <Route path="/" element={<ConversationList />} />
        <Route path="/conversations/:id" element={<ConversationView />} />
        <Route path="/search" element={<SearchPage />} />
      </Routes>
    </BrowserRouter>
  );
}
