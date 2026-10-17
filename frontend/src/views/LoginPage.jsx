import { useState, useEffect } from "react";
import { apiFetch, useBranding, useLang } from "../App";
import { tr, trVal } from "../i18n";

// SSO is a full-page redirect, so it needs a plain URL, not apiFetch.
const API_BASE = window.location.port === "5173" ? "http://localhost:8000/api" : "/api";

export default function LoginPage({ onLogin }) {
  const branding = useBranding();
  const { lang, changeLang } = useLang();
  const [form, setForm]     = useState({ username:"", password:"" });
  const [error, setError]   = useState("");
  const [loading, setLoading] = useState(false);
  const [sso, setSso]         = useState({ enabled:false, allow_local:true, button_label:"" });

  // Only show the SSO button when the server says it is configured.
  useEffect(() => {
    apiFetch("/auth/sso/status").then(setSso).catch(() => {});
  }, []);

  const submit = async () => {
    if (!form.username || !form.password) { setError(tr("Enter username and password")); return; }
    setLoading(true); setError("");
    try {
      const data = await apiFetch("/auth/login", { method:"POST", body:JSON.stringify(form) });
      onLogin(data.user);
    } catch(e) { setError(e.message || tr("Login failed")); }
    finally { setLoading(false); }
  };

  return (
    <div style={{
      minHeight:"100vh", display:"flex", alignItems:"center", justifyContent:"center", position:"relative",
      background:"var(--bg-base)",
      backgroundImage:"radial-gradient(ellipse at 30% 20%, rgba(59,130,246,0.08) 0%, transparent 60%), radial-gradient(ellipse at 70% 80%, rgba(139,92,246,0.06) 0%, transparent 60%)",
    }}>
      <button className="btn btn-ghost btn-sm" type="button" onClick={() => changeLang(lang === "he" ? "en" : "he")}
        style={{ position:"absolute", top:16, insetInlineEnd:16, fontWeight:600 }}>
        🌐 {lang === "he" ? "English" : "עברית"}
      </button>
      <div style={{ width:"100%", maxWidth:380, padding:"0 20px" }}>
        {/* Logo */}
        <div style={{ textAlign:"center", marginBottom:36 }}>
          {branding.logo_svg ? (
            <img src={branding.logo_svg} alt={branding.app_name}
              style={{ width:72, height:72, borderRadius:16, margin:"0 auto 16px", display:"block",
                       boxShadow:`0 8px 32px ${branding.primary_color}55` }} />
          ) : (
            <div style={{
              width:56, height:56, borderRadius:14, margin:"0 auto 14px",
              background:`linear-gradient(135deg, ${branding.primary_color}, #8b5cf6)`,
              display:"flex", alignItems:"center", justifyContent:"center",
              fontSize:26, fontWeight:800, color:"#fff",
              boxShadow:`0 8px 32px ${branding.primary_color}55`,
            }}>{branding.logo_letter}</div>
          )}
          <h1 style={{ fontSize:26, fontWeight:800, color:"var(--text-primary)", letterSpacing:"0.08em", textTransform:"uppercase" }}>{branding.app_name}</h1>
          <p style={{ fontSize:11, color:"var(--text-muted)", marginTop:3, letterSpacing:"0.15em", textTransform:"uppercase", fontWeight:500 }}>{tr("Task & Project Management")}</p>
          <p style={{ fontSize:13, color:"var(--text-muted)", marginTop:10 }}>{tr("Sign in with your company account")}</p>
        </div>

        {/* Card */}
        <div style={{ background:"var(--bg-surface)", border:"1px solid var(--border-soft)", borderRadius:"var(--radius-lg)", padding:28, boxShadow:"var(--shadow)" }}>
          <div style={{ display:"flex", flexDirection:"column", gap:14 }}>
            <div className="form-group">
              <label className="form-label">{tr("Username")}</label>
              <input className="input" placeholder={tr("john.doe")}
                value={form.username} onChange={e=>setForm(f=>({...f,username:e.target.value}))}
                onKeyDown={e=>e.key==="Enter"&&submit()} />
            </div>
            <div className="form-group">
              <label className="form-label">{tr("Password")}</label>
              <input className="input" type="password" placeholder="••••••••"
                value={form.password} onChange={e=>setForm(f=>({...f,password:e.target.value}))}
                onKeyDown={e=>e.key==="Enter"&&submit()} />
            </div>
            {error && (
              <div style={{ background:"rgba(239,68,68,0.1)", border:"1px solid rgba(239,68,68,0.3)", borderRadius:6, padding:"8px 12px", fontSize:13, color:"#fca5a5" }}>
                {error}
              </div>
            )}
            <button className="btn btn-primary" onClick={submit} disabled={loading}
              style={{ justifyContent:"center", marginTop:4 }}>
              {loading ? tr("Signing in…") : tr("Sign In")}
            </button>

            {sso.enabled && (
              <>
                <div style={{ display:"flex", alignItems:"center", gap:10, margin:"6px 0 2px" }}>
                  <div style={{ flex:1, height:1, background:"var(--border)" }} />
                  <span style={{ fontSize:11, color:"var(--text-muted)" }}>{tr("or")}</span>
                  <div style={{ flex:1, height:1, background:"var(--border)" }} />
                </div>
                <a href={`${API_BASE}/auth/sso/login`} className="btn btn-ghost"
                   style={{ justifyContent:"center", textDecoration:"none" }}>
                  🔐 {sso.button_label || tr("Sign in with company account")}
                </a>
              </>
            )}
          </div>
        </div>

        <p style={{ textAlign:"center", fontSize:12, color:"var(--text-muted)", marginTop:20 }}>
          {tr("Authenticated via Active Directory")}
        </p>
      </div>
    </div>
  );
}
