import { useState, useEffect, createContext, useContext, Fragment } from "react";
import LoginPage    from "./views/LoginPage";
import Dashboard    from "./views/Dashboard";
import ProjectView  from "./views/ProjectView";
import MyTasks      from "./views/MyTasks";
import AdminUsers   from "./views/AdminUsers";
import ProjectUsers   from "./views/ProjectUsers";
import ProjectAnalytics from "./views/ProjectAnalytics";
import Layout       from "./components/Layout";
import { tr, trVal, getLang, setLang as setLangLocal, hasExplicitChoice } from "./i18n";

export const AuthContext     = createContext(null);
export const BrandingContext = createContext({ app_name:"Kairos", logo_letter:"K", primary_color:"#0F766E", logo_svg:"/kairos-icon.svg" });

export const useAuth     = () => useContext(AuthContext);
export const useBranding = () => useContext(BrandingContext);
export const LangContext = createContext({ lang:"en", changeLang:()=>{} });
export const useLang     = () => useContext(LangContext);

// Use relative URL when served by FastAPI; fallback to localhost for dev
const API = window.location.port === "5173" ? "http://localhost:8000/api" : "/api";

// Display dates as dd-mm-yyyy everywhere in the UI. Storage, the API, and
// every <input type="date"> stay ISO (yyyy-mm-dd) — that format is fixed by
// the HTML date input spec and can't be changed; this only affects how a
// date is shown as plain text.
// Hebrew (U+0590-05FF) or Arabic (U+0600-06FF) anywhere in the text switches
// that field to RTL. Free-text fields (description, comments) can legitimately
// be typed in either direction depending on who's writing, unlike the rest of
// the app's chrome, which stays LTR — see index.css.
export function isRTL(text) {
  if (!text) return false;
  return /[\u0590-\u05FF\u0600-\u06FF]/.test(text);
}

// Minimal markdown for comments: **bold**, *italic*, and "1. item" numbered
// lines. Deliberately not a real markdown parser (no nesting, no links,
// no code blocks) — comments compose this with @mention highlighting
// (see parseCommentBody below), so keeping the grammar tiny keeps the two
// concerns from colliding, e.g. "*" inside a mention or "1." at a line
// start that isn't meant as a list.
//
// Returns an array of React nodes for one line's worth of text (no
// newlines) — callers that also need @mention highlighting should run
// splitMentions() first and pass this over each non-mention chunk.
export function renderInlineMarkdown(text, keyPrefix = "") {
  if (!text) return [text];
  const parts = String(text).split(/(\*\*[^*]+\*\*|\*[^*]+\*)/g);
  return parts.map((part, i) => {
    if (part.startsWith("**") && part.endsWith("**") && part.length > 4) {
      return <strong key={`${keyPrefix}b${i}`}>{part.slice(2, -2)}</strong>;
    }
    if (part.startsWith("*") && part.endsWith("*") && part.length > 2) {
      return <em key={`${keyPrefix}i${i}`}>{part.slice(1, -1)}</em>;
    }
    return part;
  });
}

// Splits a full comment body into lines, rendering **bold**/*italic* per
// line and grouping consecutive "N. " lines into a real <ol> so a typed
// numbered list actually looks like one instead of literal "1. " text.
export function renderCommentMarkdown(text, mentionRenderer) {
  if (!text) return null;
  const lines = String(text).split("\n");
  const blocks = [];
  let listItems = null;

  const renderLine = (line, key) => {
    // @mention highlighting runs first (it already exists and works well);
    // markdown is applied inside each non-mention chunk it produces.
    const chunks = mentionRenderer ? mentionRenderer(line, key) : [line];
    return chunks.flatMap((chunk, ci) =>
      typeof chunk === "string"
        ? renderInlineMarkdown(chunk, `${key}-${ci}-`)
        : [chunk]
    );
  };

  lines.forEach((line, idx) => {
    const m = line.match(/^\d+\.\s+(.*)$/);
    if (m) {
      if (!listItems) listItems = [];
      listItems.push(<li key={`li${idx}`}>{renderLine(m[1], `l${idx}`)}</li>);
      return;
    }
    if (listItems) {
      blocks.push(<ol key={`ol${idx}`} style={{ margin: "4px 0", paddingInlineStart: 20 }}>{listItems}</ol>);
      listItems = null;
    }
    blocks.push(
      <span key={`ln${idx}`}>
        {renderLine(line, `p${idx}`)}
        {idx < lines.length - 1 && <br />}
      </span>
    );
  });
  if (listItems) {
    blocks.push(<ol key="ol-end" style={{ margin: "4px 0", paddingInlineStart: 20 }}>{listItems}</ol>);
  }
  return blocks;
}

export function fmtDate(iso) {
  if (!iso) return "";
  const datePart = String(iso).slice(0, 10);          // strips any time part
  const m = datePart.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return datePart;                              // not ISO — show as-is
  const [, y, mo, d] = m;
  return `${d}-${mo}-${y}`;
}

