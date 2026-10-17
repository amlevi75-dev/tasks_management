import { useState, useEffect, useRef } from "react";
import { useAuth, apiFetch, useBranding, fmtDateTime, useLang } from "../App";
import { tr, trVal, getLang } from "../i18n";

function getStoredTheme() {
  try { return localStorage.getItem("tm_theme") || "dark"; } catch { return "dark"; }
}
function applyTheme(theme) {
  document.documentElement.setAttribute("data-theme", theme);
  try { localStorage.setItem("tm_theme", theme); } catch {}
}

export default function Layout({ children, navigate, currentPage, currentParams }) {
  const { user, setUser } = useAuth();
  const branding          = useBranding();
  const { lang, changeLang } = useLang();

  const [projects, setProjects]           = useState([]);
  const [notifications, setNotifications] = useState([]);
  const [showNotif, setShowNotif]         = useState(false);
  const [sidebarOpen, setSidebarOpen]     = useState(true);
  const [theme, setTheme]                 = useState(getStoredTheme);

  useEffect(() => { applyTheme(theme); }, [theme]);

  const loadProjects = () => apiFetch("/projects").then(setProjects).catch(() => {});

  useEffect(() => {
    loadProjects();
    apiFetch("/users/notifications").then(setNotifications).catch(() => {});
    // apiFetch fires this after any project create / rename / archive / delete / member change
    window.addEventListener("kairos:projects-changed", loadProjects);
    return () => window.removeEventListener("kairos:projects-changed", loadProjects);
  }, []);

  const unread  = notifications.filter(n => !n.read).length;
  const isAdmin = !!user?.is_admin;
  const isDark  = theme === "dark";

  const logout = async () => {
    await apiFetch("/auth/logout", { method:"POST" });
    setUser(null);
  };

  const markAllRead = async () => {
    await apiFetch("/users/notifications/read", { method:"POST" });
    setNotifications(n => n.map(x => ({ ...x, read:1 })));
  };

  const openNotification = async (notif) => {
    // Mark single notification as read
    if (!notif.read) {
      apiFetch(`/users/notifications/${notif.id}/read`, { method:"POST" }).catch(() => {});
      setNotifications(prev => prev.map(n => n.id === notif.id ? { ...n, read:1 } : n));
    }
    // Navigate to the task's project if we have the info
    if (notif.project_id) {
      navigate({ name:"project", params:{ projectId: notif.project_id } });
    }
    setShowNotif(false);
  };

  const toggleTheme = () => setTheme(t => t === "dark" ? "light" : "dark");

  return (
    <div style={{ display:"flex", height:"100vh", overflow:"hidden" }}>

      {/* ── Sidebar ── */}
      <aside style={{
        width: sidebarOpen ? 240 : 0, flexShrink:0,
        background:"var(--bg-surface)", borderInlineEnd:"1px solid var(--border)",
        display:"flex", flexDirection:"column", overflow:"hidden",
        transition:"width 0.2s ease",
      }}>
        {/* Logo — from branding */}
        <div style={{ padding:"18px 20px 12px", borderBottom:"1px solid var(--border)", flexShrink:0 }}>
          <div style={{ display:"flex", alignItems:"center", gap:10 }}>
            {branding.logo_svg ? (
              <img src={branding.logo_svg} alt={branding.app_name}
                style={{ width:32, height:32, borderRadius:8, flexShrink:0, objectFit:"contain" }} />
            ) : (
              <div style={{
                width:32, height:32, borderRadius:8, flexShrink:0,
                background:`linear-gradient(135deg, ${branding.primary_color}, #8b5cf6)`,
                display:"flex", alignItems:"center", justifyContent:"center",
                fontSize:16, fontWeight:700, color:"#fff",
              }}>{branding.logo_letter}</div>
            )}
            <div style={{ overflow:"hidden" }}>
              <div style={{ fontWeight:700, fontSize:15, color:"var(--text-primary)", whiteSpace:"nowrap" }}>
                {branding.app_name}
              </div>
              <div style={{ fontSize:11, color:"var(--text-muted)", overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>
                {user?.display_name}
              </div>
            </div>
          </div>
        </div>

        {/* Nav */}
        <nav style={{ flex:1, padding:"10px", overflowY:"auto" }}>
          <NavItem label={tr("Dashboard")} icon="⊞"
            active={currentPage==="dashboard"}
            onClick={()=>navigate({name:"dashboard",params:{}})} />
          <NavItem label={tr("My Tasks")} icon="✓"
            active={currentPage==="mytasks"}
            onClick={()=>navigate({name:"mytasks",params:{}})} />

          {isAdmin && <>
            <SectionLabel>{tr("Administration")}</SectionLabel>
            <NavItem label={tr("System Users")} icon="👥"
              active={currentPage==="admin-users"}
              onClick={()=>navigate({name:"admin-users",params:{}})} />
          </>}

          <SectionLabel>{tr("Projects")}</SectionLabel>
          {projects.filter(p => !p.archived).map(p => {
            const pid             = p.id;
            const isActiveProject = currentPage==="project"          && Number(currentParams?.projectId)===pid;
            const isMembersPage   = currentPage==="project-users"    && Number(currentParams?.projectId)===pid;
            const isAnalyticsPage = currentPage==="project-analytics" && Number(currentParams?.projectId)===pid;
            const isExpanded      = isActiveProject || isMembersPage || isAnalyticsPage;
            return (
              <div key={pid}>
                <NavItem label={p.name} dot={p.color}
                  active={isActiveProject}
                  onClick={()=>navigate({name:"project",params:{projectId:pid}})} />
                {isExpanded && (
                  <>
                    {p.role !== "light_member" && <NavItem label={tr("Members")} icon="👤" indent
                      active={isMembersPage}
                      onClick={()=>navigate({name:"project-users",params:{projectId:pid}})} />}
                    <NavItem label={tr("Analytics")} icon="📊" indent
                      active={isAnalyticsPage}
                      onClick={()=>navigate({name:"project-analytics",params:{projectId:pid}})} />
                  </>
                )}
              </div>
            );
          })}
          {projects.length===0 && (
            <div style={{ fontSize:12, color:"var(--text-muted)", padding:"8px 10px" }}>{tr("No projects yet")}</div>
          )}
        </nav>

        {/* Footer */}
        <div style={{ padding:"10px", borderTop:"1px solid var(--border)", flexShrink:0, display:"flex", flexDirection:"column", gap:2 }}>
          <FooterBtn icon={isDark?"☀️":"🌙"} label={isDark?tr("Light mode"):tr("Dark mode")} onClick={toggleTheme} />
          <FooterBtn icon={getLang()==="he" ? "←" : "→"} label={tr("Sign Out")} onClick={logout} />
        </div>
      </aside>

      {/* ── Main ── */}
      <div style={{ flex:1, display:"flex", flexDirection:"column", overflow:"hidden" }}>
        {/* Topbar */}
        <header style={{
          height:52, borderBottom:"1px solid var(--border)",
          background:"var(--bg-surface)",
          display:"flex", alignItems:"center", padding:"0 20px", gap:10, flexShrink:0,
        }}>
          <button className="btn btn-ghost btn-sm" onClick={()=>setSidebarOpen(o=>!o)}>≡</button>
          <div style={{ flex:1 }} />

          {/* Language switch: English <-> Hebrew */}
          <button className="btn btn-ghost btn-sm" onClick={() => changeLang(lang === "he" ? "en" : "he")}
            title={lang === "he" ? "Switch to English" : "החלף לעברית"} style={{ fontWeight:600 }}>
            🌐 {lang === "he" ? "English" : "עברית"}
          </button>

          {/* Notification bell */}
          <div style={{ position:"relative" }}>
            <button className="btn btn-ghost btn-sm" style={{ position:"relative" }}
              onClick={()=>{ setShowNotif(v=>!v); }}>
              🔔
              {unread>0 && (
                <span style={{
                  position:"absolute", top:1, insetInlineEnd:1,
                  width:16, height:16, borderRadius:"50%",
                  background:"var(--red)", color:"#fff",
                  fontSize:9, fontWeight:700,
                  display:"flex", alignItems:"center", justifyContent:"center",
                }}>{unread}</span>
              )}
            </button>
            {showNotif && (
              <NotifPanel
                notifications={notifications}
                onOpen={openNotification}
                onMarkAllRead={markAllRead}
                onClose={()=>setShowNotif(false)}
              />
            )}
          </div>

          {isAdmin && (
            <span style={{ fontSize:10, fontWeight:700, padding:"2px 8px", borderRadius:99, background:"rgba(245,158,11,0.15)", color:"#f59e0b", letterSpacing:"0.5px" }}>
              {tr("ADMIN")}
            </span>
          )}
          <div style={{ fontSize:13, color:"var(--text-secondary)", padding:"4px 10px", background:"var(--bg-elevated)", borderRadius:6 }}>
            {user?.display_name}
          </div>
        </header>

        <main style={{ flex:1, overflow:"auto", background:"var(--bg-base)" }}>
          {children}
        </main>
      </div>
    </div>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────

function SectionLabel({ children }) {
  return (
    <div style={{ margin:"14px 10px 5px", fontSize:10, fontWeight:700, color:"var(--text-muted)", letterSpacing:"0.8px", textTransform:"uppercase" }}>
      {children}
    </div>
  );
}

function NavItem({ label, icon, dot, active, onClick, indent }) {
  return (
    <button onClick={onClick} style={{
      display:"flex", alignItems:"center", gap:8,
      width:"100%", padding: indent?"6px 10px":"7px 10px", paddingInlineStart: indent?26:10,
      borderRadius:6, border:"none",
      background: active?"var(--accent-soft)":"transparent",
      color: active?"var(--accent)": indent?"var(--text-muted)":"var(--text-secondary)",
      fontSize: indent?12:13, fontWeight: active?600:400,
      cursor:"pointer", textAlign:"start", transition:"background 0.1s, color 0.1s",
    }}
      onMouseEnter={e=>{ if(!active){e.currentTarget.style.background="var(--bg-elevated)"; e.currentTarget.style.color="var(--text-primary)";} }}
      onMouseLeave={e=>{ if(!active){e.currentTarget.style.background="transparent"; e.currentTarget.style.color=indent?"var(--text-muted)":"var(--text-secondary)";} }}
    >
      {dot
        ? <span style={{ width:8, height:8, borderRadius:"50%", background:dot, flexShrink:0 }} />
        : <span style={{ fontSize:indent?11:14, width:18, textAlign:"center", flexShrink:0 }}>{icon}</span>
      }
      <span style={{ overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap", flex:1 }}>{label}</span>
    </button>
  );
}

function FooterBtn({ icon, label, onClick }) {
  return (
    <button onClick={onClick} style={{
      display:"flex", alignItems:"center", gap:8,
      width:"100%", padding:"7px 10px", border:"none", borderRadius:6,
      background:"transparent", color:"var(--text-secondary)",
      fontSize:13, cursor:"pointer", textAlign:"start",
    }}
      onMouseEnter={e=>{e.currentTarget.style.background="var(--bg-elevated)"; e.currentTarget.style.color="var(--text-primary)";}}
      onMouseLeave={e=>{e.currentTarget.style.background="transparent"; e.currentTarget.style.color="var(--text-secondary)";}}
    >
      <span style={{ fontSize:14, width:18, textAlign:"center" }}>{icon}</span>
      {label}
    </button>
  );
}

function NotifPanel({ notifications, onOpen, onMarkAllRead, onClose }) {
  const unread = notifications.filter(n => !n.read).length;
  const panelRef = useRef(null);

  // Close on outside click
  useEffect(() => {
    const handler = (e) => { if (panelRef.current && !panelRef.current.contains(e.target)) onClose(); };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  return (
    <div ref={panelRef} style={{
      position:"absolute", top:"calc(100% + 8px)", insetInlineEnd:0,
      width:340, maxHeight:440, overflowY:"auto",
      background:"var(--bg-elevated)", border:"1px solid var(--border-soft)",
      borderRadius:"var(--radius-lg)", boxShadow:"var(--shadow)", zIndex:50,
    }}>
      {/* Header */}
      <div style={{ padding:"12px 16px", borderBottom:"1px solid var(--border)", display:"flex", alignItems:"center", justifyContent:"space-between" }}>
        <span style={{ fontWeight:600, fontSize:13 }}>
          {tr("Notifications")} {unread>0 && <span style={{ marginInlineStart:4, fontSize:11, background:"var(--red)", color:"#fff", borderRadius:99, padding:"1px 7px" }}>{unread}</span>}
        </span>
        {unread>0 && (
          <button onClick={onMarkAllRead} style={{ background:"none", border:"none", fontSize:11, color:"var(--accent)", cursor:"pointer", padding:0 }}>
            {tr("Mark all read")}
          </button>
        )}
      </div>

      {notifications.length===0 && (
        <div style={{ padding:"32px 0", textAlign:"center", color:"var(--text-muted)", fontSize:13 }}>{tr("All caught up! 🎉")}</div>
      )}

      {notifications.map(n => {
        const isClickable = !!n.project_id;
        return (
          <div key={n.id}
            onClick={() => isClickable && onOpen(n)}
            style={{
              padding:"11px 16px", borderBottom:"1px solid var(--border)",
              background: n.read ? "transparent" : "var(--accent-glow)",
              cursor: isClickable ? "pointer" : "default",
              transition:"background 0.1s",
              display:"flex", gap:10, alignItems:"flex-start",
            }}
            onMouseEnter={e=>{ if(isClickable) e.currentTarget.style.background=n.read?"var(--bg-hover)":"var(--accent-soft)"; }}
            onMouseLeave={e=>{ e.currentTarget.style.background=n.read?"transparent":"var(--accent-glow)"; }}
          >
            {/* Unread dot */}
            <div style={{ width:8, height:8, borderRadius:"50%", background: n.read?"transparent":"var(--accent)", flexShrink:0, marginTop:4 }} />
            <div style={{ flex:1, minWidth:0 }}>
              <div style={{ fontSize:13, color: n.read?"var(--text-secondary)":"var(--text-primary)", lineHeight:1.4 }}>
                {n.message}
              </div>
              <div style={{ display:"flex", alignItems:"center", gap:6, marginTop:3 }}>
                <span style={{ fontSize:11, color:"var(--text-muted)" }}>{fmtDateTime(n.created_at)}</span>
                {isClickable && !n.read && (
                  <span style={{ fontSize:10, color:"var(--accent)", fontWeight:600 }}>{tr("Click to open →")}</span>
                )}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
