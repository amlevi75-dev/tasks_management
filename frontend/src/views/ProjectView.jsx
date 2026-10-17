import { useState, useEffect, useRef } from "react";
import GanttView from "../components/GanttView";
import { apiFetch, useAuth, fmtDate, isRTL } from "../App";
import TaskModal from "../components/TaskModal";
import TaskCard from "../components/TaskCard";
import TrashPanel from "../components/TrashPanel";
import FieldBuilder from "../components/FieldBuilder";
import InlineEdit from "../components/InlineEdit";
import CommentPopover from "../components/CommentPopover";
import { tr, trVal, getLang } from "../i18n";

const STATUSES = [
  { key:"new",         get label(){ return tr("New"); },         color:"#64748b" },
  { key:"open",        get label(){ return tr("Open"); },        color:"#3b82f6" },
  { key:"in_progress", get label(){ return tr("In Progress"); }, color:"#f59e0b" },
  { key:"done",        get label(){ return tr("Done"); },        color:"#10b981" },
];
const PRIO_COLORS = { low:"#10b981", medium:"#3b82f6", high:"#f59e0b", critical:"#ef4444" };
const COLORS = ["#3b82f6","#10b981","#f59e0b","#ef4444","#8b5cf6","#06b6d4","#f97316","#ec4899"];

// Native `title` tooltips can't render HTML, so description (now rich text)
// needs its tags stripped before use as a plain-text preview there.
function stripHtml(html) {
  if (!html) return "";
  const div = document.createElement("div");
  div.innerHTML = html;
  return div.textContent || div.innerText || "";
}

