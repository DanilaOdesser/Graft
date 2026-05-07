/**
 * Phase 3 Verification Suite — Frontend Components
 * Run:  cd frontend && node tests/test_phase3.mjs
 */
import { readFileSync, existsSync } from "fs";
import { execSync } from "child_process";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FRONTEND = join(__dirname, "..");

// ── ANSI ────────────────────────────────────────────────────────────────────
const G = "\x1b[32m", R = "\x1b[31m", C = "\x1b[36m";
const B = "\x1b[1m", D = "\x1b[2m", X = "\x1b[0m";
const OK = `${G}\u2714${X}`, FAIL = `${R}\u2718${X}`;

let passed = 0, failed = 0;
const errors = [];

function section(t) {
  console.log(`\n${B}${C}${"─".repeat(60)}${X}`);
  console.log(`${B}${C}  ${t}${X}`);
  console.log(`${B}${C}${"─".repeat(60)}${X}`);
}

function test(name, ok, detail = "") {
  if (ok) { console.log(`  ${OK}  ${name}`); passed++; }
  else {
    const msg = detail ? `  ${FAIL}  ${name}  ${D}(${detail})${X}` : `  ${FAIL}  ${name}`;
    console.log(msg); failed++;
    errors.push(`${name}: ${detail}`);
  }
}

function read(relPath) {
  const full = join(FRONTEND, relPath);
  return existsSync(full) ? readFileSync(full, "utf8") : null;
}

// ═════════════════════════════════════════════════════════════════════════════
//  1. FILE EXISTENCE
// ═════════════════════════════════════════════════════════════════════════════
section("1. File Existence");

const files = [
  "src/api.js",
  "src/App.jsx",
  "src/pages/SearchPage.jsx",
  "src/components/SearchResults.jsx",
  "src/components/ImportModal.jsx",
  "src/components/PinsPanel.jsx",
  "src/main.jsx",
  "src/index.css",
  "vite.config.js",
  "package.json",
];

for (const f of files) {
  test(`${f} exists`, existsSync(join(FRONTEND, f)));
}

// ═════════════════════════════════════════════════════════════════════════════
//  2. API CLIENT — EXPORTS & ENDPOINTS
// ═════════════════════════════════════════════════════════════════════════════
section("2. api.js — Exports & Endpoint Coverage");

const apiSrc = read("src/api.js");
test("api.js readable", !!apiSrc);

if (apiSrc) {
  test("Exports DEFAULT_USER_ID", apiSrc.includes("export const DEFAULT_USER_ID"));
  test("DEFAULT_USER_ID is valid UUID format",
    /DEFAULT_USER_ID\s*=\s*"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}"/.test(apiSrc));
  test("Exports api object", apiSrc.includes("export const api"));

  // DEV-B required methods
  const devBMethods = [
    "search", "createNode", "getNode", "getDivergence",
    "createPin", "getPins", "deletePin",
    "createImport", "getImports", "deleteImport",
  ];
  for (const m of devBMethods) {
    test(`api.${m} defined`, apiSrc.includes(`${m}:`), "missing");
  }

  // DEV-A methods (needed by components)
  test("api.getConversation defined", apiSrc.includes("getConversation:"));

  // URL construction
  test("search encodes query param", apiSrc.includes("encodeURIComponent"));
  test("DELETE returns raw response", apiSrc.includes('method === "DELETE"'));
}

// ═════════════════════════════════════════════════════════════════════════════
//  3. APP.JSX — ROUTING
// ═════════════════════════════════════════════════════════════════════════════
section("3. App.jsx — Routing");

const appSrc = read("src/App.jsx");
test("App.jsx readable", !!appSrc);

if (appSrc) {
  test("Imports BrowserRouter", appSrc.includes("BrowserRouter"));
  test("Imports Routes and Route", appSrc.includes("Routes") && appSrc.includes("Route"));
  test("Imports SearchPage", appSrc.includes('import SearchPage'));
  test('Has / route', appSrc.includes('path="/"'));
  test('Has /search route', appSrc.includes('path="/search"'));
  test("SearchPage rendered on /search",
    appSrc.includes("<SearchPage") && appSrc.includes('/search'));
  test("Nav has Conversations link", appSrc.includes("Conversations"));
  test("Nav has Search link", appSrc.includes(">Search<"));
}

// ═════════════════════════════════════════════════════════════════════════════
//  4. SEARCH PAGE
// ═════════════════════════════════════════════════════════════════════════════
section("4. SearchPage.jsx — Structure");

const searchSrc = read("src/pages/SearchPage.jsx");
test("SearchPage.jsx readable", !!searchSrc);

