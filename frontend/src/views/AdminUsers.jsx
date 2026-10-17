import { useState, useEffect } from "react";
import { apiFetch } from "../App";
import { tr, trVal } from "../i18n";

const SOURCE_BADGE = {
  local: { get label(){ return tr("Local"); }, bg:"#8b5cf620", color:"#8b5cf6" },
  ad:    { label:"AD",    bg:"#3b82f620", color:"#3b82f6" },
};

export default function AdminUsers() {
  const [users, setUsers]           = useState([]);
  const [loading, setLoading]       = useState(true);
  const [error, setError]           = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [editUser, setEditUser]     = useState(null);

  const load = () => {
    setLoading(true); setError("");
    apiFetch("/auth/local-users")
      .then(u => { setUsers(u); setLoading(false); })
      .catch(e => { setError(e.message || tr("Failed to load users")); setLoading(false); });
  };

  useEffect(() => { load(); }, []);

  return (
    <div style={{ padding:28, maxWidth:960, margin:"0 auto" }}>
      <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:24 }}>
        <div>
          <h1 style={{ fontSize:20, fontWeight:700 }}>{tr("User Management")}</h1>
          <p style={{ color:"var(--text-secondary)", fontSize:13, marginTop:4 }}>
            {tr("Local users are managed here. AD users appear automatically on first login.")}
          </p>
        </div>
        <button className="btn btn-primary" onClick={()=>setShowCreate(true)}>{tr("+ New Local User")}</button>
      </div>

      {error && (
        <div style={{ background:"rgba(239,68,68,0.1)", border:"1px solid rgba(239,68,68,0.3)", borderRadius:8, padding:"12px 16px", fontSize:13, color:"#fca5a5", marginBottom:16 }}>
          {error}
        </div>
      )}

      {loading && <div style={{ color:"var(--text-muted)", fontSize:13, padding:"40px 0", textAlign:"center" }}>{tr("Loading…")}</div>}

      {!loading && !error && (
        <div style={{ background:"var(--bg-surface)", border:"1px solid var(--border)", borderRadius:"var(--radius-lg)", overflow:"hidden" }}>
          <div style={{ display:"grid", gridTemplateColumns:"2fr 2fr 80px 80px 80px 100px", padding:"10px 16px", borderBottom:"1px solid var(--border)", background:"var(--bg-elevated)" }}>
            {["Name","Email","Source","Role","Status",""].map(h=>(
              <div key={h} style={{ fontSize:11, fontWeight:700, color:"var(--text-muted)", textTransform:"uppercase", letterSpacing:"0.5px" }}>{tr(h)}</div>
            ))}
          </div>

          {users.map(u=>{
            const src = SOURCE_BADGE[u.auth_source]||SOURCE_BADGE.local;
            return (
              <div key={u.id} style={{ display:"grid", gridTemplateColumns:"2fr 2fr 80px 80px 80px 100px", padding:"12px 16px", borderBottom:"1px solid var(--border)", alignItems:"center" }}>
                <div>
                  <div style={{ fontSize:13, fontWeight:500 }}>{u.display_name}</div>
                  <div style={{ fontSize:11, color:"var(--text-muted)", fontFamily:"monospace" }}>{u.username}</div>
                </div>
                <div style={{ fontSize:12, color:"var(--text-secondary)", overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{u.email}</div>
                <div>
                  <span style={{ fontSize:10, fontWeight:700, padding:"2px 7px", borderRadius:99, background:src.bg, color:src.color }}>{src.label}</span>
                </div>
                <div style={{ fontSize:12, color:u.is_admin?"#f59e0b":"var(--text-muted)" }}>
                  {u.is_admin?tr("Admin"):tr("User")}
                </div>
                <div>
                  <span style={{ fontSize:10, fontWeight:700, padding:"2px 7px", borderRadius:99, background:u.is_active?"#10b98120":"#ef444420", color:u.is_active?"#10b981":"#ef4444" }}>
                    {u.is_active?tr("Active"):tr("Disabled")}
                  </span>
                </div>
                <div style={{ display:"flex", gap:6, justifyContent:"flex-end" }}>
                  {u.auth_source==="local"&&(
                    <button className="btn btn-ghost btn-sm" onClick={()=>setEditUser(u)}>{tr("Edit")}</button>
                  )}
                </div>
              </div>
            );
          })}

          {users.length===0&&(
            <div style={{ padding:"40px 0", textAlign:"center", color:"var(--text-muted)", fontSize:13 }}>{tr("No users yet. Create the first local user.")}</div>
          )}
        </div>
      )}

      {showCreate && (
        <UserFormModal onClose={()=>setShowCreate(false)} onSave={()=>{load();setShowCreate(false);}} />
      )}
      {editUser && (
        <UserFormModal user={editUser} onClose={()=>setEditUser(null)} onSave={()=>{load();setEditUser(null);}} />
      )}
    </div>
  );
}

