import { useState, useEffect } from "react";
import { apiFetch } from "../App";
import { useAuth } from "../App";
import { tr, trVal } from "../i18n";

const ROLE_COLORS  = { owner: "#f59e0b", member: "#3b82f6", viewer: "#64748b", light_member: "#8b5cf6" };
const ROLE_LABELS  = { owner: "Owner", member: "Member", viewer: "Viewer", light_member: "Light Member" };
const ROLE_ORDER   = ["light_member", "viewer", "member", "owner"];

export default function ProjectUsers({ projectId, navigate }) {
  const { user: me } = useAuth();
  const [project, setProject] = useState(null);
  const [members, setMembers] = useState([]);
  const [allUsers, setAllUsers] = useState([]);
  const [search, setSearch]   = useState("");
  const [adding, setAdding]   = useState(null);
  const [addRole, setAddRole] = useState("member");
  const [error, setError]     = useState("");
  const [busy, setBusy]       = useState(false);

  const load = () => {
    apiFetch(`/projects/${projectId}`)
      .then(p => { setProject(p); setMembers(p.members || []); })
      .catch(() => navigate({ name: "dashboard", params: {} }));
    apiFetch("/users").then(setAllUsers).catch(() => {});
  };

  useEffect(() => { load(); }, [projectId]);

  const memberIds = new Set(members.map(m => m.id));
  const isOwner = project?.role === "owner";

  const filtered = allUsers.filter(u =>
    !memberIds.has(u.id) &&
    (u.display_name.toLowerCase().includes(search.toLowerCase()) ||
     u.username.toLowerCase().includes(search.toLowerCase()))
  );

  const addMember = async () => {
    if (!adding) return;
    setBusy(true); setError("");
    try {
      await apiFetch(`/projects/${projectId}/members`, {
        method: "POST", body: JSON.stringify({ user_id: adding.id, role: addRole }),
      });
      setAdding(null); setSearch(""); load();
    } catch(e) { setError(e.message); }
    finally { setBusy(false); }
  };

  const removeMember = async (userId) => {
    if (!confirm(tr("Remove this member from the project?"))) return;
    try {
      await apiFetch(`/projects/${projectId}/members/${userId}`, { method: "DELETE" });
      load();
    } catch(e) { setError(e.message); }
  };

  const changeRole = async (userId, newRole) => {
    try {
      await apiFetch(`/projects/${projectId}/members`, {
        method: "POST", body: JSON.stringify({ user_id: userId, role: newRole }),
      });
      load();
    } catch(e) { setError(e.message); }
  };

  if (!project) return <div style={{ padding: 40, color: "var(--text-muted)", fontSize: 14 }}>{tr("Loading…")}</div>;

  return (
    <div style={{ padding: 28, maxWidth: 860, margin: "0 auto" }}>
      {/* Breadcrumb */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 20, fontSize: 13, color: "var(--text-muted)" }}>
        <button onClick={() => navigate({ name: "project", params: { projectId } })}
          style={{ background: "none", border: "none", color: "var(--accent)", cursor: "pointer", fontSize: 13, padding: 0 }}>
          ← {project.name}
        </button>
        <span>/</span>
        <span>{tr("Members")}</span>
      </div>

      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 24 }}>
        <div>
          <h1 style={{ fontSize: 20, fontWeight: 700 }}>{tr("Project Members")}</h1>
          <p style={{ color: "var(--text-secondary)", fontSize: 13, marginTop: 4 }}>
            {tr("Only members can see and interact with this project.")}
          </p>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <div style={{ width: 12, height: 12, borderRadius: "50%", background: project.color }} />
          <span style={{ fontSize: 14, fontWeight: 600 }}>{project.name}</span>
        </div>
      </div>

      {error && (
        <div style={{ background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.3)", borderRadius: 8, padding: "10px 14px", fontSize: 13, color: "#fca5a5", marginBottom: 16 }}>{error}</div>
      )}

      {/* Members table */}
      <div style={{ background: "var(--bg-surface)", border: "1px solid var(--border)", borderRadius: "var(--radius-lg)", overflow: "hidden", marginBottom: 24 }}>
        <div style={{ display: "grid", gridTemplateColumns: "2fr 2fr 120px 110px", padding: "10px 16px", borderBottom: "1px solid var(--border)", background: "var(--bg-elevated)" }}>
          {["Member", "Email", "Role", ""].map(h => (
            <div key={h} style={{ fontSize: 11, fontWeight: 700, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.5px" }}>{tr(h)}</div>
          ))}
        </div>

        {members.map(m => (
          <div key={m.id} style={{ display: "grid", gridTemplateColumns: "2fr 2fr 120px 110px", padding: "12px 16px", borderBottom: "1px solid var(--border)", alignItems: "center" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <div style={{
                width: 34, height: 34, borderRadius: "50%", flexShrink: 0,
                background: `hsl(${(m.id * 67) % 360},50%,38%)`,
                color: "#fff", fontSize: 13, fontWeight: 700,
                display: "flex", alignItems: "center", justifyContent: "center",
              }}>{m.display_name[0].toUpperCase()}</div>
              <div>
                <div style={{ fontSize: 13, fontWeight: 500 }}>{m.display_name}</div>
                <div style={{ fontSize: 11, color: "var(--text-muted)", fontFamily: "monospace" }}>@{m.username}</div>
              </div>
            </div>
            <div style={{ fontSize: 12, color: "var(--text-secondary)" }}>{m.email}</div>
            <div>
              {isOwner ? (
                <select className="select" value={m.role}
                  onChange={e => changeRole(m.id, e.target.value)}
                  style={{ color: ROLE_COLORS[m.role], fontSize: 12 }}>
                  <option value="owner">{tr("Owner")}</option>
                  <option value="member">{tr("Member")}</option>
                  <option value="viewer">{tr("Viewer")}</option>
                  <option value="light_member">{tr("Light Member")}</option>
                </select>
              ) : (
                <span style={{ fontSize: 11, fontWeight: 700, padding: "3px 10px", borderRadius: 99, background: `${ROLE_COLORS[m.role]}20`, color: ROLE_COLORS[m.role] }}>
                  {trVal("role", m.role)}
                </span>
              )}
            </div>
            <div style={{ display: "flex", justifyContent: "flex-end" }}>
              {isOwner && m.role !== "owner" && (
                <button className="btn btn-ghost btn-sm" onClick={() => removeMember(m.id)}
                  style={{ color: "var(--red)", borderColor: "rgba(239,68,68,0.3)" }}>{tr("Remove")}</button>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Add member — owners only */}
      {isOwner && (
        <div style={{ background: "var(--bg-surface)", border: "1px solid var(--border)", borderRadius: "var(--radius-lg)", padding: 20 }}>
          <h2 style={{ fontSize: 14, fontWeight: 600, marginBottom: 14 }}>{tr("Add Member")}</h2>
          <div style={{ display: "flex", gap: 10 }}>
            <div style={{ position: "relative", flex: 1 }}>
              <input className="input" placeholder={tr("Search users by name or username…")}
                value={search} onChange={e => { setSearch(e.target.value); setAdding(null); }} />
              {search && filtered.length > 0 && !adding && (
                <div style={{
                  position: "absolute", top: "calc(100% + 4px)", left: 0, right: 0, zIndex: 20,
                  background: "var(--bg-elevated)", border: "1px solid var(--border-soft)",
                  borderRadius: 8, maxHeight: 200, overflowY: "auto", boxShadow: "var(--shadow)",
                }}>
                  {filtered.map(u => (
                    <div key={u.id} onClick={() => { setAdding(u); setSearch(u.display_name); }}
                      style={{ padding: "9px 14px", cursor: "pointer", fontSize: 13, borderBottom: "1px solid var(--border)" }}
                      onMouseEnter={e => e.currentTarget.style.background = "var(--bg-hover)"}
                      onMouseLeave={e => e.currentTarget.style.background = "transparent"}
                    >
                      <span style={{ fontWeight: 500 }}>{u.display_name}</span>
                      <span style={{ color: "var(--text-muted)", marginInlineStart: 8, fontSize: 11 }}>@{u.username}</span>
                    </div>
                  ))}
                </div>
              )}
              {search && filtered.length === 0 && !adding && (
                <div style={{ marginTop: 6, fontSize: 12, color: "var(--text-muted)" }}>{tr("No users found or all already members")}</div>
              )}
            </div>
            <select className="select" value={addRole} onChange={e => setAddRole(e.target.value)} style={{ minWidth: 110 }}>
              <option value="member">{tr("Member")}</option>
              <option value="viewer">{tr("Viewer")}</option>
                  <option value="light_member">{tr("Light Member")}</option>
              <option value="owner">{tr("Owner")}</option>
            </select>
            <button className="btn btn-primary" onClick={addMember} disabled={!adding || busy}>
              {busy ? tr("Adding…") : tr("Add")}
            </button>
          </div>
          {adding && (
            <p style={{ marginTop: 8, fontSize: 13, color: "var(--text-secondary)" }}>
              {tr("Adding")} <b style={{ color: "var(--text-primary)" }}>{adding.display_name}</b> {tr("as")} <b>{trVal("role", addRole)}</b>{tr(". Click Add to confirm.")}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
