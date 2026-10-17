import { useState, useEffect } from "react";
import { apiFetch } from "../App";

const ROLE_COLORS = { owner:"#f59e0b", member:"#3b82f6", viewer:"#64748b", light_member:"#8b5cf6" };
const ROLE_LABELS = { owner:"Owner", member:"Member", viewer:"Viewer", light_member:"Light Member" };

export default function MembersPanel({ project, members, onClose, onChanged, isOwner }) {
  const [allUsers, setAllUsers] = useState([]);
  const [search, setSearch]     = useState("");
  const [adding, setAdding]     = useState(null);
  const [role, setRole]         = useState("member");
  const [busy, setBusy]         = useState(false);
  const [error, setError]       = useState("");

  useEffect(() => { apiFetch("/users").then(setAllUsers).catch(() => {}); }, []);

  const memberIds = new Set(members.map(m => m.id));
  const filtered  = allUsers.filter(u =>
    !memberIds.has(u.id) &&
    (u.display_name.toLowerCase().includes(search.toLowerCase()) ||
     u.username.toLowerCase().includes(search.toLowerCase()))
  );

  const addMember = async () => {
    if (!adding) return;
    setBusy(true); setError("");
    try {
      await apiFetch(`/projects/${project.id}/members`, {
        method: "POST", body: JSON.stringify({ user_id: adding.id, role }),
      });
      onChanged(); setAdding(null); setSearch("");
    } catch(e) { setError(e.message); }
    finally { setBusy(false); }
  };

  const removeMember = async (userId) => {
    if (!confirm("Remove this member?")) return;
    try {
      await apiFetch(`/projects/${project.id}/members/${userId}`, { method:"DELETE" });
      onChanged();
    } catch(e) { setError(e.message); }
  };

  const changeRole = async (userId, newRole) => {
    try {
      await apiFetch(`/projects/${project.id}/members`, {
        method:"POST", body:JSON.stringify({ user_id:userId, role:newRole }),
      });
      onChanged();
    } catch(e) { setError(e.message); }
  };

  return (
    <div className="modal-overlay" onClick={(e)=>e.target===e.currentTarget&&onClose()}>
      <div className="modal" style={{ maxWidth:520 }}>
        <div className="modal-header">
          <span style={{ fontWeight:600, fontSize:15 }}>Project Members — {project.name}</span>
          <button className="btn btn-ghost btn-sm" onClick={onClose}>×</button>
        </div>
        <div className="modal-body">
          {error && <div style={{ background:"rgba(239,68,68,0.1)", border:"1px solid rgba(239,68,68,0.3)", borderRadius:6, padding:"8px 12px", fontSize:13, color:"#fca5a5" }}>{error}</div>}

          {/* Current members */}
          <div>
            <div className="form-label" style={{ marginBottom:8 }}>Members ({members.length})</div>
            <div style={{ display:"flex", flexDirection:"column", gap:6, maxHeight:280, overflowY:"auto" }}>
              {members.map(m=>(
                <div key={m.id} style={{ display:"flex", alignItems:"center", gap:10, padding:"8px 12px", background:"var(--bg-elevated)", borderRadius:8 }}>
                  <div style={{
                    width:32, height:32, borderRadius:"50%", flexShrink:0,
                    background:`hsl(${(m.id*67)%360},50%,38%)`,
                    color:"#fff", fontSize:13, fontWeight:700,
                    display:"flex", alignItems:"center", justifyContent:"center",
                  }}>{m.display_name[0].toUpperCase()}</div>
                  <div style={{ flex:1, minWidth:0 }}>
                    <div style={{ fontSize:13, fontWeight:500 }}>{m.display_name}</div>
                    <div style={{ fontSize:11, color:"var(--text-muted)", overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{m.email}</div>
                  </div>
                  {isOwner ? (
                    <select className="select" value={m.role} onChange={e=>changeRole(m.id,e.target.value)}
                      style={{ fontSize:12, color:ROLE_COLORS[m.role], minWidth:90 }}>
                      <option value="owner">Owner</option>
                      <option value="member">Member</option>
                      <option value="viewer">Viewer</option>
                      <option value="light_member">Light Member</option>
                    </select>
                  ) : (
                    <span style={{ fontSize:11, fontWeight:700, padding:"2px 8px", borderRadius:99, background:`${ROLE_COLORS[m.role]}20`, color:ROLE_COLORS[m.role] }}>{m.role}</span>
                  )}
                  {isOwner && (
                    <button className="btn btn-ghost btn-sm" onClick={()=>removeMember(m.id)}
                      style={{ color:"var(--red)", borderColor:"var(--red)", fontSize:12, flexShrink:0 }}>Remove</button>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* Add member — owners only */}
          {isOwner && (
            <div style={{ borderTop:"1px solid var(--border)", paddingTop:16 }}>
              <div className="form-label" style={{ marginBottom:8 }}>Add Member</div>
              <input className="input" placeholder="Search by name or username…"
                value={search} onChange={e=>{setSearch(e.target.value);setAdding(null);}} />
              {search && filtered.length>0 && (
                <div style={{ background:"var(--bg-elevated)", border:"1px solid var(--border-soft)", borderRadius:8, marginTop:6, maxHeight:160, overflowY:"auto" }}>
                  {filtered.map(u=>(
                    <div key={u.id} onClick={()=>{setAdding(u);setSearch(u.display_name);}}
                      style={{ padding:"8px 12px", cursor:"pointer", fontSize:13, borderBottom:"1px solid var(--border)" }}
                      onMouseEnter={e=>e.currentTarget.style.background="var(--bg-hover)"}
                      onMouseLeave={e=>e.currentTarget.style.background="transparent"}
                    >
                      <span style={{ fontWeight:500 }}>{u.display_name}</span>
                      <span style={{ color:"var(--text-muted)", marginLeft:8, fontSize:11 }}>@{u.username}</span>
                    </div>
                  ))}
                </div>
              )}
              {search && filtered.length===0 && !adding && (
                <div style={{ fontSize:12, color:"var(--text-muted)", marginTop:6 }}>No users found or all already members</div>
              )}
              {adding && (
                <div style={{ display:"flex", gap:8, marginTop:10, alignItems:"center" }}>
                  <span style={{ fontSize:13, flex:1, color:"var(--text-secondary)" }}>
                    Adding <b style={{ color:"var(--text-primary)" }}>{adding.display_name}</b> as:
                  </span>
                  <select className="select" value={role} onChange={e=>setRole(e.target.value)}>
                    <option value="member">Member</option>
                    <option value="viewer">Viewer</option>
                      <option value="light_member">Light Member</option>
                    <option value="owner">Owner</option>
                  </select>
                  <button className="btn btn-primary btn-sm" onClick={addMember} disabled={busy}>{busy?"…":"Add"}</button>
                </div>
              )}
            </div>
          )}
        </div>
        <div className="modal-footer">
          <button className="btn btn-ghost" onClick={onClose}>Done</button>
        </div>
      </div>
    </div>
  );
}