// Same, but keeps the HH:MM that several places append after slice(0,16).
export function fmtDateTime(iso) {
  if (!iso) return "";
  const s = String(iso);
  const datePart = fmtDate(s.slice(0, 10));
  const timePart = s.slice(11, 16);                      // "HH:MM" if present
  return timePart ? `${datePart} ${timePart}` : datePart;
}

export function apiFetch(path, options = {}) {
  return fetch(`${API}${path}`, {
    credentials: "include",
    headers: { "Content-Type": "application/json", ...options.headers },
    ...options,
  }).then(async (res) => {
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(typeof err.detail === "string" ? tr(err.detail) : tr("Request failed"));
    }
    const data = await res.json();
    // Tell the sidebar when a project was created / renamed / archived / deleted
    // or its members changed, so it reloads without a manual page refresh.
    const method = (options.method || "GET").toUpperCase();
    if (method !== "GET" &&
        /^\/projects(\/\d+)?(\/(archive|unarchive|members)(\/\d+)?)?$/.test(String(path).split("?")[0])) {
      window.dispatchEvent(new Event("kairos:projects-changed"));
    }
    return data;
  });
}

export default function App() {
  // Page direction/lang follow the chosen language (see i18n.js); it is applied
  // when the language is set, and once at start-up when i18n.js loads.
  const [lang, setLangState] = useState(getLang());

  const [user, setUser]         = useState(undefined);
  const [branding, setBranding] = useState({ app_name:"TaskMaster", logo_letter:"T", primary_color:"#3b82f6" });
  const [page, setPage]         = useState({ name:"dashboard", params:{} });

  useEffect(() => {
    // Load branding first (no auth needed)
    apiFetch("/branding").then(setBranding).catch(() => {});
    // Then check session
    apiFetch("/auth/me").then(d => { setUser(d.user); syncLang(d.user); }).catch(() => setUser(null));
  }, []);

  // Choosing a language: apply it here immediately and remember it on the server
  // (users.language) so e-mails and bell notifications arrive in that language too.
  const changeLang = (next) => {
    setLangLocal(next, true);
    setLangState(getLang());
    if (user) apiFetch("/users/me/language", { method:"PUT", body: JSON.stringify({ language: next }) }).catch(() => {});
  };

  // After login / session restore: a language picked on this device wins and is
  // pushed to the server; otherwise the server's saved choice is used.
  const syncLang = (u) => {
    if (!u) return;
    if (hasExplicitChoice()) {
      if (u.language !== getLang())
        apiFetch("/users/me/language", { method:"PUT", body: JSON.stringify({ language: getLang() }) }).catch(() => {});
    } else if (u.language && u.language !== getLang()) {
      setLangLocal(u.language, false);
      setLangState(getLang());
    }
  };

  // Update page title from branding
  useEffect(() => {
    document.title = branding.app_name;
  }, [branding.app_name]);

  if (user === undefined) {
    return (
      <BrandingContext.Provider value={branding}>
        <div style={{ display:"flex", height:"100vh", alignItems:"center", justifyContent:"center", background:"#0f172a" }}>
          <div style={{ color:"#94a3b8", fontFamily:"monospace", fontSize:14 }}>{tr("Loading")} {branding.app_name}…</div>
        </div>
      </BrandingContext.Provider>
    );
  }

  if (!user) {
    return (
      <BrandingContext.Provider value={branding}>
        <LangContext.Provider value={{ lang, changeLang }}>
          <AuthContext.Provider value={{ user, setUser }}>
            <Fragment key={lang}>
              <LoginPage onLogin={(u) => { setUser(u); syncLang(u); setPage({ name:"dashboard", params:{} }); }} />
            </Fragment>
          </AuthContext.Provider>
        </LangContext.Provider>
      </BrandingContext.Provider>
    );
  }

  const renderPage = () => {
    switch (page.name) {
      case "project":       return <ProjectView  projectId={page.params.projectId} navigate={setPage} />;
      case "project-users":    return <ProjectUsers    projectId={page.params.projectId} navigate={setPage} />;
      case "project-analytics": return <ProjectAnalytics projectId={page.params.projectId} navigate={setPage} />;
      case "mytasks":       return <MyTasks navigate={setPage} />;
      case "admin-users":   return <AdminUsers />;
      default:              return <Dashboard navigate={setPage} />;
    }
  };

  return (
    <BrandingContext.Provider value={branding}>
      <LangContext.Provider value={{ lang, changeLang }}>
        <AuthContext.Provider value={{ user, setUser }}>
          <Fragment key={lang}>
            <Layout navigate={setPage} currentPage={page.name} currentParams={page.params}>
              {renderPage()}
            </Layout>
          </Fragment>
        </AuthContext.Provider>
      </LangContext.Provider>
    </BrandingContext.Provider>
  );
}