if (searchSrc) {
  test("Imports useState", searchSrc.includes("useState"));
  test("Imports api and DEFAULT_USER_ID",
    searchSrc.includes("api") && searchSrc.includes("DEFAULT_USER_ID"));
  test("Imports SearchResults component", searchSrc.includes("SearchResults"));
  test("Imports ImportModal component", searchSrc.includes("ImportModal"));

  // State hooks
  test("Has query state", searchSrc.includes('useState("")'));
  test("Has results state", searchSrc.includes("useState([])"));
  test("Has loading state", searchSrc.includes("useState(false)"));
  test("Has importTarget state", searchSrc.includes("useState(null)"));

  // Search functionality
  test("Calls api.search", searchSrc.includes("api.search"));
  test("Uses DEFAULT_USER_ID in search", searchSrc.includes("DEFAULT_USER_ID"));
  test("Has search input", searchSrc.includes("<input"));
  test("Has search button", searchSrc.includes("<button"));
  test("Enter key triggers search", searchSrc.includes("onKeyDown") && searchSrc.includes("Enter"));
  test("Skips empty query", searchSrc.includes("!query.trim()"));

  // Component composition
  test("Renders SearchResults", searchSrc.includes("<SearchResults"));
  test("Renders ImportModal conditionally",
    searchSrc.includes("importTarget &&") && searchSrc.includes("<ImportModal"));
  test("Back link to /", searchSrc.includes('href="/"'));
}

// ═════════════════════════════════════════════════════════════════════════════
//  5. SEARCH RESULTS
// ═════════════════════════════════════════════════════════════════════════════
section("5. SearchResults.jsx — Structure");

const resultsSrc = read("src/components/SearchResults.jsx");
test("SearchResults.jsx readable", !!resultsSrc);

if (resultsSrc) {
  test("Default export function", resultsSrc.includes("export default function SearchResults"));
  test("Props: results, onImport, onView",
    resultsSrc.includes("results") && resultsSrc.includes("onImport") && resultsSrc.includes("onView"));
  test("Returns null on empty results", resultsSrc.includes("!results.length") && resultsSrc.includes("return null"));
  test("Shows result count", resultsSrc.includes("results.length"));
  test("Maps over results", resultsSrc.includes("results.map"));
  test("Uses node_id as key", resultsSrc.includes("key={r.node_id}"));
  test("Truncates content at 200 chars", resultsSrc.includes(".slice(0, 200)"));
  test("Shows role", resultsSrc.includes("r.role"));
  test("Shows branch_name", resultsSrc.includes("r.branch_name"));
  test("Shows conversation_title", resultsSrc.includes("r.conversation_title"));
  test("Shows relevance rank", resultsSrc.includes("r.rank.toFixed(2)"));
  test("View in context button", resultsSrc.includes("View in context"));
  test("Import to... button", resultsSrc.includes("Import to..."));
  test("onView callback wired", resultsSrc.includes("onView(r)"));
  test("onImport callback wired", resultsSrc.includes("onImport(r)"));
}

// ═════════════════════════════════════════════════════════════════════════════
//  6. IMPORT MODAL
// ═════════════════════════════════════════════════════════════════════════════
section("6. ImportModal.jsx — Structure");

const modalSrc = read("src/components/ImportModal.jsx");
test("ImportModal.jsx readable", !!modalSrc);

if (modalSrc) {
  test("Default export function", modalSrc.includes("export default function ImportModal"));
  test("Props: sourceNode, conversationId, onClose",
    modalSrc.includes("sourceNode") && modalSrc.includes("conversationId") && modalSrc.includes("onClose"));
  test("Imports useState and useEffect", modalSrc.includes("useState") && modalSrc.includes("useEffect"));
  test("Imports api and DEFAULT_USER_ID",
    modalSrc.includes("api") && modalSrc.includes("DEFAULT_USER_ID"));

  // State
  test("Has branches state", modalSrc.includes("setBranches"));
  test("Has targetBranchId state", modalSrc.includes("setTargetBranchId"));
  test("Has includeDescendants state", modalSrc.includes("setIncludeDescendants"));
  test("Has importing state", modalSrc.includes("setImporting"));

  // Functionality
  test("Fetches conversation for branches", modalSrc.includes("api.getConversation"));
  test("Calls api.createImport", modalSrc.includes("api.createImport"));
  test("Passes source_node_id", modalSrc.includes("source_node_id"));
  test("Passes include_descendants", modalSrc.includes("include_descendants"));
  test("Passes imported_by", modalSrc.includes("imported_by"));
  test("Calls onClose after import", modalSrc.includes("onClose()"));
  test("Guards against empty targetBranchId", modalSrc.includes("!targetBranchId"));

  // UI
  test("Has backdrop overlay", modalSrc.includes("fixed inset-0"));
  test("Has branch select dropdown", modalSrc.includes("<select"));
  test("Has include descendants checkbox", modalSrc.includes('type="checkbox"'));
  test("Has Cancel button", modalSrc.includes("Cancel"));
  test("Has Import button", modalSrc.includes("Import"));
  test("Shows source content preview", modalSrc.includes("sourceNode.content"));
  test("Disabled state on import button", modalSrc.includes("disabled="));
}

// ═════════════════════════════════════════════════════════════════════════════
//  7. PINS PANEL
// ═════════════════════════════════════════════════════════════════════════════
section("7. PinsPanel.jsx — Structure");

