import { BrowserRouter, Routes, Route, Link } from "react-router-dom";
import SearchPage from "./pages/SearchPage";

export default function App() {
  return (
    <BrowserRouter>
      <nav className="border-b px-4 py-2 flex gap-4 text-sm">
        <Link to="/" className="text-blue-600 hover:underline">Conversations</Link>
        <Link to="/search" className="text-blue-600 hover:underline">Search</Link>
      </nav>
      <Routes>
        <Route path="/" element={
          <div className="p-6 text-center text-gray-500">
            <h1 className="text-2xl font-semibold mb-2">Graft</h1>
            <p>Git for agent conversations</p>
            <p className="text-sm mt-4">Conversation list (DEV-A) coming soon.</p>
          </div>
        } />
        <Route path="/search" element={<SearchPage />} />
      </Routes>
    </BrowserRouter>
  );
}
