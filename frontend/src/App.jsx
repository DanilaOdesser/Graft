import { BrowserRouter, Routes, Route, Link, useLocation, useNavigate, Navigate } from "react-router-dom";
import ConversationList from "./pages/ConversationList";
import ConversationView from "./pages/ConversationView";
import SearchPage from "./pages/SearchPage";
import LoginPage from "./pages/LoginPage";
import RegisterPage from "./pages/RegisterPage";
import { AuthProvider, useAuth } from "./AuthContext";

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
  const { user, logout } = useAuth();
  const navigate = useNavigate();
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
        {user && (
          <div className="flex items-center gap-3">
            <span className="text-[12px] text-[var(--color-text-faint)] hidden sm:block">{user.display_name}</span>
            <button
              onClick={() => { logout(); navigate("/login"); }}
              className="px-3 py-1.5 rounded-md text-[13px] font-medium text-[var(--color-text-dim)] hover:text-[var(--color-text)] hover:bg-[var(--color-surface-2)] transition-colors"
            >
              Sign out
            </button>
          </div>
        )}
      </div>
    </nav>
  );
}

function ProtectedRoute({ children }) {
  const { user } = useAuth();
  if (!user) return <Navigate to="/login" replace />;
  return children;
}

function AppShell() {
  const { pathname } = useLocation();
  const isAuthPage = pathname === "/login" || pathname === "/register";

  return (
    <div className={`${isAuthPage ? "min-h-screen" : "h-screen overflow-hidden"} flex flex-col bg-[var(--color-bg)]`}>
      {!isAuthPage && <Nav />}
      <main className={`flex-1 flex flex-col${!isAuthPage ? " min-h-0 overflow-y-auto" : ""}`}>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/register" element={<RegisterPage />} />
          <Route path="/" element={<ProtectedRoute><ConversationList /></ProtectedRoute>} />
          <Route path="/conversations/:id" element={<ProtectedRoute><ConversationView /></ProtectedRoute>} />
          <Route path="/search" element={<ProtectedRoute><SearchPage /></ProtectedRoute>} />
        </Routes>
      </main>
    </div>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <AppShell />
      </BrowserRouter>
    </AuthProvider>
  );
}
