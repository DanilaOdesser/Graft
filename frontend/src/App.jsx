import { BrowserRouter, Routes, Route, Link } from "react-router-dom";
import ConversationList from "./pages/ConversationList";
import ConversationView from "./pages/ConversationView";
import SearchPage from "./pages/SearchPage";

function NavLink({ to, children }) {
  const location = useLocation();
  const active = location.pathname === to;
  return (
    <Link
      to={to}
      className={`px-3 py-1.5 rounded-md text-sm font-medium transition-all duration-200 ${
        active
          ? "bg-[var(--color-cyan-dim)] text-[var(--color-cyan)]"
          : "text-[var(--color-text-dim)] hover:text-[var(--color-text)] hover:bg-[var(--color-surface-2)]"
      }`}
    >
      {children}
    </Link>
  );
}

function Nav() {
  return (
    <nav className="sticky top-0 z-40 border-b border-[var(--color-border)] bg-[var(--color-surface)]/80 backdrop-blur-xl">
      <div className="max-w-5xl mx-auto px-6 h-14 flex items-center justify-between">
        <Link to="/" className="flex items-center gap-2.5 group">
          <div className="w-7 h-7 rounded-md bg-gradient-to-br from-[var(--color-cyan)] to-[var(--color-violet)] flex items-center justify-center text-[var(--color-bg)] text-xs font-bold font-[family-name:var(--font-mono)] transition-transform duration-200 group-hover:scale-110">
            G
          </div>
          <span className="font-[family-name:var(--font-display)] font-bold text-lg tracking-tight text-[var(--color-text)]">
            Graft
          </span>
          <span className="hidden sm:inline font-[family-name:var(--font-mono)] text-[10px] text-[var(--color-text-faint)] bg-[var(--color-surface-2)] px-1.5 py-0.5 rounded border border-[var(--color-border)]">
            v0.1
          </span>
        </Link>
        <div className="flex items-center gap-1">
          <NavLink to="/">
            <span className="flex items-center gap-1.5">
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
              </svg>
              Chats
            </span>
          </NavLink>
          <NavLink to="/search">
            <span className="flex items-center gap-1.5">
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
              Search
            </span>
          </NavLink>
        </div>
      </div>
    </nav>
  );
}

function HomePage() {
  return (
    <div className="flex-1 flex flex-col items-center justify-center px-6 animate-fade-in-up">
      <div className="max-w-md text-center">
        <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-[var(--color-cyan)] to-[var(--color-violet)] mx-auto mb-6 flex items-center justify-center text-[var(--color-bg)] text-2xl font-bold font-[family-name:var(--font-mono)] shadow-lg shadow-[var(--color-cyan-dim)]">
          G
        </div>
        <h1 className="font-[family-name:var(--font-display)] text-3xl font-extrabold tracking-tight text-[var(--color-text)] mb-3">
          Git for Conversations
        </h1>
        <p className="text-[var(--color-text-dim)] leading-relaxed mb-8">
          Branch, pin, cherry-pick, and search across your AI agent conversations.
          Never lose context again.
        </p>
        <div className="flex items-center justify-center gap-3">
          <Link
            to="/search"
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-[var(--color-cyan)] text-[var(--color-bg)] font-semibold text-sm hover:brightness-110 transition-all duration-200 shadow-lg shadow-[var(--color-cyan-dim)]"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            Search conversations
          </Link>
        </div>
        <div className="mt-12 grid grid-cols-3 gap-4 text-center">
          {[
            { icon: "⑂", label: "Branch", desc: "Fork conversations" },
            { icon: "⊕", label: "Cherry-pick", desc: "Import context" },
            { icon: "◉", label: "Pin", desc: "Lock key context" },
          ].map((f) => (
            <div key={f.label} className="p-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)]">
              <div className="text-xl mb-1 text-[var(--color-cyan)]">{f.icon}</div>
              <div className="text-xs font-semibold text-[var(--color-text)] mb-0.5">{f.label}</div>
              <div className="text-[10px] text-[var(--color-text-faint)]">{f.desc}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

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
