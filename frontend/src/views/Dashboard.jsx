import { useState, useEffect } from "react";
import { apiFetch, useAuth } from "../App";
import TaskModal from "../components/TaskModal";
import FieldBuilder from "../components/FieldBuilder";

const STATUS_COLORS = { new: "#64748b", open: "#3b82f6", in_progress: "#f59e0b", done: "#10b981" };
const PRIO_COLORS   = { low: "#10b981", medium: "#3b82f6", high: "#f59e0b", critical: "#ef4444" };

export default function Dashboard({ navigate }) {
  const { user } = useAuth();
  const [projects, setProjects]   = useState([]);
  const [archived, setArchived]   = useState([]);
  const [showArchived, setShowArchived] = useState(false);
  const [myTasks, setMyTasks]     = useState([]);
  const [showNewProject, setShowNewProject] = useState(false);
  const [newProj, setNewProj]   = useState({ name: "", description: "", color: "#3b82f6" });
  const [newProjFields, setNewProjFields] = useState([]);

  useEffect(() => {
    apiFetch("/projects").then(setProjects).catch(() => {});
    apiFetch("/projects/archived-list").then(setArchived).catch(() => {});
    apiFetch("/tasks/my/assigned").then(setMyTasks).catch(() => {});
  }, []);

  const createProject = async () => {
    if (!newProj.name.trim()) return;
    const p = await apiFetch("/projects", { method: "POST", body: JSON.stringify(newProj) });
    // Save any custom field definitions
    for (const [i, f] of newProjFields.entries()) {
      if (!f.label.trim()) continue;
      await apiFetch(`/projects/${p.id}/fields`, {
        method: "POST",
        body: JSON.stringify({ ...f, position: i }),
      }).catch(() => {});
    }
    setProjects((ps) => [p, ...ps]);
    setShowNewProject(false);
    setNewProj({ name: "", description: "", color: "#3b82f6" });
    setNewProjFields([]);
  };

  const statCounts = myTasks.reduce((acc, t) => {
    acc[t.status] = (acc[t.status] || 0) + 1; return acc;
  }, {});

  return (
    <div style={{ padding: 28, maxWidth: 1100, margin: "0 auto" }}>
      {/* Welcome */}
      <div style={{ marginBottom: 28 }}>
        <h1 style={{ fontSize: 22, fontWeight: 700 }}>Good day, {user?.display_name?.split(" ")[0]} 👋</h1>
        <p style={{ color: "var(--text-secondary)", fontSize: 14, marginTop: 4 }}>Here's what's on your plate</p>
      </div>

      {/* Stats row */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 14, marginBottom: 28 }}>
        {[
          { label: "My Open Tasks", value: (statCounts.open || 0) + (statCounts.new || 0), color: "#3b82f6" },
          { label: "In Progress", value: statCounts.in_progress || 0, color: "#f59e0b" },
          { label: "Completed", value: statCounts.done || 0, color: "#10b981" },
          { label: "Projects", value: projects.length, color: "#8b5cf6" },
        ].map((s) => (
          <div key={s.label} className="card" style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <div style={{ fontSize: 28, fontWeight: 700, color: s.color }}>{s.value}</div>
            <div style={{ fontSize: 12, color: "var(--text-secondary)" }}>{s.label}</div>
          </div>
        ))}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }}>
        {/* My Tasks */}
        <section>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
            <h2 style={{ fontSize: 15, fontWeight: 600 }}>My Assigned Tasks</h2>
            <button className="btn btn-ghost btn-sm" onClick={() => navigate({ name: "mytasks", params: {} })}>View all</button>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {myTasks.slice(0, 6).map((t) => (
              <div key={t.id} className="card" style={{ padding: "10px 14px", display: "flex", alignItems: "center", gap: 10 }}>
                <span style={{ width: 8, height: 8, borderRadius: "50%", background: STATUS_COLORS[t.status], flexShrink: 0 }} />
                <div style={{ flex: 1, overflow: "hidden" }}>
                  <div style={{ fontSize: 13, fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t.title}</div>
                  <div style={{ fontSize: 11, color: "var(--text-muted)" }}>{t.project_name}</div>
                </div>
                <span style={{ fontSize: 10, fontWeight: 700, padding: "2px 6px", borderRadius: 4, background: `${PRIO_COLORS[t.priority]}20`, color: PRIO_COLORS[t.priority] }}>
                  {t.priority}
                </span>
              </div>
            ))}
            {myTasks.length === 0 && <div style={{ color: "var(--text-muted)", fontSize: 13, padding: "20px 0", textAlign: "center" }}>No tasks assigned to you</div>}
          </div>
        </section>

        {/* Projects */}
        <section>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
            <h2 style={{ fontSize: 15, fontWeight: 600 }}>Projects</h2>
            <button className="btn btn-primary btn-sm" onClick={() => setShowNewProject(true)}>+ New</button>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {projects.map((p) => (
              <button key={p.id} onClick={() => navigate({ name: "project", params: { projectId: p.id } })}
                style={{
                  display: "flex", alignItems: "center", gap: 12,
                  padding: "12px 14px", background: "var(--bg-surface)",
                  border: "1px solid var(--border)", borderRadius: "var(--radius-lg)",
                  cursor: "pointer", textAlign: "left", width: "100%",
                  transition: "border-color 0.15s",
                }}
                onMouseEnter={(e) => e.currentTarget.style.borderColor = "var(--accent)"}
                onMouseLeave={(e) => e.currentTarget.style.borderColor = "var(--border)"}
              >
                <div style={{ width: 36, height: 36, borderRadius: 8, background: p.color, display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700, color: "#fff", fontSize: 14 }}>
                  {p.name[0].toUpperCase()}
                </div>
                <div>
                  <div style={{ fontWeight: 600, fontSize: 13, color: "var(--text-primary)" }}>{p.name}</div>
                  <div style={{ fontSize: 11, color: "var(--text-muted)" }}>{p.role} · {p.owner_name}</div>
                </div>
              </button>
            ))}
            {projects.length === 0 && <div style={{ color: "var(--text-muted)", fontSize: 13, padding: "20px 0", textAlign: "center" }}>No projects yet</div>}
            {archived.length > 0 && (
              <div style={{ marginTop:10, borderTop:"1px solid var(--border)", paddingTop:10 }}>
                <button onClick={()=>setShowArchived(v=>!v)} style={{ display:"flex", alignItems:"center", gap:6, background:"none", border:"none", color:"var(--text-muted)", cursor:"pointer", fontSize:12, fontWeight:600, padding:"4px 0", marginBottom:6 }}>
                  {showArchived?"▼":"▶"} 📦 Archived ({archived.length})
                </button>
                {showArchived && archived.map(p=>(
                  <button key={p.id} onClick={()=>navigate({name:"project",params:{projectId:p.id}})}
                    style={{ display:"flex", alignItems:"center", gap:10, padding:"9px 12px", background:"var(--bg-elevated)", border:"1px solid var(--border)", borderRadius:8, cursor:"pointer", textAlign:"left", width:"100%", marginBottom:5, opacity:0.65 }}>
                    <div style={{ width:28, height:28, borderRadius:6, background:p.color, display:"flex", alignItems:"center", justifyContent:"center", fontWeight:700, color:"#fff", fontSize:12 }}>{p.name[0].toUpperCase()}</div>
                    <div style={{ flex:1 }}><div style={{ fontSize:13, fontWeight:500, color:"var(--text-secondary)" }}>{p.name}</div></div>
                    <span style={{ fontSize:10, background:"rgba(100,116,139,0.2)", color:"var(--text-muted)", padding:"2px 7px", borderRadius:99, fontWeight:600 }}>ARCHIVED</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </section>
      </div>

      {/* New Project Modal */}
      {showNewProject && (
        <div className="modal-overlay" onClick={(e) => e.target === e.currentTarget && setShowNewProject(false)}>
          <div className="modal" style={{ maxWidth:600 }}>
            <div className="modal-header">
              <span style={{ fontWeight: 600, fontSize: 15 }}>New Project</span>
              <button className="btn btn-ghost btn-sm" onClick={() => setShowNewProject(false)}>×</button>
            </div>
            <div className="modal-body">
              <div className="form-group">
                <label className="form-label">Project Name</label>
                <input className="input" placeholder="e.g. IT Infrastructure 2025" value={newProj.name} onChange={(e) => setNewProj((f) => ({ ...f, name: e.target.value }))} />
              </div>
              <div className="form-group">
                <label className="form-label">Description</label>
                <textarea className="input" rows={3} placeholder="Optional description" value={newProj.description} onChange={(e) => setNewProj((f) => ({ ...f, description: e.target.value }))} />
              </div>
              <div className="form-group">
                <label className="form-label">Color</label>
                <div style={{ display: "flex", gap: 8 }}>
                  {["#3b82f6","#10b981","#f59e0b","#ef4444","#8b5cf6","#06b6d4","#f97316"].map((c) => (
                    <button key={c} onClick={() => setNewProj((f) => ({ ...f, color: c }))} style={{
                      width: 28, height: 28, borderRadius: "50%", background: c, border: newProj.color === c ? "3px solid #fff" : "2px solid transparent", cursor: "pointer"
                    }} />
                  ))}
                </div>
              </div>
              <div style={{ borderTop:"1px solid var(--border)", paddingTop:14 }}>
                <div className="form-label" style={{ marginBottom:8 }}>Custom Fields <span style={{ fontSize:10, color:"var(--text-muted)", fontWeight:400, textTransform:"none", letterSpacing:0 }}>(optional — you can add more later)</span></div>
                <FieldBuilder fields={newProjFields} onChange={setNewProjFields} />
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn btn-ghost" onClick={() => setShowNewProject(false)}>Cancel</button>
              <button className="btn btn-primary" onClick={createProject}>Create Project</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
