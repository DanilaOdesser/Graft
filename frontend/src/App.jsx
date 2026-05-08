import { BrowserRouter, Routes, Route, Link, useLocation } from "react-router-dom";
import ConversationList from "./pages/ConversationList";
import ConversationView from "./pages/ConversationView";
import SearchPage from "./pages/SearchPage";

function NavLink({ to, children, exact }) {
  const { pathname } = useLocation();
  const active = exact ? pathname === to : pathname.startsWith(to);
  return (
    <Link
      to={to}
      className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[13px] font-medium transition-colors ${
        active
          ? "bg-[var(--color-blue-dim)] text-[var(--color-blue)]"
          : "text-[var(--color-text-dim)] hover:text-[var(--color-text)] hover:bg-[var(--color-surface-2)]"
      }`}
    >
      {children}
    </Link>
  );
}

function Nav() {
  return (
    <nav className="sticky top-0 z-40 h-12 border-b border-[var(--color-border)] bg-[var(--color-surface)]/80 backdrop-blur-lg">
      <div className="h-full max-w-[1400px] mx-auto px-4 flex items-center justify-between">
        <Link to="/" className="flex items-center gap-2 group">
          <div className="w-6 h-6 rounded bg-[var(--color-blue)] flex items-center justify-center text-white text-[11px] font-bold font-[family-name:var(--font-mono)]">G</div>
          <span className="font-[family-name:var(--font-display)] font-bold text-sm text-[var(--color-text)]">Graft</span>
        </Link>
        <div className="flex items-center gap-0.5">
          <NavLink to="/" exact>Conversations</NavLink>
          <NavLink to="/search">Search</NavLink>
        </div>
      </div>
    </nav>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <div className="h-screen overflow-hidden flex flex-col bg-[var(--color-bg)]">
        <Nav />
        <main className="flex-1 flex flex-col min-h-0 overflow-y-auto">
          <Routes>
            <Route path="/" element={<ConversationList />} />
            <Route path="/conversations/:id" element={<ConversationView />} />
            <Route path="/search" element={<SearchPage />} />
          </Routes>
        </main>
      </div>
    </BrowserRouter>
  );
}