export default function ProjectView({ projectId, navigate }) {
  const { user } = useAuth();
  const [project, setProject]         = useState(null);
  const [tasks, setTasks]             = useState([]);     // parent tasks only
  const [subtaskMap, setSubtaskMap]   = useState({});     // parentId → [subtasks]
  const [view, setView]               = useState("list");   // list is the default view
  const [groupBy, setGroupBy]         = useState("status"); // list view grouping
  const [showNewTask, setShowNewTask] = useState(false);
  const [editTask, setEditTask]       = useState(null);
  const [filterStatus, setFilterStatus]     = useState("");
  const [filterAssignee, setFilterAssignee] = useState("");
  const [members, setMembers]         = useState([]);
  const [showSettings, setShowSettings] = useState(false);
  const [showTrash, setShowTrash]       = useState(false);
  const [categories, setCategories]         = useState([]);
  const [filterCategory, setFilterCategory] = useState("");
  const [dependencies, setDependencies]     = useState([]);
  const [fieldFilters, setFieldFilters]     = useState({});   // { field_id: value }
  const [hideDone, setHideDone]             = useState(false);
  const [savedViews, setSavedViews]         = useState([]);
  const [activeViewId, setActiveViewId]     = useState(null);
  const [customFields, setCustomFields]     = useState([]);
  const [fieldValues, setFieldValues]       = useState({});

  const load = async () => {
    try {
      const [p, parentTasks, allTasks] = await Promise.all([
        apiFetch(`/projects/${projectId}`),
        apiFetch(`/tasks?project_id=${projectId}&parent_only=true`),
        apiFetch(`/tasks?project_id=${projectId}&parent_only=false`),
      ]);
      setProject(p);
      setMembers(p.members || []);
      setTasks(parentTasks);
      apiFetch(`/projects/${projectId}/categories`).then(setCategories).catch(()=>{});
      apiFetch(`/projects/${projectId}/views`).then(setSavedViews).catch(()=>{});
      // Custom field definitions + every value in one bulk call (not per row)
      apiFetch(`/projects/${projectId}/fields`).then(setCustomFields).catch(()=>{});
      apiFetch(`/tasks/field-values/bulk?project_id=${projectId}`).then(setFieldValues).catch(()=>{});
      // Load task dependencies for Gantt arrows
      apiFetch(`/tasks?project_id=${projectId}&parent_only=false`)
        .then(allTasks => Promise.all(
          allTasks.map(t => apiFetch(`/tasks/${t.id}/dependencies`).catch(()=>({ blockers:[], blocking:[] })))
        ).then(results => {
          const deps = [];
          results.forEach((r, i) => {
            r.blockers.forEach(d => deps.push({
              task_id:       allTasks[i].id,
              depends_on_id: d.id,
              dep_type:      d.dep_type || "finish_to_start",
            }));
          });
          setDependencies(deps);
        })).catch(()=>{});
      // Build subtask map
      const map = {};
      allTasks.forEach(t => {
        if (t.parent_task_id) {
          if (!map[t.parent_task_id]) map[t.parent_task_id] = [];
          map[t.parent_task_id].push(t);
        }
      });
      setSubtaskMap(map);
    } catch {
      navigate({ name:"dashboard", params:{} });
    }
  };

  useEffect(() => { load(); }, [projectId]);

  const filteredTasks = tasks.filter(t => {
    if (hideDone && t.status === "done")                               return false;
    if (filterStatus   && t.status !== filterStatus)                   return false;
    if (filterAssignee && String(t.assignee_id) !== filterAssignee)   return false;
    if (filterCategory && String(t.category_id) !== filterCategory)   return false;
    // Custom field filters. fieldValues is already loaded for the whole
    // project, so this needs no extra request.
    for (const [fid, want] of Object.entries(fieldFilters)) {
      if (!want) continue;
      const have = (fieldValues[String(t.id)] || {})[String(fid)];
      if (String(have ?? "") !== String(want)) return false;
    }
    return true;
  });

  const tasksByStatus = STATUSES.reduce((acc, s) => {
    acc[s.key] = filteredTasks.filter(t => t.status === s.key);
    return acc;
  }, {});

  const onTaskSaved = () => { load(); setShowNewTask(false); setEditTask(null); };

  // Inline edits patch local state rather than reloading the whole project,
  // so scroll position and collapsed groups are preserved. A status change
  // moves the row between groups naturally because grouping is derived.
  const onTaskChanged = (taskId, updated) => {
    const merge = arr => arr.map(t => t.id === taskId ? { ...t, ...updated } : t);
    setTasks(merge);
    setSubtaskMap(prev => {
      const next = {};
      for (const [pid, subs] of Object.entries(prev)) next[pid] = merge(subs);
      return next;
    });
  };

  // Create a task straight from the list, without opening the modal.
  // Rethrows so the row can surface the failure rather than silently closing.
  // Accepts whatever the group's preset carries (status, category_id, ...)
  // rather than a fixed shape — grouping by category previously dropped
  // category_id here because the old signature only knew about "status".
  // Saved views — a user's own preset of the filter controls above.
  const applyView = (view) => {
    const f = view.filters || {};
    setFilterStatus(f.filterStatus || "");
    setFilterAssignee(f.filterAssignee || "");
    setFilterCategory(f.filterCategory || "");
    setFieldFilters(f.fieldFilters || {});
    setHideDone(!!f.hideDone);
    if (f.groupBy) setGroupBy(f.groupBy);
    setActiveViewId(view.id);
  };

  const saveCurrentAsView = async (name) => {
    const filters = { filterStatus, filterAssignee, filterCategory, fieldFilters, hideDone, groupBy };
    const created = await apiFetch(`/projects/${projectId}/views`, {
      method: "POST",
      body: JSON.stringify({ name, filters }),
    });
    setSavedViews(prev => [...prev, created]);
    setActiveViewId(created.id);
    return created;
  };

  const deleteView = async (viewId) => {
    await apiFetch(`/projects/${projectId}/views/${viewId}`, { method: "DELETE" });
    setSavedViews(prev => prev.filter(v => v.id !== viewId));
    if (activeViewId === viewId) setActiveViewId(null);
  };

  const onQuickCreate = async ({ title, ...rest }) => {
    const payload = { project_id: Number(projectId), title, ...rest };
    // The API only lets a light member create tasks assigned to themselves,
    // so fill that in rather than letting the request 403.
    if (project?.role === "light_member" && user?.id) payload.assignee_id = user.id;
    const created = await apiFetch("/tasks", {
      method: "POST",
      body: JSON.stringify(payload),
    });
    setTasks(prev => [...prev, created]);
    return created;
  };

  // Create a subtask inline. Lands in subtaskMap so it renders indented under
  // its parent rather than as a top-level row.
  const onAddSubtask = async ({ title, parent_task_id, project_id }) => {
    const created = await apiFetch("/tasks", {
      method: "POST",
      body: JSON.stringify({
        project_id: Number(project_id || projectId),
        title, parent_task_id, status: "new",
      }),
    });
    setSubtaskMap(prev => ({
      ...prev,
      [parent_task_id]: [...(prev[parent_task_id] || []), created],
    }));
    // Keep the parent's subtask counters honest
    setTasks(prev => prev.map(t => t.id === parent_task_id
      ? { ...t, subtask_count: (t.subtask_count || 0) + 1 }
      : t));
    return created;
  };

  // Posting a comment updates the badge count in place.
  const onCommentPosted = (taskId, newCount) => {
    const merge = arr => arr.map(t => t.id === taskId ? { ...t, comment_count: newCount } : t);
    setTasks(merge);
    setSubtaskMap(prev => {
      const next = {};
      for (const [pid, subs] of Object.entries(prev)) next[pid] = merge(subs);
      return next;
    });
  };

  const onFieldChanged = (taskId, fieldId, value) => {
    setFieldValues(prev => ({
      ...prev,
      [String(taskId)]: { ...(prev[String(taskId)] || {}), [String(fieldId)]: value },
    }));
  };

  const onDrop = async (taskId, newStatus, newPosition) => {
    setTasks(prev => prev.map(t => t.id===taskId ? {...t, status:newStatus, position:newPosition} : t));
    try {
      await apiFetch(`/tasks/${taskId}/move`, { method:"POST", body:JSON.stringify({ status:newStatus, position:newPosition }) });
    } catch { load(); }
  };

  if (!project) return <div style={{ padding:40, color:"var(--text-muted)", fontSize:14 }}>{tr("Loading…")}</div>;

  const isViewer = project.role === "viewer";
  const isOwner  = project.role === "owner";
  // Light members see only their own tasks — assignee/category filters are
  // meaningless for them, and the members list is not theirs to browse.
  const isLight  = project.role === "light_member";

  return (
    <div style={{ display:"flex", flexDirection:"column", height:"100%" }}>

      {/* ── Header ── */}
      <div style={{ padding:"14px 24px", borderBottom:"1px solid var(--border)", background:"var(--bg-surface)", flexShrink:0 }}>
        <div style={{ display:"flex", alignItems:"center", gap:12, marginBottom:12 }}>
          <div style={{ width:34, height:34, borderRadius:8, background:project.color, display:"flex", alignItems:"center", justifyContent:"center", fontWeight:700, color:"#fff", fontSize:15, flexShrink:0 }}>
            {project.name[0].toUpperCase()}
          </div>
          <div style={{ flex:1, minWidth:0 }}>
            <div style={{ display:"flex", alignItems:"center", gap:6 }}>
              <h1 style={{ fontSize:16, fontWeight:700, margin:0 }}>{project.name}</h1>
              {isOwner && (
                <button onClick={()=>setShowSettings(true)} title={tr("Rename / Settings")}
                  style={{ background:"none", border:"none", color:"var(--text-muted)", cursor:"pointer", fontSize:15, padding:"2px 4px", borderRadius:4 }}
                  onMouseEnter={e=>e.currentTarget.style.color="var(--text-primary)"}
                  onMouseLeave={e=>e.currentTarget.style.color="var(--text-muted)"}
                >✎</button>
              )}
            </div>
            {project.description && <p style={{ fontSize:12, color:"var(--text-muted)", margin:"2px 0 0" }}>{project.description}</p>}
          </div>

          <div style={{ display:"flex", gap:8, alignItems:"center", flexShrink:0 }}>
            <div style={{ display:"flex", background:"var(--bg-elevated)", borderRadius:6, padding:2 }}>
              {[["board","⊞ Board"],["list","≡ List"],["gantt","📅 Gantt"]].map(([v,label])=>(
                <button key={v} onClick={()=>setView(v)} style={{
                  padding:"5px 10px", border:"none", borderRadius:5, fontSize:12, fontWeight:500, cursor:"pointer",
                  background: view===v?"var(--accent)":"transparent",
                  color: view===v?"#fff":"var(--text-secondary)",
                }}>{tr(label)}</button>
              ))}
            </div>
          <button className="btn btn-ghost btn-sm"
            onClick={()=>navigate({name:"project-analytics",params:{projectId}})}
            title={tr("Analytics")}>{tr("📊 Analytics")}</button>
            {!isViewer && <button className="btn btn-primary btn-sm" onClick={()=>setShowNewTask(true)}>{tr("+ Task")}</button>}
            <button className="btn btn-ghost btn-sm" onClick={()=>setShowTrash(true)} title={tr("Trash")}>🗑</button>
          </div>
        </div>

        {/* Filters */}
        <div style={{ display:"flex", gap:8 }}>
          <select className="select" value={filterStatus} onChange={e=>setFilterStatus(e.target.value)}>
            <option value="">{tr("All Statuses")}</option>
            {STATUSES.map(s=><option key={s.key} value={s.key}>{s.label}</option>)}
          </select>
          {!isLight && (
            <select className="select" value={filterAssignee} onChange={e=>setFilterAssignee(e.target.value)}>
              <option value="">{tr("All Assignees")}</option>
              {members.map(u=><option key={u.id} value={String(u.id)}>{u.display_name}</option>)}
            </select>
          )}
          {categories.length > 0 && (
            <select className="select" value={filterCategory} onChange={e=>setFilterCategory(e.target.value)}>
              <option value="">{tr("All Categories")}</option>
              {categories.map(c=><option key={c.id} value={String(c.id)}>{c.name}</option>)}
            </select>
          )}
          {/* Custom field filters — only fields the owner marked filterable */}
          {customFields.filter(f => f.filterable == null || f.filterable).map(f => {
            const fid = String(f.field_id ?? f.id);
            const val = fieldFilters[fid] || "";
            const set = v => setFieldFilters(prev => {
              const next = { ...prev };
              if (v) next[fid] = v; else delete next[fid];
              return next;
            });
            let opts = [];
            if (f.field_type === "list") {
              try { opts = f.options ? JSON.parse(f.options) : []; } catch { opts = []; }
            }
            return f.field_type === "list" ? (
              <select key={fid} className="select" value={val} onChange={e=>set(e.target.value)}>
                <option value="">{tr("All")} {f.label}</option>
                {opts.map(o => <option key={o} value={o}>{o}</option>)}
              </select>
            ) : (
              <input key={fid} className="input" value={val}
                placeholder={f.label}
                onChange={e=>set(e.target.value)}
                type={f.field_type === "date" ? "date" : f.field_type === "number" ? "number" : "text"}
                style={{ fontSize:12, padding:"5px 8px", width: f.field_type==="date" ? 140 : 120 }} />
            );
          })}
          {Object.keys(fieldFilters).length > 0 && (
            <button onClick={()=>setFieldFilters({})}
              style={{ background:"none", border:"none", color:"var(--text-muted)",
                       cursor:"pointer", fontSize:11 }}>
              {tr("✕ clear field filters")}
            </button>
          )}

          <label style={{ display:"flex", alignItems:"center", gap:5, fontSize:12,
                          color:"var(--text-secondary)", cursor:"pointer", userSelect:"none" }}>
            <input type="checkbox" checked={hideDone} onChange={e=>setHideDone(e.target.checked)} />
            {tr("Hide Done")}
          </label>

          {view === "list" && (
            <SavedViewsControl
              savedViews={savedViews}
              activeViewId={activeViewId}
              currentFilters={{ filterStatus, filterAssignee, filterCategory, fieldFilters, hideDone, groupBy }}
              onApply={applyView}
              onSave={saveCurrentAsView}
              onDelete={deleteView}
            />
          )}

          {view === "list" && categories.length > 0 && (
            <div style={{ display:"flex", alignItems:"center", gap:6, marginInlineStart:4 }}>
              <span style={{ fontSize:11, color:"var(--text-muted)" }}>{tr("Group by")}</span>
              <div style={{ display:"flex", border:"1px solid var(--border)", borderRadius:6, overflow:"hidden" }}>
                {[["status","Status"],["category","Category"]].map(([v,label])=>(
                  <button key={v} onClick={()=>setGroupBy(v)}
                    style={{
                      padding:"4px 10px", fontSize:12, border:"none", cursor:"pointer",
                      borderInlineEnd: v==="status" ? "1px solid var(--border)" : "none",
                      background: groupBy===v ? "var(--accent)" : "var(--bg-elevated)",
                      color:      groupBy===v ? "#fff" : "var(--text-secondary)",
                      fontWeight: groupBy===v ? 600 : 400,
                    }}>{tr(label)}</button>
                ))}
              </div>
            </div>
          )}
          <span style={{ fontSize:12, color:"var(--text-muted)", alignSelf:"center", marginInlineStart:4 }}>
            {tr(filteredTasks.length === 1 ? "1 task" : "{n} tasks", { n: filteredTasks.length })}
          </span>
        </div>
      </div>

      {/* ── Content ── */}
      <div style={{ flex:1, overflow:"auto" }}>
        {view==="board"
          ? <BoardView statuses={STATUSES} tasksByStatus={tasksByStatus} subtaskMap={subtaskMap} onEdit={setEditTask} onDrop={onDrop} />
          : view==="gantt"
          ? <GanttView tasks={filteredTasks} subtaskMap={subtaskMap} dependencies={dependencies} onEdit={setEditTask} />
          : <ListView  statuses={STATUSES} tasksByStatus={tasksByStatus} subtaskMap={subtaskMap} onEdit={setEditTask}
              members={members} categories={categories}
              customFields={customFields} fieldValues={fieldValues}
              canEdit={!isViewer}
              onTaskChanged={onTaskChanged} onFieldChanged={onFieldChanged}
              onCommentPosted={onCommentPosted} onQuickCreate={onQuickCreate}
              groupBy={groupBy} onAddSubtask={onAddSubtask} />
        }
      </div>

      {/* ── Modals ── */}
      {(showNewTask||editTask) && (
        <TaskModal task={editTask} projectId={projectId} projectMembers={members} projectCategories={categories}
          onSave={onTaskSaved} onClose={()=>{setShowNewTask(false);setEditTask(null);}} />
      )}
      {showSettings && (
        <ProjectSettingsModal project={project}
          onClose={()=>setShowSettings(false)}
          onSaved={u=>{setProject(p=>({...p,...u}));setShowSettings(false);load();}}
          onDeleted={()=>navigate({name:"dashboard",params:{}})} />
      )}
      {showTrash && (
        <TrashPanel projectId={projectId} isOwner={isOwner}
          onClose={()=>setShowTrash(false)} onRestored={load} />
      )}
    </div>
  );
}

