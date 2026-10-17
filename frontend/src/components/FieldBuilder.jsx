import { useState } from "react";

const TYPE_ICONS = { text:"T", number:"#", date:"📅", list:"☰" };
const TYPE_LABELS = { text:"Text", number:"Number", date:"Date", list:"List" };

// ── Single field definition row ───────────────────────────────────────────────
function FieldRow({ field, onChange, onDelete, index, onMoveUp, onMoveDown, isFirst, isLast }) {
  const [optionsText, setOptionsText] = useState(
    field.options ? JSON.parse(field.options).join(", ") : ""
  );

  const updateOptions = (raw) => {
    setOptionsText(raw);
    const arr = raw.split(",").map(s => s.trim()).filter(Boolean);
    onChange(index, "options", JSON.stringify(arr));
  };

  return (
    <div style={{
      background: "var(--bg-elevated)", borderRadius: 8,
      border: "1px solid var(--border-soft)", padding: "12px 14px",
      display: "flex", flexDirection: "column", gap: 10,
    }}>
      {/* Top row: label + type + move + delete */}
      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        {/* Reorder */}
        <div style={{ display: "flex", flexDirection: "column", gap: 2, flexShrink: 0 }}>
          <button onClick={() => onMoveUp(index)} disabled={isFirst}
            style={{ background:"none", border:"none", color: isFirst?"var(--border-soft)":"var(--text-muted)", cursor: isFirst?"default":"pointer", fontSize:11, lineHeight:1, padding:"1px 3px" }}>▲</button>
          <button onClick={() => onMoveDown(index)} disabled={isLast}
            style={{ background:"none", border:"none", color: isLast?"var(--border-soft)":"var(--text-muted)", cursor: isLast?"default":"pointer", fontSize:11, lineHeight:1, padding:"1px 3px" }}>▼</button>
        </div>

        {/* Type badge */}
        <div style={{
          width: 28, height: 28, borderRadius: 6, flexShrink: 0,
          background: "var(--accent-soft)", color: "var(--accent)",
          fontSize: 12, fontWeight: 700,
          display: "flex", alignItems: "center", justifyContent: "center",
        }}>{TYPE_ICONS[field.field_type]}</div>

        {/* Label */}
        <input className="input" placeholder="Field label…" value={field.label}
          onChange={e => onChange(index, "label", e.target.value)}
          style={{ flex: 1, fontSize: 13 }} />

        {/* Type selector */}
        <select className="select" value={field.field_type}
          onChange={e => onChange(index, "field_type", e.target.value)}
          style={{ fontSize: 12, flexShrink: 0 }}>
          {Object.entries(TYPE_LABELS).map(([v, l]) => (
            <option key={v} value={v}>{l}</option>
          ))}
        </select>

        {/* Delete */}
        <button onClick={() => onDelete(index)}
          style={{ background:"none", border:"none", color:"var(--text-muted)", cursor:"pointer", fontSize:18, lineHeight:1, padding:"0 2px", flexShrink:0 }}>×</button>
      </div>

      {/* List options */}
      {field.field_type === "list" && (
        <div className="form-group" style={{ marginLeft: 36 }}>
          <label className="form-label">Options (comma-separated)</label>
          <input className="input" placeholder="e.g. Low, Medium, High, Critical"
            value={optionsText} onChange={e => updateOptions(e.target.value)}
            style={{ fontSize: 13 }} />
          {optionsText && (
            <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginTop: 6 }}>
              {optionsText.split(",").map(s => s.trim()).filter(Boolean).map((opt, i) => (
                <span key={i} style={{
                  fontSize: 11, padding: "2px 8px", borderRadius: 99,
                  background: "var(--accent-soft)", color: "var(--accent)", fontWeight: 500,
                }}>{opt}</span>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Filterable toggle — controls whether this field appears as a filter
          in the list view and the analytics dashboard. */}
      <label style={{
        display:"flex", alignItems:"center", gap:8, marginLeft:36,
        fontSize:12, color:"var(--text-secondary)", cursor:"pointer", userSelect:"none",
      }}>
        <input type="checkbox"
          checked={field.filterable == null ? true : !!field.filterable}
          onChange={e => onChange(index, "filterable", e.target.checked ? 1 : 0)}
          style={{ cursor:"pointer" }} />
        Show as a filter (task list &amp; analytics)
      </label>
    </div>
  );
}

// ── Main FieldBuilder component ───────────────────────────────────────────────
// Props:
//   fields: array of field definition objects
//   onChange: (fields) => void  — called whenever fields change
export default function FieldBuilder({ fields, onChange }) {

  const update = (index, key, value) => {
    const next = fields.map((f, i) => i === index ? { ...f, [key]: value } : f);
    onChange(next);
  };

  const add = () => {
    onChange([...fields, {
      label: "", field_type: "text", options: null,
      required: 0, position: fields.length, filterable: 1,
    }]);
  };

  const remove = (index) => {
    onChange(fields.filter((_, i) => i !== index));
  };

  const moveUp = (index) => {
    if (index === 0) return;
    const next = [...fields];
    [next[index-1], next[index]] = [next[index], next[index-1]];
    onChange(next);
  };

  const moveDown = (index) => {
    if (index === fields.length - 1) return;
    const next = [...fields];
    [next[index], next[index+1]] = [next[index+1], next[index]];
    onChange(next);
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {fields.length === 0 && (
        <div style={{ fontSize: 13, color: "var(--text-muted)", textAlign: "center", padding: "12px 0" }}>
          No custom fields yet. Standard fields (status, priority, assignee, etc.) are always included.
        </div>
      )}
      {fields.map((f, i) => (
        <FieldRow key={i} field={f} index={i}
          onChange={update} onDelete={remove}
          onMoveUp={moveUp} onMoveDown={moveDown}
          isFirst={i === 0} isLast={i === fields.length - 1} />
      ))}
      <button className="btn btn-ghost" onClick={add}
        style={{ alignSelf: "flex-start", gap: 6, marginTop: 4, fontSize: 13 }}>
        + Add Field
      </button>
    </div>
  );
}
