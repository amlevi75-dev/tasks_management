import { useState, useEffect, useRef } from "react";
import { apiFetch, fmtDate, fmtDateTime, isRTL } from "../App";
import CustomFieldValues from "./CustomFieldValues";
import RichTextEditor from "./RichTextEditor";
import { tr, trVal } from "../i18n";

const STATUSES   = ["new", "open", "in_progress", "done"];
const PRIORITIES = ["low", "medium", "high", "critical"];
const PRIO_COLORS   = { low:"#10b981", medium:"#3b82f6", high:"#f59e0b", critical:"#ef4444" };
const STATUS_COLORS = { new:"#64748b", open:"#3b82f6", in_progress:"#f59e0b", done:"#10b981" };

// ── @mention textarea ─────────────────────────────────────────────────────────
function MentionTextarea({ value, onChange, members, placeholder, rows = 3 }) {
  const [mentionQuery, setMentionQuery] = useState(null);
  const [mentionPos, setMentionPos]     = useState(0);
  const taRef = useRef(null);
  const rtl   = isRTL(value);

  const handleChange = (e) => {
    const val    = e.target.value;
    const cursor = e.target.selectionStart;
    onChange(val);
    const before = val.slice(0, cursor);
    const match  = before.match(/@([\w.]*)$/);
    if (match) { setMentionQuery(match[1].toLowerCase()); setMentionPos(before.lastIndexOf("@")); }
    else        { setMentionQuery(null); }
  };

  const insertMention = (username) => {
    const before = value.slice(0, mentionPos);
    const after  = value.slice(taRef.current.selectionStart);
    const newVal = `${before}@${username} ${after}`;
    onChange(newVal);
    setMentionQuery(null);
    setTimeout(() => {
      const pos = mentionPos + username.length + 2;
      taRef.current?.setSelectionRange(pos, pos);
      taRef.current?.focus();
    }, 0);
  };

  const filtered = mentionQuery !== null
    ? members.filter(m =>
        m.username.toLowerCase().includes(mentionQuery) ||
        m.display_name.toLowerCase().includes(mentionQuery)
      ).slice(0, 6)
    : [];

  return (
    <div style={{ position:"relative" }}>
      <textarea ref={taRef} className="input" rows={rows}
        placeholder={placeholder} value={value} onChange={handleChange}
        onKeyDown={e => mentionQuery !== null && e.key==="Escape" && setMentionQuery(null)}
        style={{
          resize:"vertical",
          direction: rtl ? "rtl" : "ltr",
          textAlign: rtl ? "right" : "left",
        }}
      />
      {mentionQuery !== null && filtered.length > 0 && (
        <div style={{
          position:"absolute", bottom:"calc(100% + 4px)", insetInlineStart:0,
          background:"var(--bg-elevated)", border:"1px solid var(--border-soft)",
          borderRadius:8, boxShadow:"var(--shadow)", zIndex:200,
          minWidth:220, maxHeight:200, overflowY:"auto",
        }}>
          <div style={{ padding:"6px 10px", fontSize:10, fontWeight:700, color:"var(--text-muted)", textTransform:"uppercase", letterSpacing:"0.5px" }}>
            {tr("Mention a member")}
          </div>
          {filtered.map(m => (
            <div key={m.id} onClick={() => insertMention(m.username)}
              style={{ display:"flex", alignItems:"center", gap:8, padding:"8px 12px", cursor:"pointer", borderTop:"1px solid var(--border)" }}
              onMouseEnter={e=>e.currentTarget.style.background="var(--bg-hover)"}
              onMouseLeave={e=>e.currentTarget.style.background="transparent"}
            >
              <div style={{ width:24, height:24, borderRadius:"50%", flexShrink:0, background:`hsl(${(m.id*67)%360},50%,38%)`, color:"#fff", fontSize:10, fontWeight:700, display:"flex", alignItems:"center", justifyContent:"center" }}>
                {m.display_name[0]}
              </div>
              <div>
                <div style={{ fontSize:13, fontWeight:500 }}>{m.display_name}</div>
                <div style={{ fontSize:11, color:"var(--text-muted)" }}>@{m.username}</div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Comment body with RTL + @mention highlights ────────────────────────────────
function CommentBody({ body, members }) {
  // Shown as the person's display name, not the raw @username that was
  // typed and stored — the username is an input convenience, not what a
  // reader should see it rendered as.
  const byUsername = new Map(members.map(m => [m.username, m]));
  const rtl = isRTL(body);
  const parts = body.split(/(@[\w.]+)/g);
  return (
    <div style={{ direction: rtl?"rtl":"ltr", textAlign: rtl?"right":"left" }}>
      <span style={{ fontSize:13, color:"var(--text-secondary)", whiteSpace:"pre-wrap", wordBreak:"break-word" }}>
        {parts.map((part, i) => {
          if (part.startsWith("@")) {
            const m = byUsername.get(part.slice(1));
            return (
              <span key={i} title={part} style={{
                display:"inline-flex", alignItems:"center", gap:3,
                background: m?"rgba(139,92,246,0.15)":"var(--bg-elevated)",
                color: m?"#a78bfa":"var(--text-muted)",
                borderRadius:4, padding:"0 5px", fontSize:12, fontWeight:600,
              }}>{m ? `@${m.display_name}` : part}</span>
            );
          }
          return <span key={i}>{part}</span>;
        })}
      </span>
    </div>
  );
}

// ── File size formatter ───────────────────────────────────────────────────────
function fmtSize(bytes) {
  if (bytes < 1024)       return `${bytes} B`;
  if (bytes < 1024*1024)  return `${(bytes/1024).toFixed(1)} KB`;
  return `${(bytes/1024/1024).toFixed(1)} MB`;
}

// ── Main TaskModal ────────────────────────────────────────────────────────────
export default function TaskModal({ task, projectId, projectMembers=[], projectCategories=[], onSave, onClose }) {
  const isEdit        = !!task;
  const isSubtask     = !!task?.parent_task_id;
  const resolvedProjectId = projectId || task?.project_id;

  const [form, setForm] = useState({
    title:        task?.title        || "",
    description:  task?.description  || "",
    status:       task?.status       || "new",
    priority:     task?.priority     || "medium",
    assignee_id:  task?.assignee_id  != null ? String(task.assignee_id)  : "",
    requester_id: task?.requester_id != null ? String(task.requester_id) : "",
    request_text: task?.request_text || "",
    category_id:  task?.category_id  != null ? String(task.category_id) : "",
    start_date:   task?.start_date   || "",
    due_date:     task?.due_date     || "",
  });
  const [fullTask, setFullTask]       = useState(null);
  const [members, setMembers]         = useState(projectMembers);
  const [newComment, setNewComment]   = useState("");
  const [loading, setLoading]         = useState(false);
  const [error, setError]             = useState("");
  const [tab, setTab]                 = useState("details");
  const [deps, setDeps]               = useState({ blockers:[], blocking:[] });
  const [collaborators, setCollaborators] = useState([]);
  const [showSubForm, setShowSubForm] = useState(false);
  const [subForm, setSubForm]         = useState({ title:"", priority:"medium", assignee_id:"", start_date:"", due_date:"" });
  const [subError, setSubError]       = useState("");
  const [uploading, setUploading]     = useState(false);
  const fileInputRef    = useRef(null);
  const pendingFieldsRef = useRef({});  // stores field values before task is created

  useEffect(() => {
    if (resolvedProjectId) {
      apiFetch(`/users?project_id=${resolvedProjectId}`)
        .then(data => { if (data.length > 0) setMembers(data); })
        .catch(() => {});
    }
    if (isEdit && task.id) {
      apiFetch(`/tasks/${task.id}/dependencies`).then(setDeps).catch(() => {});
      apiFetch(`/tasks/${task.id}/collaborators`).then(setCollaborators).catch(() => {});
      apiFetch(`/tasks/${task.id}`).then(t => {
        setFullTask(t);
        setForm(f => ({
          ...f,
          title:        t.title        ?? f.title,
          description:  t.description  ?? f.description,
          status:       t.status       ?? f.status,
          priority:     t.priority     ?? f.priority,
          assignee_id:  t.assignee_id  != null ? String(t.assignee_id)  : "",
          requester_id: t.requester_id != null ? String(t.requester_id) : "",
          request_text: t.request_text ?? f.request_text,
          category_id:  t.category_id != null ? String(t.category_id) : "",
          start_date:   t.start_date   ?? f.start_date,
          due_date:     t.due_date     ?? f.due_date,
        }));
      }).catch(() => {});
    }
  }, [task?.id, resolvedProjectId]);

  const set    = (k,v) => setForm(f=>({...f,[k]:v}));
  const setSub = (k,v) => setSubForm(f=>({...f,[k]:v}));
  const reload    = () => apiFetch(`/tasks/${task.id}`).then(setFullTask);
  const reloadDeps = () => apiFetch(`/tasks/${task.id}/dependencies`).then(setDeps).catch(()=>{});
  const reloadCollaborators = () => apiFetch(`/tasks/${task.id}/collaborators`).then(setCollaborators).catch(()=>{});

  const save = async () => {
    if (!form.title.trim()) { setError(tr("Title required")); return; }
    setLoading(true); setError("");
    try {
      const body = {
        ...form,
        assignee_id:  form.assignee_id  ? Number(form.assignee_id)  : null,
        requester_id: form.requester_id ? Number(form.requester_id) : null,
        request_text: form.request_text || null,
        category_id:  form.category_id  ? Number(form.category_id) : null,
        start_date:   form.start_date   || null,
        due_date:     form.due_date     || null,
        project_id:   resolvedProjectId,
      };
      if (isEdit) {
        await apiFetch(`/tasks/${task.id}`, { method:"PATCH", body:JSON.stringify(body) });
      } else {
        const newTask = await apiFetch("/tasks", { method:"POST", body:JSON.stringify(body) });
        // Save any pending custom field values collected during creation
        const pending = pendingFieldsRef.current;
        if (newTask?.id && Object.keys(pending).length > 0) {
          await Promise.all(Object.entries(pending).map(([fieldId, value]) =>
            apiFetch(`/tasks/${newTask.id}/field-values`, {
              method:"POST",
              body:JSON.stringify({ field_id:Number(fieldId), value }),
            }).catch(()=>{})
          ));
          pendingFieldsRef.current = {};
        }
      }
      onSave();
    } catch(e) { setError(e.message); }
    finally { setLoading(false); }
  };

  const deleteTask = async () => {
    if (!confirm(tr("Delete this task?"))) return;
    await apiFetch(`/tasks/${task.id}`, { method:"DELETE" });
    onSave();
  };

  const sendComment = async () => {
    if (!newComment.trim()) return;
    await apiFetch(`/tasks/${task.id}/comments`, { method:"POST", body:JSON.stringify({ body:newComment }) });
    setNewComment("");
    reload();
  };

  const addSubtask = async () => {
    if (!subForm.title.trim()) { setSubError(tr("Title required")); return; }
    setSubError("");
    try {
      await apiFetch("/tasks", {
        method:"POST",
        body:JSON.stringify({
          project_id:     resolvedProjectId,
          title:          subForm.title,
          priority:       subForm.priority,
          assignee_id:    subForm.assignee_id ? Number(subForm.assignee_id) : null,
          start_date:     subForm.start_date  || null,
          due_date:       subForm.due_date    || null,
          status:         "new",
          parent_task_id: task.id,
        }),
      });
      setSubForm({ title:"", priority:"medium", assignee_id:"", start_date:"", due_date:"" });
      setShowSubForm(false);
      reload();
    } catch(e) { setSubError(e.message); }
  };

  const toggleSubtask = async (e, sub) => {
    e.stopPropagation();
    const newStatus = sub.status==="done" ? "open" : "done";
    try {
      await apiFetch(`/tasks/${sub.id}`, { method:"PATCH", body:JSON.stringify({ status:newStatus }) });
      reload();
    } catch(err) {
      setError(err.message);
    }
  };

  const deleteSubtask = async (subId) => {
    await apiFetch(`/tasks/${subId}`, { method:"DELETE" });
    reload();
  };

  const uploadFile = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      await fetch(`${window.location.port==="5173"?"http://localhost:8000":""}/api/tasks/${task.id}/attachments`, {
        method:"POST", credentials:"include", body:fd,
      });
      reload();
    } catch(e) { alert(tr("Upload failed: ") + e.message); }
    finally { setUploading(false); e.target.value=""; }
  };

  const deleteAttachment = async (attId) => {
    if (!confirm(tr("Delete this attachment?"))) return;
    await apiFetch(`/tasks/${task.id}/attachments/${attId}`, { method:"DELETE" });
    reload();
  };

  const downloadUrl = (attId) => {
    const base = window.location.port==="5173" ? "http://localhost:8000" : "";
    return `${base}/api/tasks/${task.id}/attachments/${attId}/download`;
  };

  const comments    = fullTask?.comments    || [];
  const subtasks    = fullTask?.subtasks    || [];
  const attachments = fullTask?.attachments || [];
  const doneCount   = subtasks.filter(s=>s.status==="done").length;

  const tabs = [
    ["details",     "Details"],
    ["subtasks",    `Subtasks${subtasks.length>0?` (${doneCount}/${subtasks.length})`:""}`],
    ["comments",    `Comments${comments.length>0?` (${comments.length})`:""}`],
    ["attachments",   `Files${attachments.length>0?` (${attachments.length})`:""}`],
    ["dependencies",  `Dependencies${(deps.blockers.length+deps.blocking.length)>0?` (${deps.blockers.length+deps.blocking.length})`:""}`],
    ["collaborators", `Collaborators${collaborators.length>0?` (${collaborators.length})`:""}`],
  ];

  return (
    <div className="modal-overlay" onClick={e=>e.target===e.currentTarget&&onClose()}>
      <div className="modal" style={{ maxWidth:740 }}>

        {/* Header */}
        <div className="modal-header">
          <div style={{ display:"flex", alignItems:"center", gap:10 }}>
            {isEdit && <span style={{ fontSize:11, fontWeight:700, color:"var(--text-muted)", fontFamily:"monospace" }}>#{task.id}</span>}
            <span style={{ fontWeight:600, fontSize:15 }}>{isEdit?tr("Edit Task"):tr("New Task")}</span>
          </div>
          <button className="btn btn-ghost btn-sm" onClick={onClose}>×</button>
        </div>

        {/* Tabs — edit only */}
        {isEdit && (
          <div style={{ display:"flex", borderBottom:"1px solid var(--border)", padding:"0 24px", overflowX:"auto" }}>
            {tabs.map(([t,label])=>(
              <button key={t} onClick={()=>setTab(t)} style={{
                padding:"10px 14px", border:"none", background:"transparent", whiteSpace:"nowrap",
                color: tab===t?"var(--accent)":"var(--text-muted)",
                borderBottom: tab===t?"2px solid var(--accent)":"2px solid transparent",
                fontSize:13, fontWeight:500, cursor:"pointer",
              }}>{label}</button>
            ))}
          </div>
        )}

        {/* ── Details ── */}
        {tab==="details" && (
          <div className="modal-body">
            {isEdit && fullTask?.reporter_name && (
              <div style={{ display:"flex", gap:16, flexWrap:"wrap", fontSize:12, color:"var(--text-muted)", background:"var(--bg-elevated)", padding:"8px 12px", borderRadius:6 }}>
                <span>{tr("Created by")} <b style={{ color:"var(--text-secondary)" }}>{fullTask.reporter_name}</b></span>
                <span>{tr("on")} <b style={{ color:"var(--text-secondary)" }}>{fmtDateTime(fullTask.created_at)}</b></span>
                {fullTask.updated_at && fullTask.updated_at!==fullTask.created_at && (
                  <span>{tr("· Updated")} <b style={{ color:"var(--text-secondary)" }}>{fmtDate(fullTask.updated_at)}</b></span>
                )}
              </div>
            )}

            <div className="form-group">
              <label className="form-label">{tr("Title *")}</label>
              <input className="input" placeholder={tr("Task title")} value={form.title}
                onChange={e=>set("title",e.target.value)} onKeyDown={e=>e.key==="Enter"&&save()} />
            </div>
            <div className="form-group">
              <label className="form-label">{tr("Description")}</label>
              <RichTextEditor
                value={form.description}
                onChange={v => set("description", v)}
                placeholder={tr("Add more details…")}
              />
            </div>

            {/* Row 1: Status, Priority */}
            <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:14 }}>
              <div className="form-group">
                <label className="form-label">{tr("Status")}</label>
                <select className="select" style={{ width:"100%" }} value={form.status} onChange={e=>set("status",e.target.value)}>
                  {STATUSES.map(s=><option key={s} value={s}>{trVal("status", s, s.replace("_"," ").replace(/\b\w/g,c=>c.toUpperCase()))}</option>)}
                </select>
              </div>
              <div className="form-group">
                <label className="form-label">{tr("Priority")}</label>
                <select className="select" style={{ width:"100%" }} value={form.priority} onChange={e=>set("priority",e.target.value)}>
                  {PRIORITIES.map(p=><option key={p} value={p}>{trVal("prio", p, p.replace(/\b\w/g,c=>c.toUpperCase()))}</option>)}
                </select>
              </div>
            </div>

            {/* Row 2: Assignee, Requester */}
            <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:14 }}>
              <div className="form-group">
                <label className="form-label">{tr("Assignee")}</label>
                <select className="select" style={{ width:"100%" }} value={form.assignee_id} onChange={e=>set("assignee_id",e.target.value)}>
                  <option value="">{tr("Unassigned")}</option>
                  {members.map(u=><option key={u.id} value={String(u.id)}>{u.display_name}</option>)}
                </select>
              </div>
              <div className="form-group">
                <label className="form-label">{tr("Requester")}</label>
                <input className="input" placeholder={tr("Name or description of requester…")}
                  value={form.request_text||""}
                  onChange={e=>set("request_text",e.target.value)} />
              </div>
              {projectCategories.length > 0 && (
                <div className="form-group">
                  <label className="form-label">{tr("Category")}</label>
                  <select className="select" style={{ width:"100%" }} value={form.category_id} onChange={e=>set("category_id",e.target.value)}>
                    <option value="">{tr("— None —")}</option>
                    {projectCategories.map(c=><option key={c.id} value={String(c.id)}>{c.name}</option>)}
                  </select>
                </div>
              )}
            </div>

            {/* Row 3: Start date, Due date */}
            <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:14 }}>
              <div className="form-group">
                <label className="form-label">{tr("Start Date")}</label>
                <input type="date" className="input" value={form.start_date} onChange={e=>set("start_date",e.target.value)} />
              </div>
              <div className="form-group">
                <label className="form-label">{tr("Due Date")}</label>
                <input type="date" className="input" value={form.due_date} onChange={e=>set("due_date",e.target.value)} />
              </div>
            </div>

            {/* Custom fields — shown for both new and existing tasks */}
            {resolvedProjectId && (
              <CustomFieldValues
                taskId={isEdit ? (fullTask?.id ?? task?.id) : null}
                projectId={resolvedProjectId}
                isViewer={false}
                pendingTaskRef={isEdit ? null : pendingFieldsRef}
              />
            )}

            {error && <div style={{ color:"#fca5a5", fontSize:13, background:"rgba(239,68,68,0.1)", padding:"8px 12px", borderRadius:6 }}>{error}</div>}
          </div>
        )}

        {/* ── Subtasks ── */}
        {tab==="subtasks" && (
          <div className="modal-body">
            {subtasks.length>0 && (
              <div style={{ marginBottom:8 }}>
                <div style={{ height:6, background:"var(--bg-elevated)", borderRadius:3, overflow:"hidden" }}>
                  <div style={{ height:"100%", width:`${(doneCount/subtasks.length)*100}%`, background:"var(--green)", transition:"width 0.3s", borderRadius:3 }} />
                </div>
                <div style={{ fontSize:11, color:"var(--text-muted)", marginTop:4 }}>{doneCount} {tr("of")} {subtasks.length} {tr("completed")}</div>
              </div>
            )}
            <div style={{ display:"flex", flexDirection:"column", gap:6 }}>
              {subtasks.map(s => {
                const pc = PRIO_COLORS[s.priority]||"#3b82f6";
                const overdue = s.due_date && s.status!=="done" && new Date(s.due_date)<new Date(new Date().toDateString());
                return (
                  <div key={s.id} style={{ background:"var(--bg-elevated)", borderRadius:8, border:`1px solid ${overdue?"rgba(239,68,68,0.35)":"var(--border)"}`, borderInlineStart:`3px solid ${pc}` }}>
                    <div style={{ display:"flex", alignItems:"center", gap:8, padding:"8px 12px" }}>
                      <button onClick={e=>toggleSubtask(e, s)} style={{
                        width:18, height:18, borderRadius:4, flexShrink:0,
                        border:`2px solid ${s.status==="done"?"#10b981":"var(--border-soft)"}`,
                        background: s.status==="done"?"#10b981":"transparent",
                        color:"#fff", fontSize:10, display:"flex", alignItems:"center", justifyContent:"center", cursor:"pointer",
                      }}>{s.status==="done"?"✓":""}</button>
                      <span style={{ fontSize:13, flex:1, textDecoration:s.status==="done"?"line-through":"none", color:s.status==="done"?"var(--text-muted)":"var(--text-primary)" }}>
                        {s.title}
                      </span>
                      <span style={{ fontSize:10, fontWeight:700, padding:"1px 6px", borderRadius:3, background:`${pc}20`, color:pc, flexShrink:0 }}>{trVal("prio", s.priority)}</span>
                      {s.start_date && <span style={{ fontSize:10, color:"var(--text-muted)", flexShrink:0 }}>▶{fmtDate(s.start_date)}</span>}
                      {s.assignee_name && (
                        <div title={s.assignee_name} style={{ width:20, height:20, borderRadius:"50%", background:`hsl(${(s.assignee_id*67)%360},50%,38%)`, color:"#fff", fontSize:9, fontWeight:700, display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0 }}>
                          {s.assignee_name[0]}
                        </div>
                      )}
                      {s.due_date && <span style={{ fontSize:10, color:overdue?"var(--red)":"var(--text-muted)", flexShrink:0 }}>{overdue?"🔔":""}{fmtDate(s.due_date)}</span>}
                      <button onClick={()=>deleteSubtask(s.id)} style={{ background:"none", border:"none", color:"var(--text-muted)", cursor:"pointer", fontSize:15, padding:"0 2px", flexShrink:0 }}>×</button>
                    </div>
                  </div>
                );
              })}
              {subtasks.length===0&&!showSubForm&&(
                <div style={{ textAlign:"center", color:"var(--text-muted)", fontSize:13, padding:"16px 0" }}>{tr("No subtasks yet")}</div>
              )}
            </div>

            {!isSubtask && (showSubForm ? (
              <div style={{ background:"var(--bg-elevated)", borderRadius:8, padding:14, border:"1px solid var(--border-soft)", display:"flex", flexDirection:"column", gap:10, marginTop:8 }}>
                <div className="form-group">
                  <label className="form-label">{tr("Subtask Title *")}</label>
                  <input className="input" placeholder={tr("What needs to be done?")} autoFocus
                    value={subForm.title} onChange={e=>setSub("title",e.target.value)}
                    onKeyDown={e=>e.key==="Enter"&&addSubtask()} />
                </div>
                <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:10 }}>
                  <div className="form-group">
                    <label className="form-label">{tr("Priority")}</label>
                    <select className="select" style={{ width:"100%" }} value={subForm.priority} onChange={e=>setSub("priority",e.target.value)}>
                      {PRIORITIES.map(p=><option key={p} value={p}>{trVal("prio", p, p.replace(/\b\w/g,c=>c.toUpperCase()))}</option>)}
                    </select>
                  </div>
                  <div className="form-group">
                    <label className="form-label">{tr("Assignee")}</label>
                    <select className="select" style={{ width:"100%" }} value={subForm.assignee_id} onChange={e=>setSub("assignee_id",e.target.value)}>
                      <option value="">{tr("Unassigned")}</option>
                      {members.map(u=><option key={u.id} value={String(u.id)}>{u.display_name}</option>)}
                    </select>
                  </div>
                  <div className="form-group">
                    <label className="form-label">{tr("Start Date")}</label>
                    <input type="date" className="input" value={subForm.start_date} onChange={e=>setSub("start_date",e.target.value)} />
                  </div>
                  <div className="form-group">
                    <label className="form-label">{tr("Due Date")}</label>
                    <input type="date" className="input" value={subForm.due_date} onChange={e=>setSub("due_date",e.target.value)} />
                  </div>
                </div>
                {subError && <div style={{ color:"#fca5a5", fontSize:12 }}>{subError}</div>}
                <div style={{ display:"flex", gap:8 }}>
                  <button className="btn btn-primary btn-sm" onClick={addSubtask}>{tr("Add Subtask")}</button>
                  <button className="btn btn-ghost btn-sm" onClick={()=>{setShowSubForm(false);setSubError("");}}>{tr("Close")}</button>
                </div>
              </div>
            ) : (
              <button className="btn btn-ghost" onClick={()=>setShowSubForm(true)} style={{ alignSelf:"flex-start", marginTop:8 }}>
                {tr("+ Add Subtask")}
              </button>
            ))}
          </div>
        )}

        {/* ── Comments ── */}
        {tab==="comments" && (
          <div className="modal-body">
            <div style={{ display:"flex", flexDirection:"column", gap:10, maxHeight:280, overflowY:"auto" }}>
              {comments.map(c=>(
                <div key={c.id} style={{ background:"var(--bg-elevated)", borderRadius:8, padding:"10px 12px" }}>
                  <div style={{ display:"flex", justifyContent:"space-between", marginBottom:6 }}>
                    <div style={{ display:"flex", alignItems:"center", gap:8 }}>
                      <div style={{ width:24, height:24, borderRadius:"50%", background:`hsl(${(c.user_id*67)%360},50%,38%)`, color:"#fff", fontSize:10, fontWeight:700, display:"flex", alignItems:"center", justifyContent:"center" }}>
                        {(c.display_name||"?")[0]}
                      </div>
                      <span style={{ fontSize:12, fontWeight:600 }}>{c.display_name}</span>
                    </div>
                    <span style={{ fontSize:11, color:"var(--text-muted)" }}>{fmtDateTime(c.created_at)}</span>
                  </div>
                  <CommentBody body={c.body} members={members} />
                </div>
              ))}
              {comments.length===0&&(
                <div style={{ color:"var(--text-muted)", fontSize:13, textAlign:"center", padding:"20px 0" }}>{tr("No comments yet")}</div>
              )}
            </div>
            <div style={{ display:"flex", flexDirection:"column", gap:6, marginTop:8 }}>
              <MentionTextarea value={newComment} onChange={setNewComment} members={members}
                placeholder={tr("Add a comment… type @ to mention someone")} rows={3} />
              <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center" }}>
                <span style={{ fontSize:11, color:"var(--text-muted)" }}>{tr("Tip: type @ to mention · Hebrew text auto-aligns right")}</span>
                <button className="btn btn-primary btn-sm" onClick={sendComment}>{tr("Send")}</button>
              </div>
            </div>
          </div>
        )}

        {/* ── Attachments ── */}
        {tab==="attachments" && (
          <div className="modal-body">
            <input ref={fileInputRef} type="file" style={{ display:"none" }} onChange={uploadFile} />
            <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
              {attachments.map(a => (
                <div key={a.id} style={{ display:"flex", alignItems:"center", gap:10, padding:"10px 14px", background:"var(--bg-elevated)", borderRadius:8, border:"1px solid var(--border)" }}>
                  <span style={{ fontSize:20, flexShrink:0 }}>📎</span>
                  <div style={{ flex:1, minWidth:0 }}>
                    <a href={downloadUrl(a.id)} target="_blank" rel="noreferrer"
                      style={{ fontSize:13, fontWeight:500, color:"var(--accent)", textDecoration:"none", display:"block", overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>
                      {a.filename}
                    </a>
                    <div style={{ fontSize:11, color:"var(--text-muted)", marginTop:2 }}>
                      {fmtSize(a.size)} · {a.uploader} · {fmtDate(a.created_at)}
                    </div>
                  </div>
                  <a href={downloadUrl(a.id)} target="_blank" rel="noreferrer"
                    className="btn btn-ghost btn-sm" style={{ flexShrink:0 }}>↓</a>
                  <button className="btn btn-ghost btn-sm" onClick={()=>deleteAttachment(a.id)}
                    style={{ color:"var(--red)", borderColor:"rgba(239,68,68,0.3)", flexShrink:0 }}>×</button>
                </div>
              ))}
              {attachments.length===0&&(
                <div style={{ textAlign:"center", color:"var(--text-muted)", fontSize:13, padding:"20px 0" }}>{tr("No files attached")}</div>
              )}
            </div>
            <button className="btn btn-ghost" onClick={()=>fileInputRef.current?.click()}
              disabled={uploading} style={{ marginTop:8, gap:6 }}>
              {uploading ? tr("Uploading…") : tr("📎 Attach File")}
            </button>
            <p style={{ fontSize:11, color:"var(--text-muted)", marginTop:4 }}>{tr("Max 20 MB per file")}</p>
          </div>
        )}

        {/* ── Dependencies ── */}
        {tab==="dependencies" && (
          <DependenciesTab taskId={task?.id} projectId={resolvedProjectId} deps={deps} onChanged={reloadDeps} />
        )}

        {/* ── Collaborators ── */}
        {tab==="collaborators" && (
          <CollaboratorsTab taskId={task?.id} projectMembers={projectMembers}
            assigneeId={form.assignee_id} collaborators={collaborators}
            onChanged={reloadCollaborators} />
        )}

        <div className="modal-footer">
          {isEdit && <button className="btn btn-danger btn-sm" onClick={deleteTask} style={{ marginInlineEnd:"auto" }}>{tr("Delete")}</button>}
          <button className="btn btn-ghost" onClick={onClose}>{tr("Cancel")}</button>
          {tab==="details" && (
            <button className="btn btn-primary" onClick={save} disabled={loading}>{loading?tr("Saving…"):tr("Save Task")}</button>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Dependencies tab component ────────────────────────────────────────────────
const DEP_TYPES = {
  finish_to_start: { get label(){ return tr("Blocked by"); }, icon:"🔒", get desc(){ return tr("Cannot start until blocker is done"); } },
  relates_to:      { get label(){ return tr("Relates to"); }, icon:"🔗", get desc(){ return tr("Related task (informational)"); } },
};
const STATUS_COLORS_D = { new:"#64748b", open:"#3b82f6", in_progress:"#f59e0b", done:"#10b981" };

function DependenciesTab({ taskId, projectId, deps, onChanged }) {
  const [search, setSearch]   = useState("");
  const [results, setResults] = useState([]);
  const [depType, setDepType] = useState("finish_to_start");
  const [adding, setAdding]   = useState(null);
  const [error, setError]     = useState("");
  const [busy, setBusy]       = useState(false);

  const searchTasks = async (q) => {
    setSearch(q); setAdding(null);
    if (q.length < 2) { setResults([]); return; }
    try {
      const all = await apiFetch(`/tasks?project_id=${projectId}&parent_only=false`);
      setResults(all.filter(t => t.id !== taskId &&
        (t.title.toLowerCase().includes(q.toLowerCase()) || String(t.id).includes(q))
      ).slice(0, 8));
    } catch { setResults([]); }
  };

  const addDep = async () => {
    if (!adding) return;
    setBusy(true); setError("");
    try {
      await apiFetch(`/tasks/${taskId}/dependencies`, {
        method:"POST",
        body: JSON.stringify({ depends_on_id: adding.id, dep_type: depType }),
      });
      setAdding(null); setSearch(""); setResults([]);
      onChanged();
    } catch(e) { setError(e.message); }
    finally { setBusy(false); }
  };

  const removeDep = async (depId) => {
    await apiFetch(`/tasks/${taskId}/dependencies/${depId}`, { method:"DELETE" });
    onChanged();
  };

  return (
    <div className="modal-body">
      {error && <div style={{ color:"#fca5a5", fontSize:13, background:"rgba(239,68,68,0.1)", padding:"8px 12px", borderRadius:6 }}>{error}</div>}

      {/* Blockers — tasks this task depends on */}
      {deps.blockers.length > 0 && (
        <div>
          <div className="form-label" style={{ marginBottom:8 }}>{tr("🔒 This task is blocked by")}</div>
          <div style={{ display:"flex", flexDirection:"column", gap:6 }}>
            {deps.blockers.map(d => {
              const sc = STATUS_COLORS_D[d.status]||"#64748b";
              const done = d.status==="done";
              return (
                <div key={d.dep_id} style={{ display:"flex", alignItems:"center", gap:10, padding:"8px 12px", background:"var(--bg-elevated)", borderRadius:8, border:`1px solid ${done?"rgba(16,185,129,0.3)":"rgba(239,68,68,0.2)"}` }}>
                  <span style={{ fontSize:16 }}>{done?"✅":"⏳"}</span>
                  <div style={{ flex:1 }}>
                    <div style={{ fontSize:13, fontWeight:500, textDecoration:done?"line-through":"none", color:done?"var(--text-muted)":"var(--text-primary)" }}>
                      #{d.id} {d.title}
                    </div>
                    <div style={{ fontSize:11, color:sc, fontWeight:600, marginTop:2 }}>{trVal("status", d.status, d.status.replace("_"," "))}</div>
                  </div>
                  <button onClick={()=>removeDep(d.dep_id)} style={{ background:"none", border:"none", color:"var(--text-muted)", cursor:"pointer", fontSize:16 }}>×</button>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Blocking — tasks blocked by this task */}
      {deps.blocking.length > 0 && (
        <div>
          <div className="form-label" style={{ marginBottom:8 }}>{tr("⛔ This task is blocking")}</div>
          <div style={{ display:"flex", flexDirection:"column", gap:6 }}>
            {deps.blocking.map(d => {
              const sc = STATUS_COLORS_D[d.status]||"#64748b";
              return (
                <div key={d.dep_id} style={{ display:"flex", alignItems:"center", gap:10, padding:"8px 12px", background:"var(--bg-elevated)", borderRadius:8, border:"1px solid var(--border)" }}>
                  <span style={{ fontSize:16 }}>⛔</span>
                  <div style={{ flex:1 }}>
                    <div style={{ fontSize:13, fontWeight:500 }}>#{d.id} {d.title}</div>
                    <div style={{ fontSize:11, color:sc, fontWeight:600, marginTop:2 }}>{trVal("status", d.status, d.status.replace("_"," "))}</div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {deps.blockers.length===0 && deps.blocking.length===0 && (
        <div style={{ textAlign:"center", color:"var(--text-muted)", fontSize:13, padding:"12px 0" }}>{tr("No dependencies set")}</div>
      )}

      {/* Add dependency */}
      <div style={{ borderTop:"1px solid var(--border)", paddingTop:14 }}>
        <div className="form-label" style={{ marginBottom:8 }}>{tr("Add Dependency")}</div>
        <div style={{ display:"flex", gap:8, marginBottom:8 }}>
          {Object.entries(DEP_TYPES).map(([key, val]) => (
            <button key={key} onClick={()=>setDepType(key)} style={{
              padding:"5px 12px", border:"1px solid var(--border-soft)", borderRadius:6,
              background: depType===key?"var(--accent-soft)":"transparent",
              color: depType===key?"var(--accent)":"var(--text-secondary)",
              fontSize:12, cursor:"pointer", fontWeight: depType===key?600:400,
            }} title={val.desc}>{val.icon} {val.label}</button>
          ))}
        </div>
        <div style={{ position:"relative" }}>
          <input className="input" placeholder={tr("Search tasks by title or #ID…")}
            value={search} onChange={e=>searchTasks(e.target.value)} />
          {results.length>0 && !adding && (
            <div style={{ position:"absolute", top:"calc(100% + 4px)", left:0, right:0, zIndex:30, background:"var(--bg-elevated)", border:"1px solid var(--border-soft)", borderRadius:8, maxHeight:200, overflowY:"auto", boxShadow:"var(--shadow)" }}>
              {results.map(t => {
                const sc = STATUS_COLORS_D[t.status]||"#64748b";
                return (
                  <div key={t.id} onClick={()=>{ setAdding(t); setSearch(`#${t.id} ${t.title}`); setResults([]); }}
                    style={{ padding:"8px 14px", cursor:"pointer", borderBottom:"1px solid var(--border)", display:"flex", alignItems:"center", gap:8 }}
                    onMouseEnter={e=>e.currentTarget.style.background="var(--bg-hover)"}
                    onMouseLeave={e=>e.currentTarget.style.background="transparent"}
                  >
                    <span style={{ fontSize:11, fontFamily:"monospace", color:"var(--text-muted)", flexShrink:0 }}>#{t.id}</span>
                    <span style={{ fontSize:13, flex:1 }}>{t.title}</span>
                    <span style={{ fontSize:10, fontWeight:600, padding:"1px 6px", borderRadius:3, background:`${sc}20`, color:sc, flexShrink:0 }}>{trVal("status", t.status, t.status.replace("_"," "))}</span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
        {adding && (
          <div style={{ display:"flex", gap:8, marginTop:8, alignItems:"center" }}>
            <span style={{ fontSize:13, flex:1, color:"var(--text-secondary)" }}>
              {DEP_TYPES[depType].icon} <b style={{ color:"var(--text-primary)" }}>{adding.title}</b>
            </span>
            <button className="btn btn-primary btn-sm" onClick={addDep} disabled={busy}>{busy?"…":tr("Add")}</button>
            <button className="btn btn-ghost btn-sm" onClick={()=>{setAdding(null);setSearch("");setResults([]);}}>✕</button>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Collaborators tab ────────────────────────────────────────────────────────
// Any number of additional people beyond the single required assignee. Same
// visibility and edit rights as the assignee, kept as a distinct list so the
// person accountable for the task (the assignee) stays clear.
function CollaboratorsTab({ taskId, projectMembers, assigneeId, collaborators, onChanged }) {
  const [adding, setAdding] = useState(false);
  const [pickId, setPickId] = useState("");
  const [busy, setBusy]     = useState(false);
  const [error, setError]   = useState("");

  const already = new Set(collaborators.map(c => c.id));
  const eligible = projectMembers.filter(m =>
    String(m.id) !== String(assigneeId) && !already.has(m.id)
  );

  const add = async () => {
    if (!pickId) return;
    setBusy(true); setError("");
    try {
      await apiFetch(`/tasks/${taskId}/collaborators`, {
        method: "POST",
        body: JSON.stringify({ user_id: Number(pickId) }),
      });
      setPickId(""); setAdding(false);
      onChanged();
    } catch (e) {
      setError(e.message || tr("Could not add collaborator"));
    } finally {
      setBusy(false);
    }
  };

  const remove = async (userId) => {
    await apiFetch(`/tasks/${taskId}/collaborators/${userId}`, { method: "DELETE" });
    onChanged();
  };

  return (
    <div className="modal-body">
      <p style={{ fontSize:12, color:"var(--text-muted)", marginBottom:10 }}>
        {tr("Collaborators can see, comment on, and edit this task the same as the assignee. Use this for anyone who needs to work on the task without being the person accountable for it.")}
      </p>

      <div style={{ display:"flex", flexDirection:"column", gap:6, marginBottom:12 }}>
        {collaborators.map(c => (
          <div key={c.id} style={{
            display:"flex", alignItems:"center", gap:10, padding:"8px 12px",
            background:"var(--bg-elevated)", borderRadius:8, border:"1px solid var(--border)",
          }}>
            <div style={{
              width:24, height:24, borderRadius:"50%", flexShrink:0,
              background:`hsl(${(c.id*67)%360},50%,38%)`, color:"#fff",
              fontSize:10, fontWeight:700,
              display:"flex", alignItems:"center", justifyContent:"center",
            }}>{c.display_name[0]}</div>
            <div style={{ flex:1, minWidth:0 }}>
              <div style={{ fontSize:13, fontWeight:500 }}>{c.display_name}</div>
              {!c.email && (
                <div style={{ fontSize:10, color:"var(--red)" }}>{tr("No email on file — won't get notified")}</div>
              )}
            </div>
            <button onClick={()=>remove(c.id)}
              style={{ background:"none", border:"none", color:"var(--text-muted)", cursor:"pointer", fontSize:16 }}>×</button>
          </div>
        ))}
        {collaborators.length === 0 && !adding && (
          <div style={{ textAlign:"center", color:"var(--text-muted)", fontSize:13, padding:"12px 0" }}>
            {tr("No collaborators yet")}
          </div>
        )}
      </div>

      {adding ? (
        <div style={{ display:"flex", gap:8, alignItems:"center" }}>
          <select className="select" style={{ flex:1 }} value={pickId} onChange={e=>setPickId(e.target.value)}>
            <option value="">{tr("Select a project member…")}</option>
            {eligible.map(m => (
              <option key={m.id} value={String(m.id)}>{m.display_name}</option>
            ))}
          </select>
          <button className="btn btn-primary btn-sm" onClick={add} disabled={busy || !pickId}>
            {busy ? tr("Adding…") : tr("Add")}
          </button>
          <button className="btn btn-ghost btn-sm" onClick={()=>{setAdding(false);setPickId("");setError("");}}>{tr("Cancel")}</button>
        </div>
      ) : (
        <button className="btn btn-ghost" onClick={()=>setAdding(true)} disabled={eligible.length===0}>
          {tr("+ Add collaborator")}
        </button>
      )}
      {eligible.length === 0 && !adding && collaborators.length > 0 && (
        <p style={{ fontSize:11, color:"var(--text-muted)", marginTop:6 }}>
          {tr("Every project member is already the assignee or a collaborator.")}
        </p>
      )}
      {error && <div style={{ color:"#fca5a5", fontSize:13, marginTop:8 }}>{error}</div>}
    </div>
  );
}