// ── Project settings modal ────────────────────────────────────────────────────
function ProjectSettingsModal({ project, onClose, onSaved, onDeleted }) {
  const [form, setForm]           = useState({ name:project.name||"", description:project.description||"", color:project.color||"#3b82f6" });
  const [loading, setLoading]     = useState(false);
  const [error, setError]         = useState("");
  const [settingsTab, setSettingsTab] = useState("general");
  const [fields, setFields]           = useState([]);
  const [fieldsBusy, setFieldsBusy]   = useState(false);
  const [cats, setCats]               = useState([]);
  const [newCatName, setNewCatName]   = useState("");
  const [catBusy, setCatBusy]         = useState(false);

  useEffect(() => {
    apiFetch(`/projects/${project.id}/fields`).then(setFields).catch(() => {});
    apiFetch(`/projects/${project.id}/categories`).then(setCats).catch(() => {});
  }, [project.id]);
  const save = async () => {
    if (!form.name.trim()) { setError(tr("Name required")); return; }
    setLoading(true); setError("");
    try { const u = await apiFetch(`/projects/${project.id}`, { method:"PATCH", body:JSON.stringify(form) }); onSaved(u); }
    catch(e) { setError(e.message); }
    finally { setLoading(false); }
  };
  const addCat = async () => {
    if (!newCatName.trim()) return;
    setCatBusy(true);
    try {
      const c = await apiFetch(`/projects/${project.id}/categories`, { method:"POST", body:JSON.stringify({ name:newCatName.trim() }) });
      setCats(prev => [...prev, c]);
      setNewCatName("");
    } catch(e) { setError(e.message); }
    finally { setCatBusy(false); }
  };

  const deleteCat = async (catId) => {
    await apiFetch(`/projects/${project.id}/categories/${catId}`, { method:"DELETE" });
    setCats(prev => prev.filter(c => c.id !== catId));
  };

  const saveFields = async () => {
    setFieldsBusy(true); setError("");
    try {
      const existing  = await apiFetch(`/projects/${project.id}/fields`);
      const localIds  = new Set(fields.filter(f => f.id).map(f => f.id));
      for (const f of existing) {
        if (!localIds.has(f.id)) await apiFetch(`/projects/${project.id}/fields/${f.id}`, { method:"DELETE" }).catch(()=>{});
      }
      for (const [i, f] of fields.entries()) {
        if (!f.label?.trim()) continue;
        // filterable must be sent explicitly — the checkbox's off state (0)
        // is a real value, not "unset"; omitting the key here is exactly
        // what made unchecking it revert on save.
        const payload = {
          label:f.label, field_type:f.field_type, options:f.options||null,
          required:f.required||0, position:i,
          filterable: f.filterable == null ? 1 : (f.filterable ? 1 : 0),
        };
        if (f.id) {
          await apiFetch(`/projects/${project.id}/fields/${f.id}`, { method:"PATCH", body:JSON.stringify(payload) }).catch(()=>{});
        } else {
          await apiFetch(`/projects/${project.id}/fields`, { method:"POST", body:JSON.stringify(payload) }).catch(()=>{});
        }
      }
      const updated = await apiFetch(`/projects/${project.id}/fields`);
      setFields(updated);
    } catch(e) { setError(e.message); }
    finally { setFieldsBusy(false); }
  };
  const archiveProject = async () => {
    const action = project.archived ? "unarchive" : "archive";
    if (!confirm(tr('{action} "{name}"?', { action: tr(action==="archive"?"Archive":"Unarchive"), name:project.name }))) return;
    await apiFetch(`/projects/${project.id}/${action}`, { method:"POST" });
    onSaved({ archived: project.archived ? 0 : 1 });
  };
  const del = async () => {
    if (!confirm(tr('Delete "{name}" and ALL its tasks?', { name:project.name }))) return;
    await apiFetch(`/projects/${project.id}`, { method:"DELETE" });
    onDeleted();
  };
  return (
    <div className="modal-overlay" onClick={e=>e.target===e.currentTarget&&onClose()}>
      <div className="modal" style={{ maxWidth:580 }}>
        <div className="modal-header">
          <span style={{ fontWeight:600, fontSize:15 }}>{tr("Project Settings —")} {project.name}</span>
          <button className="btn btn-ghost btn-sm" onClick={onClose}>×</button>
        </div>

        <div style={{ display:"flex", borderBottom:"1px solid var(--border)", padding:"0 24px" }}>
          {[["general","⚙ General"],["fields","◈ Custom Fields"],["categories","◉ Categories"]].map(([t,label])=>(
            <button key={t} onClick={()=>setSettingsTab(t)} style={{
              padding:"10px 14px", border:"none", background:"transparent",
              color: settingsTab===t?"var(--accent)":"var(--text-muted)",
              borderBottom: settingsTab===t?"2px solid var(--accent)":"2px solid transparent",
              fontSize:13, fontWeight:500, cursor:"pointer", whiteSpace:"nowrap",
            }}>{tr(label)}</button>
          ))}
        </div>

        {settingsTab==="general" && (
          <div className="modal-body">
            <div className="form-group"><label className="form-label">{tr("Project Name")}</label>
              <input className="input" value={form.name} onChange={e=>setForm(f=>({...f,name:e.target.value}))} /></div>
            <div className="form-group"><label className="form-label">{tr("Description")}</label>
              <textarea className="input" rows={2} value={form.description} onChange={e=>setForm(f=>({...f,description:e.target.value}))} /></div>
            <div className="form-group"><label className="form-label">{tr("Color")}</label>
              <div style={{ display:"flex", gap:8, flexWrap:"wrap" }}>
                {COLORS.map(c=><button key={c} onClick={()=>setForm(f=>({...f,color:c}))} style={{ width:28, height:28, borderRadius:"50%", background:c, border:"none", outline:form.color===c?"3px solid #fff":"none", outlineOffset:2, cursor:"pointer" }} />)}
              </div></div>
            {error && <div style={{ color:"#fca5a5", fontSize:13, background:"rgba(239,68,68,0.1)", padding:"8px 12px", borderRadius:6 }}>{error}</div>}
            <div style={{ borderTop:"1px solid var(--border)", paddingTop:14 }}>
              <p style={{ fontSize:12, color:"var(--text-muted)", fontWeight:600, marginBottom:8 }}>{tr("Project Actions")}</p>
              <div style={{ display:"flex", gap:8, flexWrap:"wrap" }}>
                <button className="btn btn-ghost btn-sm" onClick={archiveProject} style={{ borderColor:"var(--yellow)", color:"var(--yellow)" }}>
                  {project.archived ? tr("📦 Unarchive Project") : tr("📦 Archive Project")}
                </button>
                <button className="btn btn-danger btn-sm" onClick={del}>{tr("Delete Project")}</button>
              </div>
              {project.archived && <p style={{ fontSize:11, color:"var(--text-muted)", marginTop:8 }}>{tr("This project is archived. Unarchive to resume work.")}</p>}
            </div>
          </div>
        )}

        {settingsTab==="categories" && (
          <div className="modal-body">
            <p style={{ fontSize:12, color:"var(--text-muted)", marginBottom:10 }}>
              {tr("Categories appear as a dropdown on every task in this project.")}
            </p>
            <div style={{ display:"flex", flexDirection:"column", gap:6, marginBottom:12 }}>
              {cats.map(c => (
                <div key={c.id} style={{ display:"flex", alignItems:"center", gap:8, padding:"7px 12px", background:"var(--bg-elevated)", borderRadius:7, border:"1px solid var(--border)" }}>
                  <div style={{ width:10, height:10, borderRadius:"50%", background:c.color||"#64748b", flexShrink:0 }} />
                  <span style={{ fontSize:13, flex:1 }}>{c.name}</span>
                  <button onClick={()=>deleteCat(c.id)} style={{ background:"none", border:"none", color:"var(--text-muted)", cursor:"pointer", fontSize:16 }}>×</button>
                </div>
              ))}
              {cats.length===0 && <div style={{ fontSize:12, color:"var(--text-muted)", textAlign:"center", padding:"10px 0" }}>{tr("No categories yet")}</div>}
            </div>
            <div style={{ display:"flex", gap:8 }}>
              <input className="input" placeholder={tr("New category name…")} value={newCatName}
                onChange={e=>setNewCatName(e.target.value)}
                onKeyDown={e=>e.key==="Enter"&&addCat()}
                style={{ flex:1, fontSize:13 }} />
              <button className="btn btn-primary btn-sm" onClick={addCat} disabled={catBusy||!newCatName.trim()}>{tr("Add")}</button>
            </div>
            {error && <div style={{ color:"#fca5a5", fontSize:13, marginTop:8 }}>{error}</div>}
          </div>
        )}

        {settingsTab==="fields" && (
          <div className="modal-body">
            <p style={{ fontSize:12, color:"var(--text-muted)", marginBottom:10 }}>
              {tr("These fields appear on every task in this project, below the standard fields.")}
            </p>
            <FieldBuilder fields={fields} onChange={setFields} />
            {error && <div style={{ color:"#fca5a5", fontSize:13, background:"rgba(239,68,68,0.1)", padding:"8px 12px", borderRadius:6 }}>{error}</div>}
          </div>
        )}

        <div className="modal-footer">
          <button className="btn btn-ghost" onClick={onClose}>{tr("Cancel")}</button>
          {settingsTab==="general" && (
            <button className="btn btn-primary" onClick={save} disabled={loading}>{loading?tr("Saving…"):tr("Save Changes")}</button>
          )}
          {settingsTab==="fields" && (
            <button className="btn btn-primary" onClick={saveFields} disabled={fieldsBusy}>{fieldsBusy?tr("Saving…"):tr("Save Fields")}</button>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Board view — tasks with subtasks indented below ────────────────────────────
function BoardView({ statuses, tasksByStatus, subtaskMap, onEdit, onDrop }) {
  const [dragging, setDragging] = useState(null);
  const [overCol, setOverCol]   = useState(null);

  return (
    <div style={{ display:"flex", gap:16, padding:24, minHeight:"100%", overflowX:"auto" }}>
      {statuses.map(s => (
        <div key={s.key}
          onDragOver={e=>{e.preventDefault();setOverCol(s.key);}}
          onDrop={e=>{e.preventDefault();if(dragging){onDrop(dragging.taskId,s.key,(tasksByStatus[s.key]||[]).length);}setDragging(null);setOverCol(null);}}
          onDragLeave={()=>setOverCol(null)}
          style={{ width:272, flexShrink:0, display:"flex", flexDirection:"column", borderRadius:10, padding:4, background:overCol===s.key?"var(--bg-elevated)":"transparent", transition:"background 0.15s" }}
        >
          <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:10, padding:"0 4px" }}>
            <span style={{ width:10, height:10, borderRadius:"50%", background:s.color }} />
            <span style={{ fontSize:12, fontWeight:700, color:"var(--text-secondary)", textTransform:"uppercase", letterSpacing:"0.5px" }}>{s.label}</span>
            <span style={{ marginInlineStart:"auto", fontSize:11, background:"var(--bg-elevated)", padding:"1px 7px", borderRadius:10, color:"var(--text-muted)" }}>
              {(tasksByStatus[s.key]||[]).length}
            </span>
          </div>
          <div style={{ display:"flex", flexDirection:"column", gap:6, flex:1, minHeight:80 }}>
            {(tasksByStatus[s.key]||[]).map(t => (
              <div key={t.id}>
                {/* Parent task card — draggable */}
                <div draggable
                  onDragStart={e=>{setDragging({taskId:t.id});e.dataTransfer.effectAllowed="move";}}
                  onDragEnd={()=>{setDragging(null);setOverCol(null);}}
                  style={{ opacity:dragging?.taskId===t.id?0.35:1, cursor:"grab" }}
                >
                  <TaskCard task={t} onClick={()=>onEdit(t)} />
                </div>
                {/* Subtasks — indented, not draggable */}
                {(subtaskMap[t.id]||[]).map(sub => (
                  <div key={sub.id} style={{ marginInlineStart:16, marginTop:4 }}>
                    <SubtaskRow task={sub} onClick={()=>onEdit(sub)} />
                  </div>
                ))}
              </div>
            ))}
            {(tasksByStatus[s.key]||[]).length===0 && (
              <div style={{ border:`2px dashed ${overCol===s.key?s.color:"var(--border-soft)"}`, borderRadius:8, padding:"24px 0", textAlign:"center", color:overCol===s.key?s.color:"var(--text-muted)", fontSize:12, transition:"all 0.15s" }}>
                {overCol===s.key?tr("Drop here"):tr("Empty")}
              </div>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Subtask row (compact card) ─────────────────────────────────────────────────
function SubtaskRow({ task, onClick }) {
  const pc = { low:"#10b981", medium:"#3b82f6", high:"#f59e0b", critical:"#ef4444" }[task.priority]||"#3b82f6";
  const sc = { new:"#64748b", open:"#3b82f6", in_progress:"#f59e0b", done:"#10b981" }[task.status]||"#64748b";
  return (
    <div onClick={onClick} style={{
      display:"flex", alignItems:"center", gap:8, padding:"6px 10px",
      background:"var(--bg-elevated)", borderRadius:6,
      border:"1px solid var(--border)", borderInlineStart:`3px solid ${pc}`,
      cursor:"pointer", transition:"background 0.1s",
    }}
      onMouseEnter={e=>e.currentTarget.style.background="var(--bg-hover)"}
      onMouseLeave={e=>e.currentTarget.style.background="var(--bg-elevated)"}
    >
      <span style={{ fontSize:10, color:"var(--text-muted)", flexShrink:0 }}>↳</span>
      <span style={{ fontSize:12, flex:1, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap",
        textDecoration: task.status==="done"?"line-through":"none",
        color: task.status==="done"?"var(--text-muted)":"var(--text-primary)",
      }}>{task.title}</span>
      <span style={{ fontSize:9, fontWeight:700, padding:"1px 5px", borderRadius:3, background:`${sc}20`, color:sc, flexShrink:0 }}>
        {trVal("status", task.status, task.status.replace("_"," "))}
      </span>
      {task.assignee_name && (
        <span title={task.assignee_name} style={{ width:18, height:18, borderRadius:"50%", background:`hsl(${(task.assignee_id*67)%360},50%,38%)`, color:"#fff", fontSize:9, fontWeight:700, display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0 }}>
          {task.assignee_name[0]}
        </span>
      )}
    </div>
  );
}

// ── List view — grouped by status, subtasks indented, cells editable ─────────
//
// Custom fields render as real columns alongside the base fields. Their
// definitions and values arrive from the parent (one bulk call for the whole
// project) rather than each row fetching its own — a 50-task list would
// otherwise fire 50 requests.
function ListView({
  statuses, tasksByStatus, subtaskMap, onEdit,
  members = [], categories = [], customFields = [], fieldValues = {},
  canEdit = true, onTaskChanged, onFieldChanged, onCommentPosted, onQuickCreate,
  groupBy = "status", onAddSubtask,
}) {
  const [collapsed, setCollapsed] = useState({});
  const toggle = key => setCollapsed(c=>({...c,[key]:!c[key]}));

  // Groups are derived so the same rendering works for either dimension.
  // Each carries the field a quick-add row should preset, so a task created
  // inside a group lands in that group.
  const groups = groupBy === "category"
    ? (() => {
        const all = statuses.flatMap(s => tasksByStatus[s.key] || []);
        const out = categories.map(cat => ({
          key:   `cat-${cat.id}`,
          label: cat.name,
          color: cat.color || "#64748b",
          tasks: all.filter(t => String(t.category_id) === String(cat.id)),
          preset: { category_id: cat.id },
        }));
        const none = all.filter(t => t.category_id == null);
        // Only show the catch-all when something is actually in it
        if (none.length) out.push({
          key:"cat-none", label:tr("Uncategorized"), color:"#64748b",
          tasks:none, preset:{},
        });
        return out;
      })()
    : statuses.map(s => ({
        key:   s.key,
        label: s.label,
        color: s.color,
        tasks: tasksByStatus[s.key] || [],
        preset: { status: s.key },
      }));

  // Base columns + one per custom field
  const gridCols = [
    "minmax(220px,2fr)",   // Task
    "110px",               // Status
    "100px",               // Priority
    "140px",               // Assignee
    "120px",               // Due
    ...(categories.length ? ["130px"] : []),
    ...customFields.map(() => "140px"),
    "70px",                // Comments
    "120px",               // Created by
  ].join(" ");

  const headers = [
    "Task", "Status", "Priority", "Assignee", "Due",
    ...(categories.length ? ["Category"] : []),
    ...customFields.map(f => f.label),
    "💬",
    "Created by",
  ];

  return (
    <div style={{ padding:24, display:"flex", flexDirection:"column", gap:14 }}>
      {groups.map(s => {
        const list = s.tasks;
        const isCollapsed = collapsed[s.key];
        const totalWithSubs = list.reduce((n, t) => n + 1 + (subtaskMap[t.id]||[]).length, 0);
        return (
          <div key={s.key} style={{ background:"var(--bg-surface)", border:"1px solid var(--border)", borderRadius:"var(--radius-lg)", overflow:"hidden" }}>
            {/* Zone header */}
            <div onClick={()=>toggle(s.key)} style={{
              display:"flex", alignItems:"center", gap:10, padding:"13px 16px",
              background:"var(--bg-elevated)", cursor:"pointer",
              borderBottom: isCollapsed?"none":"1px solid var(--border)",
            }}>
              <span style={{ width:10, height:10, borderRadius:"50%", background:s.color, flexShrink:0 }} />
              <span style={{ fontSize:13, fontWeight:700, color:s.color, textTransform:"uppercase", letterSpacing:"0.5px" }}>{s.label}</span>
              <span style={{ fontSize:11, background:`${s.color}20`, color:s.color, padding:"2px 9px", borderRadius:10, fontWeight:600 }}>
                {list.length}{totalWithSubs>list.length?` + ${totalWithSubs-list.length} sub`:""}
              </span>
              <span style={{ marginInlineStart:"auto", fontSize:13, color:"var(--text-muted)" }}>{isCollapsed?(getLang()==="he"?"◀":"▶"):"▼"}</span>
            </div>

            {!isCollapsed && (
              <div style={{ overflowX:"auto" }}>
                <div style={{ minWidth:"fit-content" }}>
                  <div style={{ display:"grid", gridTemplateColumns:gridCols, gap:10, padding:"7px 16px", borderBottom:"1px solid var(--border)" }}>
                    {headers.map((h,i)=>(
                      <div key={i} style={{ fontSize:10, fontWeight:700, color:"var(--text-muted)", textTransform:"uppercase", letterSpacing:"0.5px", overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }} title={tr(h)}>{tr(h)}</div>
                    ))}
                  </div>
                  {list.length===0 && (
                    <div style={{ padding:"16px", color:"var(--text-muted)", fontSize:13 }}>{tr("No tasks")}</div>
                  )}
                  {list.map(t => (
                    <TaskRowGroup key={t.id} task={t} subtasks={subtaskMap[t.id]||[]}
                      onEdit={onEdit} gridCols={gridCols}
                      members={members} categories={categories}
                      customFields={customFields} fieldValues={fieldValues}
                      canEdit={canEdit} onTaskChanged={onTaskChanged}
                      onFieldChanged={onFieldChanged} onCommentPosted={onCommentPosted}
                      onAddSubtask={onAddSubtask} />
                  ))}
                  {canEdit && (
                    <QuickAddRow preset={s.preset} groupLabel={s.label}
                      gridCols={gridCols} onCreate={onQuickCreate} />
                  )}
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function ListRow({
  task: t, onEdit, indent, gridCols,
  members = [], categories = [], customFields = [], fieldValues = {},
  canEdit = true, onTaskChanged, onFieldChanged, onCommentPosted, onAddSubtaskClick,
  subtaskCount = 0, subtasksExpanded = true, onToggleSubtasks,
}) {
  const pc = PRIO_COLORS[t.priority]||"#3b82f6";
  const vals = fieldValues[String(t.id)] || {};

  // PATCH one task field. Throws on failure so InlineEdit can revert.
  const saveTask = async (field, value) => {
    const updated = await apiFetch(`/tasks/${t.id}`, {
      method: "PATCH",
      body: JSON.stringify({ [field]: value }),
    });
    onTaskChanged?.(t.id, updated, field, value);
  };

  const saveField = async (fieldId, value) => {
    await apiFetch(`/tasks/${t.id}/field-values`, {
      method: "POST",
      body: JSON.stringify({ field_id: Number(fieldId), value }),
    });
    onFieldChanged?.(t.id, fieldId, value);
  };

  const overdue = t.due_date && t.status!=="done" &&
                  new Date(t.due_date) < new Date(new Date().toDateString());

  return (
    <div
      onClick={()=>onEdit(t)}
      style={{
        display:"grid", gridTemplateColumns:gridCols, gap:12, alignItems:"center",
        // Taller rows: more vertical room so the filled status/priority
        // chips (and any wrapped task title) have breathing room instead
        // of feeling cramped against a thin row.
        padding: indent?"12px 16px 12px 32px":"16px 16px",
        minHeight: indent?44:56,
        borderBottom:"1px solid var(--border)", cursor:"pointer",
        transition:"background 0.1s",
        background: indent?"var(--bg-base)":"transparent",
      }}
      onMouseEnter={e=>e.currentTarget.style.background="var(--bg-hover)"}
      onMouseLeave={e=>e.currentTarget.style.background=indent?"var(--bg-base)":"transparent"}
    >
      {/* Title */}
      <div style={{ display:"flex", alignItems:"center", gap:6, minWidth:0 }}>
        {indent && <span style={{ fontSize:11, color:"var(--text-muted)", flexShrink:0 }}>↳</span>}
        {!indent && subtaskCount > 0 && (
          <button
            onClick={e => { e.stopPropagation(); onToggleSubtasks?.(); }}
            title={subtasksExpanded ? tr(subtaskCount===1 ? "Collapse 1 subtask" : "Collapse {n} subtasks", { n:subtaskCount })
                                     : tr(subtaskCount===1 ? "Expand 1 subtask" : "Expand {n} subtasks", { n:subtaskCount })}
            style={{
              flexShrink:0, width:16, height:16, lineHeight:1,
              display:"flex", alignItems:"center", justifyContent:"center",
              borderRadius:4, cursor:"pointer", fontSize:10,
              background:"transparent", color:"var(--text-muted)", border:"none",
              transform: subtasksExpanded ? "rotate(90deg)" : "none",
              transition:"transform 0.12s",
            }}
            onMouseEnter={e=>e.currentTarget.style.color="var(--text-primary)"}
            onMouseLeave={e=>e.currentTarget.style.color="var(--text-muted)"}
          >▶</button>
        )}
        {!indent && subtaskCount === 0 && <span style={{ width:16, flexShrink:0 }} />}

        {!indent && canEdit && onAddSubtaskClick && (
          <button
            onClick={e => { e.stopPropagation(); onAddSubtaskClick(); }}
            title={tr("Add a subtask")}
            className="row-add-sub"
            style={{
              flexShrink:0, width:18, height:18, lineHeight:1,
              display:"flex", alignItems:"center", justifyContent:"center",
              borderRadius:4, cursor:"pointer", fontSize:13,
              background:"transparent", color:"var(--text-muted)",
              border:"1px solid var(--border-soft)",
            }}
            onMouseEnter={e=>{ e.currentTarget.style.background="var(--accent)";
                               e.currentTarget.style.color="#fff"; }}
            onMouseLeave={e=>{ e.currentTarget.style.background="transparent";
                               e.currentTarget.style.color="var(--text-muted)"; }}
          >+</button>
        )}
        <div style={{ flex:1, minWidth:0 }}>
          <InlineEdit
            value={t.title}
            readOnly={!canEdit}
            onSave={v => saveTask("title", v)}
            title={stripHtml(t.description) || t.title}
            rtl={isRTL(t.title)}
            render={v => (
              <>
                <span style={{
                  fontSize:13, fontWeight: indent?400:500,
                  color: t.status==="done"?"var(--text-muted)":"var(--text-primary)",
                  textDecoration: t.status==="done"?"line-through":"none",
                }}>{v}</span>
                {!indent && subtaskCount > 0 && (
                  <span style={{
                    fontSize:10, fontWeight:600, color:"var(--text-muted)",
                    background:"var(--bg-elevated)", border:"1px solid var(--border-soft)",
                    borderRadius:99, padding:"0 6px", marginInlineStart:6, flexShrink:0,
                  }}>{subtaskCount}</span>
                )}
              </>
            )}
          />
        </div>
      </div>

      {/* Status — filled full-width chip, matching the reference board's
          solid status pill rather than a small tinted badge. */}
      <InlineEdit
        type="select"
        value={t.status}
        readOnly={!canEdit}
        options={STATUSES.map(s=>({ value:s.key, label:s.label }))}
        onSave={v => saveTask("status", v)}
        render={v => {
          const s = STATUSES.find(x=>x.key===v);
          return (
            <span style={{
              display:"block", width:"100%", textAlign:"center",
              fontSize:11, fontWeight:700, padding:"6px 8px", borderRadius:6,
              background:s?.color||"#64748b", color:"#fff",
              textTransform:"uppercase", letterSpacing:"0.3px",
              overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap",
            }}>{s?.label||v}</span>
          );
        }}
      />

      {/* Priority — same filled-chip treatment as status */}
      <InlineEdit
        type="select"
        value={t.priority}
        readOnly={!canEdit}
        options={["low","medium","high","critical"].map(p=>({ value:p, label:trVal("prio", p, p.charAt(0).toUpperCase()+p.slice(1)) }))}
        onSave={v => saveTask("priority", v)}
        render={v => (
          <span style={{
            display:"block", width:"100%", textAlign:"center",
            fontSize:11, fontWeight:700, padding:"6px 8px", borderRadius:6,
            background:PRIO_COLORS[v]||"#3b82f6", color:"#fff",
            textTransform:"capitalize", letterSpacing:"0.2px",
            overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap",
          }}>{trVal("prio", v)}</span>
        )}
      />

      {/* Assignee */}
      <InlineEdit
        type="select"
        value={t.assignee_id != null ? String(t.assignee_id) : ""}
        readOnly={!canEdit}
        placeholder={tr("Unassigned")}
        options={members.map(m=>({ value:String(m.id), label:m.display_name }))}
        onSave={v => saveTask("assignee_id", v ? Number(v) : null)}
        render={() => t.assignee_name || <span style={{ color:"var(--text-muted)" }}>{tr("Unassigned")}</span>}
      />

      {/* Due date */}
      <InlineEdit
        type="date"
        value={t.due_date || ""}
        readOnly={!canEdit}
        onSave={v => saveTask("due_date", v)}
        render={v => v
          ? <span style={{ color: overdue ? "var(--red)" : "var(--text-secondary)", fontWeight: overdue?600:400 }}>
              {overdue ? "🔔 " : ""}{fmtDate(v)}
            </span>
          : <span style={{ color:"var(--text-muted)" }}>—</span>}
      />

      {/* Category */}
      {categories.length > 0 && (
        <InlineEdit
          type="select"
          value={t.category_id != null ? String(t.category_id) : ""}
          readOnly={!canEdit}
          options={categories.map(c=>({ value:String(c.id), label:c.name }))}
          onSave={v => saveTask("category_id", v ? Number(v) : null)}
          render={() => t.category_name
            ? <span style={{ fontSize:11, fontWeight:600, padding:"2px 8px", borderRadius:99,
                background:`${t.category_color||"#64748b"}20`, color:t.category_color||"#64748b" }}>
                {t.category_name}
              </span>
            : <span style={{ color:"var(--text-muted)" }}>—</span>}
        />
      )}

      {/* Custom fields — one column each */}
      {customFields.map(f => {
        const fid = String(f.field_id ?? f.id);
        let opts = [];
        if (f.field_type === "list") {
          try { opts = f.options ? JSON.parse(f.options) : []; } catch { opts = []; }
        }
        return (
          <InlineEdit
            key={fid}
            type={f.field_type === "list" ? "select"
                : f.field_type === "date" ? "date"
                : f.field_type === "number" ? "number" : "text"}
            value={vals[fid] ?? ""}
            readOnly={!canEdit}
            options={opts.map(o=>({ value:o, label:o }))}
            onSave={v => saveField(fid, v)}
            align={f.field_type === "number" ? "right" : "left"}
            title={f.label}
            // RTL only makes sense for free text — a number or date is
            // always formatted LTR regardless of the project's language,
            // and a list value is a fixed option the admin defined.
            rtl={f.field_type === "text" && isRTL(vals[fid])}
          />
        );
      })}

      {/* Comments — opens a popover, no need for the full task form */}
      <CommentPopover
        taskId={t.id}
        taskTitle={t.title}
        count={t.comment_count || 0}
        members={members}
        canComment={canEdit}
        onPosted={onCommentPosted}
      />

      {/* Created by */}
      <div style={{ fontSize:11, color:"var(--text-muted)", overflow:"hidden" }}>
        <div style={{ overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{t.reporter_name||"—"}</div>
        <div style={{ fontSize:10 }}>{fmtDate(t.created_at)}</div>
      </div>
    </div>
  );
}

// ── Inline "add task" row ────────────────────────────────────────────────────
// Adds a task without opening the modal. Creates it in the status of whichever
// group the row sits in, so the new task lands where the user is looking.
// Enter creates and keeps the row open for a second entry; Escape closes it.
function QuickAddRow({ preset = {}, groupLabel, gridCols, onCreate }) {
  const [active, setActive] = useState(false);
  const [title,  setTitle]  = useState("");
  const [busy,   setBusy]   = useState(false);
  const [error,  setError]  = useState("");
  const inputRef = useRef(null);

  useEffect(() => { if (active) inputRef.current?.focus(); }, [active]);

  const submit = async () => {
    const t = title.trim();
    if (!t) { setActive(false); return; }
    setBusy(true); setError("");
    try {
      await onCreate({ title: t, ...preset });
      setTitle("");
      inputRef.current?.focus();      // ready for the next one
    } catch (e) {
      setError(e.message || tr("Could not create task"));
    } finally {
      setBusy(false);
    }
  };

  if (!active) {
    return (
      <div
        onClick={()=>setActive(true)}
        style={{
          padding:"9px 16px", cursor:"pointer", fontSize:12,
          color:"var(--text-muted)", display:"flex", alignItems:"center", gap:6,
          borderTop:"1px solid var(--border)", transition:"background 0.12s",
        }}
        onMouseEnter={e=>{ e.currentTarget.style.background="var(--bg-hover)";
                           e.currentTarget.style.color="var(--accent)"; }}
        onMouseLeave={e=>{ e.currentTarget.style.background="transparent";
                           e.currentTarget.style.color="var(--text-muted)"; }}
      >
        <span style={{ fontSize:14, lineHeight:1 }}>+</span>
        {tr("Add task to")} {groupLabel}
      </div>
    );
  }

  return (
    <div style={{ borderTop:"1px solid var(--border)", background:"var(--bg-elevated)" }}>
      <div style={{ display:"grid", gridTemplateColumns:gridCols, gap:10,
                    alignItems:"center", padding:"8px 16px" }}>
        <input
          ref={inputRef}
          className="input"
          placeholder={tr("New task in {group}…", { group:groupLabel })}
          value={title}
          disabled={busy}
          onChange={e=>setTitle(e.target.value)}
          onKeyDown={e => {
            if (e.key === "Enter")  { e.preventDefault(); submit(); }
            if (e.key === "Escape") { e.preventDefault(); setTitle(""); setActive(false); }
          }}
          onBlur={() => { if (!title.trim() && !busy) setActive(false); }}
          style={{ fontSize:13, padding:"4px 8px" }}
        />
        <div style={{ gridColumn:"2 / -1", display:"flex", alignItems:"center", gap:8 }}>
          <button className="btn btn-primary btn-sm" onMouseDown={e=>e.preventDefault()}
            onClick={submit} disabled={busy || !title.trim()} style={{ fontSize:12 }}>
            {busy ? tr("Adding…") : tr("Add")}
          </button>
          <button className="btn btn-ghost btn-sm" onMouseDown={e=>e.preventDefault()}
            onClick={()=>{ setTitle(""); setActive(false); }} style={{ fontSize:12 }}>
            {tr("Cancel")}
          </button>
          <span style={{ fontSize:11, color:"var(--text-muted)" }}>
            {tr("Enter adds and stays open · Esc closes · edit the other fields inline")}
          </span>
        </div>
      </div>
      {error && (
        <div style={{ padding:"0 16px 8px", fontSize:11, color:"var(--red)" }}>{error}</div>
      )}
    </div>
  );
}

// ── Parent row + its subtasks + an inline "add subtask" input ────────────────
// Keeps the open/closed state of the subtask composer local to the task, so
// opening one does not re-render or disturb the rest of the list.
function TaskRowGroup({
  task, subtasks, onEdit, gridCols,
  members, categories, customFields, fieldValues,
  canEdit, onTaskChanged, onFieldChanged, onCommentPosted, onAddSubtask,
}) {
  const [adding, setAdding]     = useState(false);
  // Expanded by default so existing behaviour is unchanged until a user
  // deliberately collapses a group.
  const [expanded, setExpanded] = useState(true);

  return (
    <div>
      <ListRow task={task} onEdit={onEdit} gridCols={gridCols}
        members={members} categories={categories}
        customFields={customFields} fieldValues={fieldValues}
        canEdit={canEdit} onTaskChanged={onTaskChanged} onFieldChanged={onFieldChanged}
        onCommentPosted={onCommentPosted}
        onAddSubtaskClick={() => setAdding(true)}
        subtaskCount={subtasks.length}
        subtasksExpanded={expanded}
        onToggleSubtasks={() => setExpanded(e => !e)} />

      {expanded && subtasks.map(sub => (
        <ListRow key={sub.id} task={sub} onEdit={onEdit} indent gridCols={gridCols}
          members={members} categories={categories}
          customFields={customFields} fieldValues={fieldValues}
          canEdit={canEdit} onTaskChanged={onTaskChanged} onFieldChanged={onFieldChanged}
          onCommentPosted={onCommentPosted} />
      ))}

      {adding && (
        <SubtaskAddRow
          parent={task}
          gridCols={gridCols}
          onCreate={onAddSubtask}
          onClose={() => setAdding(false)}
        />
      )}
    </div>
  );
}

// ── Inline subtask composer ──────────────────────────────────────────────────
function SubtaskAddRow({ parent, gridCols, onCreate, onClose }) {
  const [title, setTitle] = useState("");
  const [busy,  setBusy]  = useState(false);
  const [error, setError] = useState("");
  const inputRef = useRef(null);

  useEffect(() => { inputRef.current?.focus(); }, []);

  const submit = async () => {
    const t = title.trim();
    if (!t) { onClose(); return; }
    setBusy(true); setError("");
    try {
      await onCreate({ title: t, parent_task_id: parent.id, project_id: parent.project_id });
      setTitle("");
      inputRef.current?.focus();     // stay open for the next subtask
    } catch (e) {
      setError(e.message || tr("Could not create subtask"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ background:"var(--bg-elevated)", borderBottom:"1px solid var(--border)" }}>
      <div style={{ display:"grid", gridTemplateColumns:gridCols, gap:10,
                    alignItems:"center", padding:"7px 16px 7px 32px" }}>
        <div style={{ display:"flex", alignItems:"center", gap:6, minWidth:0 }}>
          <span style={{ fontSize:11, color:"var(--text-muted)", flexShrink:0 }}>↳</span>
          <input
            ref={inputRef}
            className="input"
            placeholder={tr('New subtask of "{title}"…', { title:parent.title })}
            value={title}
            disabled={busy}
            onChange={e=>setTitle(e.target.value)}
            onKeyDown={e => {
              e.stopPropagation();
              if (e.key === "Enter")  { e.preventDefault(); submit(); }
              if (e.key === "Escape") { e.preventDefault(); onClose(); }
            }}
            onBlur={() => { if (!title.trim() && !busy) onClose(); }}
            style={{ fontSize:13, padding:"3px 8px", flex:1 }}
          />
        </div>
        <div style={{ gridColumn:"2 / -1", display:"flex", alignItems:"center", gap:8 }}>
          <button className="btn btn-primary btn-sm" onMouseDown={e=>e.preventDefault()}
            onClick={submit} disabled={busy || !title.trim()} style={{ fontSize:12 }}>
            {busy ? tr("Adding…") : tr("Add subtask")}
          </button>
          <button className="btn btn-ghost btn-sm" onMouseDown={e=>e.preventDefault()}
            onClick={onClose} style={{ fontSize:12 }}>{tr("Cancel")}</button>
          <span style={{ fontSize:11, color:"var(--text-muted)" }}>
            {tr("Enter adds and stays open · Esc closes")}
          </span>
        </div>
      </div>
      {error && <div style={{ padding:"0 16px 8px 32px", fontSize:11, color:"var(--red)" }}>{error}</div>}
    </div>
  );
}

// ── Saved views control ──────────────────────────────────────────────────────
// A dropdown of the user's saved filter presets for this project, plus a
// "Save as…" flow to capture whatever the toolbar controls are currently set
// to. Personal to the user — not shared with the rest of the project.
function SavedViewsControl({ savedViews, activeViewId, currentFilters, onApply, onSave, onDelete }) {
  const [saving, setSaving] = useState(false);
  const [name, setName]     = useState("");
  const [busy, setBusy]     = useState(false);
  const [error, setError]   = useState("");

  const hasAnyFilter =
    currentFilters.filterStatus || currentFilters.filterAssignee ||
    currentFilters.filterCategory || currentFilters.hideDone ||
    Object.keys(currentFilters.fieldFilters || {}).length > 0;

  const submit = async () => {
    const n = name.trim();
    if (!n) return;
    setBusy(true); setError("");
    try {
      await onSave(n);
      setName(""); setSaving(false);
    } catch (e) {
      setError(e.message || tr("Could not save view"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ display:"flex", alignItems:"center", gap:6, position:"relative" }}>
      {savedViews.length > 0 && (
        <select
          className="select"
          value={activeViewId || ""}
          onChange={e => {
            const v = savedViews.find(x => String(x.id) === e.target.value);
            if (v) onApply(v);
          }}
        >
          <option value="">{tr("My Views…")}</option>
          {savedViews.map(v => (
            <option key={v.id} value={String(v.id)}>{v.name}</option>
          ))}
        </select>
      )}

      {activeViewId && (
        <button onClick={()=>onDelete(activeViewId)}
          title={tr("Delete this saved view")}
          style={{ background:"none", border:"none", color:"var(--text-muted)", cursor:"pointer", fontSize:12 }}>
          ✕
        </button>
      )}

      {!saving ? (
        <button onClick={()=>setSaving(true)} disabled={!hasAnyFilter}
          title={hasAnyFilter ? tr("Save current filters as a view") : tr("Set some filters first")}
          className="btn btn-ghost btn-sm" style={{ fontSize:12 }}>
          {tr("⭐ Save view")}
        </button>
      ) : (
        <div style={{
          position:"absolute", top:"calc(100% + 6px)", insetInlineStart:0, zIndex:50,
          background:"var(--bg-surface)", border:"1px solid var(--border-soft)",
          borderRadius:8, boxShadow:"0 8px 24px rgba(0,0,0,0.3)", padding:10,
          display:"flex", flexDirection:"column", gap:6, width:220,
        }}>
          <input className="input" placeholder={tr("View name…")} autoFocus
            value={name} onChange={e=>setName(e.target.value)}
            onKeyDown={e => { if (e.key==="Enter") submit(); if (e.key==="Escape") setSaving(false); }}
            style={{ fontSize:13 }} />
          {error && <div style={{ fontSize:11, color:"var(--red)" }}>{error}</div>}
          <div style={{ display:"flex", gap:6 }}>
            <button className="btn btn-primary btn-sm" onClick={submit} disabled={busy || !name.trim()}
              style={{ fontSize:12, flex:1 }}>{busy?tr("Saving…"):tr("Save")}</button>
            <button className="btn btn-ghost btn-sm" onClick={()=>{setSaving(false);setName("");setError("");}}
              style={{ fontSize:12 }}>{tr("Cancel")}</button>
          </div>
        </div>
      )}
    </div>
  );
}