const pinsSrc = read("src/components/PinsPanel.jsx");
test("PinsPanel.jsx readable", !!pinsSrc);

if (pinsSrc) {
  test("Default export function", pinsSrc.includes("export default function PinsPanel"));
  test("Props: branchId, onClose",
    pinsSrc.includes("branchId") && pinsSrc.includes("onClose"));
  test("Imports useState and useEffect", pinsSrc.includes("useState") && pinsSrc.includes("useEffect"));
  test("Imports api", pinsSrc.includes("from \"../api\""));

  // Functionality
  test("Fetches pins via api.getPins", pinsSrc.includes("api.getPins"));
  test("Deletes pin via api.deletePin", pinsSrc.includes("api.deletePin"));
  test("Filters out deleted pin from state", pinsSrc.includes("pins.filter"));

  // UI
  test("Shows 'Pinned Context' header", pinsSrc.includes("Pinned Context"));
  test("Has close button", pinsSrc.includes("close"));
  test("Shows empty state message", pinsSrc.includes("No pins on this branch"));
  test("Maps over pins", pinsSrc.includes("pins.map"));
  test("Shows priority badge", pinsSrc.includes("pin.priority"));
  test("Shows pin reason", pinsSrc.includes("pin.reason"));
  test("Has Unpin button", pinsSrc.includes("Unpin"));
  test("Uses pin.id as key", pinsSrc.includes("key={pin.id}"));
}

// ═════════════════════════════════════════════════════════════════════════════
//  8. TAILWIND CSS SETUP
// ═════════════════════════════════════════════════════════════════════════════
section("8. Tailwind & Vite Config");

const indexCss = read("src/index.css");
test("index.css imports tailwindcss", !!indexCss && indexCss.includes("tailwindcss"));

const viteCfg = read("vite.config.js");
test("vite.config.js readable", !!viteCfg);
if (viteCfg) {
  test("Vite uses react plugin", viteCfg.includes("react"));
  test("Vite uses tailwindcss plugin", viteCfg.includes("tailwindcss"));
}

const pkg = read("package.json");
if (pkg) {
  const deps = JSON.parse(pkg);
  test("react in dependencies", !!deps.dependencies?.react);
  test("react-router-dom in dependencies",
    !!(deps.dependencies?.["react-router-dom"] || deps.devDependencies?.["react-router-dom"]));
  test("tailwindcss in devDependencies",
    !!(deps.devDependencies?.tailwindcss || deps.devDependencies?.["@tailwindcss/vite"]));
}

// ═════════════════════════════════════════════════════════════════════════════
//  9. PRODUCTION BUILD
// ═════════════════════════════════════════════════════════════════════════════
section("9. Production Build");

try {
  const buildOut = execSync("npm run build 2>&1", { cwd: FRONTEND, encoding: "utf8" });
  const buildOk = buildOut.includes("built in");
  test("npm run build succeeds", buildOk, buildOk ? "" : buildOut.slice(-200));

  if (buildOk) {
    test("dist/index.html generated", existsSync(join(FRONTEND, "dist/index.html")));

    // Check that JS bundle was produced
    const distAssets = execSync("ls dist/assets/*.js 2>/dev/null || true", { cwd: FRONTEND, encoding: "utf8" });
    test("JS bundle generated", distAssets.includes(".js"));

    // Check CSS bundle
    const distCss = execSync("ls dist/assets/*.css 2>/dev/null || true", { cwd: FRONTEND, encoding: "utf8" });
    test("CSS bundle generated", distCss.includes(".css"));

    // Check bundle references our components (not tree-shaken away)
    const jsBundle = execSync("cat dist/assets/*.js", { cwd: FRONTEND, encoding: "utf8" });
    test("Bundle includes SearchResults text", jsBundle.includes("results") || jsBundle.includes("Relevance"));
    test("Bundle includes ImportModal text", jsBundle.includes("Import") || jsBundle.includes("branch"));
    // PinsPanel is tree-shaken (not imported by any route yet — DEV-A wires it in ConversationView)
    test("PinsPanel source exists (tree-shaken from bundle until DEV-A integrates)",
      existsSync(join(FRONTEND, "src/components/PinsPanel.jsx")));
  }
} catch (e) {
  test("npm run build succeeds", false, e.message.slice(0, 200));
}

// ═════════════════════════════════════════════════════════════════════════════
//  RESULTS
// ═════════════════════════════════════════════════════════════════════════════

const total = passed + failed;
console.log(`\n${B}${"═".repeat(60)}${X}`);
if (failed === 0) {
  console.log(`${B}${G}  ALL ${total} TESTS PASSED${X}`);
} else {
  console.log(`${B}${R}  ${failed} FAILED${X}  ${B}${G}${passed} PASSED${X}  ${D}(of ${total})${X}`);
  console.log(`\n${R}  Failures:${X}`);
  for (const e of errors) console.log(`    ${FAIL}  ${e}`);
}
console.log(`${B}${"═".repeat(60)}${X}\n`);

process.exit(failed ? 1 : 0);
