import { useState, useEffect, useRef } from "react";
import { apiFetch } from "../App";

const TYPE_ICONS = { text:"T", number:"#", date:"📅", list:"☰" };

export default function CustomFieldValues({ taskId, projectId, isViewer = false, pendingTaskRef = null }) {
  const [fields, setFields] = useState([]);
  const [saving, setSaving] = useState({});
  const timers = useRef({});

  useEffect(() => {
    if (!projectId) return;

    if (taskId) {
      // Edit mode — fetch field definitions + saved values for this task
      apiFetch(`/tasks/${taskId}/field-values`)
        .then(rows => setFields(rows.map(f => ({
          ...f,
          // Normalise: API returns field_id in this endpoint
          field_id: f.field_id ?? f.id,
          value: f.value ?? null,
        }))))
        .catch(() => {});
    } else {
      // Create mode — fetch definitions only, no values yet
      apiFetch(`/projects/${projectId}/fields`)
        .then(rows => setFields(rows.map(f => ({
          ...f,
          // Normalise: /fields returns id not field_id
          field_id: f.field_id ?? f.id,
          value: null,
        }))))
        .catch(() => {});
    }
  }, [taskId, projectId]);

  if (fields.length === 0) return null;

  const saveValue = async (fieldId, value) => {
    if (!taskId) {
      if (pendingTaskRef) {
        if (value) pendingTaskRef.current[fieldId] = value;
        else delete pendingTaskRef.current[fieldId];
      }
      return;
    }
    setSaving(s => ({ ...s, [fieldId]: true }));
    try {
      await apiFetch(`/tasks/${taskId}/field-values`, {
        method: "POST",
        body: JSON.stringify({ field_id: fieldId, value: value || null }),
      });
    } catch { /* silent */ }
    finally { setSaving(s => ({ ...s, [fieldId]: false })); }
  };

  const debouncedSave = (fieldId, value) => {
    clearTimeout(timers.current[fieldId]);
    timers.current[fieldId] = setTimeout(() => saveValue(fieldId, value), 700);
  };

  const updateLocal = (fieldId, value) => {
    setFields(prev => prev.map(f => f.field_id === fieldId ? { ...f, value } : f));
  };

  const onChange = (fieldId, value, immediate = false) => {
    updateLocal(fieldId, value);
    if (immediate) {
      clearTimeout(timers.current[fieldId]);
      saveValue(fieldId, value);
    } else {
      debouncedSave(fieldId, value);
    }
  };

  return (
    <div style={{ borderTop:"1px solid var(--border)", paddingTop:14, marginTop:4 }}>
      <div className="form-label" style={{ marginBottom:12 }}>Custom Fields</div>
      <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:12 }}>
        {fields.map(f => {
          // Safely parse options — always scoped to this field
          let opts = [];
          try { opts = f.options ? JSON.parse(f.options) : []; } catch { opts = []; }
          const isSaving = saving[f.field_id];

          return (
            <div key={f.field_id} className="form-group">
              <label className="form-label" style={{ display:"flex", alignItems:"center", gap:4 }}>
                <span style={{ fontSize:10, opacity:0.7 }}>{TYPE_ICONS[f.field_type]}</span>
                {f.label}
                {f.required ? <span style={{ color:"var(--red)", fontSize:10 }}>*</span> : null}
                {isSaving && <span style={{ fontSize:10, color:"var(--accent)", marginLeft:"auto" }}>saving…</span>}
              </label>

              {f.field_type === "list" ? (
                <select className="select" style={{ width:"100%", fontSize:13 }}
                  value={f.value ?? ""}
                  disabled={isViewer}
                  onChange={e => onChange(f.field_id, e.target.value, true)}>
                  <option value="">— Select —</option>
                  {opts.map(o => (
                    // Key scoped to field_id + option to prevent cross-field bleeding
                    <option key={`${f.field_id}-${o}`} value={o}>{o}</option>
                  ))}
                </select>
              ) : f.field_type === "date" ? (
                <input type="date" className="input"
                  value={f.value ?? ""}
                  disabled={isViewer}
                  onChange={e => onChange(f.field_id, e.target.value, true)} />
              ) : f.field_type === "number" ? (
                <input type="number" className="input"
                  style={{ fontSize:13 }}
                  placeholder="0"
                  value={f.value ?? ""}
                  disabled={isViewer}
                  onChange={e => onChange(f.field_id, e.target.value)} />
              ) : (
                <input type="text" className="input"
                  style={{ fontSize:13 }}
                  placeholder="Enter value…"
                  value={f.value ?? ""}
                  disabled={isViewer}
                  onChange={e => onChange(f.field_id, e.target.value)} />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