function Toggle({ label, checked, onChange }) {
  return (
    <label style={{ display:"flex", alignItems:"center", gap:8, cursor:"pointer", userSelect:"none" }}>
      <div onClick={()=>onChange(!checked)} style={{
        width:36, height:20, borderRadius:99, cursor:"pointer", transition:"background 0.2s",
        background: checked?"var(--accent)":"var(--border-soft)", position:"relative",
      }}>
        <div style={{ position:"absolute", top:2, insetInlineStart:checked?18:2, width:16, height:16, borderRadius:"50%", background:"#fff", transition:"inset-inline-start 0.2s" }} />
      </div>
      <span style={{ fontSize:13, color:"var(--text-secondary)" }}>{label}</span>
    </label>
  );
}

function UserFormModal({ user, onClose, onSave }) {
  const isEdit = !!user;
  const [form, setForm] = useState({
    username:     user?.username     || "",
    display_name: user?.display_name || "",
    email:        user?.email        || "",
    password:     "",
    is_admin:     !!user?.is_admin,
    is_active:    user?.is_active!==undefined ? !!user.is_active : true,
  });
  const [error, setError]     = useState("");
  const [loading, setLoading] = useState(false);

  const set = (k,v) => setForm(f=>({...f,[k]:v}));

  const save = async () => {
    setError(""); setLoading(true);
    try {
      if (isEdit) {
        const body = {};
        if (form.display_name!==user.display_name) body.display_name = form.display_name;
        if (form.email!==user.email)               body.email        = form.email;
        if (form.password)                         body.password     = form.password;
        if (!!form.is_admin!==!!user.is_admin)     body.is_admin     = form.is_admin;
        if (!!form.is_active!==!!user.is_active)   body.is_active    = form.is_active;
        await apiFetch(`/auth/local-users/${user.id}`, { method:"PATCH", body:JSON.stringify(body) });
      } else {
        if (!form.username||!form.display_name||!form.email||!form.password) { setError(tr("All fields required")); setLoading(false); return; }
        await apiFetch("/auth/local-users", { method:"POST", body:JSON.stringify(form) });
      }
      onSave();
    } catch(e) { setError(e.message); }
    finally { setLoading(false); }
  };

  const del = async () => {
    if (!confirm(tr('Delete user "{name}"?', { name:user.username }))) return;
    await apiFetch(`/auth/local-users/${user.id}`, { method:"DELETE" });
    onSave();
  };

  return (
    <div className="modal-overlay" onClick={(e)=>e.target===e.currentTarget&&onClose()}>
      <div className="modal" style={{ maxWidth:440 }}>
        <div className="modal-header">
          <span style={{ fontWeight:600, fontSize:15 }}>{isEdit?tr("Edit — {name}", { name:user.username }):tr("New Local User")}</span>
          <button className="btn btn-ghost btn-sm" onClick={onClose}>×</button>
        </div>
        <div className="modal-body">
          {!isEdit&&(
            <div className="form-group">
              <label className="form-label">{tr("Username")}</label>
              <input className="input" placeholder={tr("john.doe")} value={form.username} onChange={e=>set("username",e.target.value)} />
            </div>
          )}
          <div className="form-group">
            <label className="form-label">{tr("Display Name")}</label>
            <input className="input" placeholder={tr("John Doe")} value={form.display_name} onChange={e=>set("display_name",e.target.value)} />
          </div>
          <div className="form-group">
            <label className="form-label">{tr("Email")}</label>
            <input className="input" type="email" placeholder={tr("john@company.local")} value={form.email} onChange={e=>set("email",e.target.value)} />
          </div>
          <div className="form-group">
            <label className="form-label">{isEdit?tr("New Password (blank = unchanged)"):tr("Password")}</label>
            <input className="input" type="password" placeholder={tr("Min 8 characters")} value={form.password} onChange={e=>set("password",e.target.value)} />
          </div>
          <div style={{ display:"flex", gap:24 }}>
            <Toggle label={tr("Admin")}  checked={form.is_admin}  onChange={v=>set("is_admin",v)} />
            {isEdit&&<Toggle label={tr("Active")} checked={form.is_active} onChange={v=>set("is_active",v)} />}
          </div>
          {error&&<div style={{ color:"#fca5a5", fontSize:13, background:"rgba(239,68,68,0.1)", padding:"8px 12px", borderRadius:6 }}>{error}</div>}
        </div>
        <div className="modal-footer">
          {isEdit&&<button className="btn btn-danger btn-sm" onClick={del} style={{ marginInlineEnd:"auto" }}>{tr("Delete")}</button>}
          <button className="btn btn-ghost" onClick={onClose}>{tr("Cancel")}</button>
          <button className="btn btn-primary" onClick={save} disabled={loading}>{loading?tr("Saving…"):tr("Save")}</button>
        </div>
      </div>
    </div>
  );
}
