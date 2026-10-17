import { useState, useRef, useEffect } from "react";

/**
 * Inline-editable cell used by the list view.
 *
 * Behaviour:
 *  - text/number : click -> input. Enter commits, Escape reverts, blur commits.
 *  - select/date : click -> control. Change commits immediately.
 *  - Optimistic:  the new value shows at once; on failure it reverts and the
 *                 server's reason is shown as a tooltip + red flash. This
 *                 matters because a status change can legitimately be refused
 *                 ("2 subtasks still open"), and a silent revert looks broken.
 *  - readOnly    : renders as plain text, no affordance.
 *
 * onSave(value) must return a promise; rejecting reverts the cell.
 */
export default function InlineEdit({
  value,
  onSave,
  type = "text",          // text | number | select | date
  options = [],           // [{value,label,color}] for type="select"
  readOnly = false,
  placeholder = "—",
  render,                 // optional custom display renderer
  align = "left",
  title,
  rtl = false,            // flips text direction for the input AND display
}) {
  const [editing, setEditing] = useState(false);
  const [draft,   setDraft]   = useState(value ?? "");
  const [busy,    setBusy]    = useState(false);
  const [error,   setError]   = useState("");
  const ref = useRef(null);

  // Keep the draft in step when the row is refreshed from the server
  useEffect(() => { if (!editing) setDraft(value ?? ""); }, [value, editing]);

  useEffect(() => {
    if (!editing || !ref.current) return;
    ref.current.focus();
    if (ref.current.select) ref.current.select();
  }, [editing]);

  const commit = async (raw) => {
    const next = raw === "" ? null : raw;
    setEditing(false);
    if (next === (value ?? null)) return;      // nothing changed

    setBusy(true); setError("");
    try {
      await onSave(next);
    } catch (e) {
      setDraft(value ?? "");                   // revert
      setError(e?.message || "Update failed");
      setTimeout(() => setError(""), 4000);
    } finally {
      setBusy(false);
    }
  };

  const cancel = () => { setDraft(value ?? ""); setEditing(false); };

  // ── Read-only ──────────────────────────────────────────────────────────────
  if (readOnly) {
    return (
      <div style={{ fontSize:12, color:"var(--text-secondary)", textAlign: rtl ? "right" : align,
                    direction: rtl ? "rtl" : "ltr",
                    overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>
        {render ? render(value) : (value || placeholder)}
      </div>
    );
  }

  // ── Editing ────────────────────────────────────────────────────────────────
  if (editing) {
    const stop = e => e.stopPropagation();

    if (type === "select") {
      return (
        <select
          ref={ref}
          className="select"
          value={draft ?? ""}
          onClick={stop}
          onChange={e => commit(e.target.value)}
          onBlur={cancel}
          style={{ fontSize:12, padding:"2px 6px", width:"100%" }}
        >
          <option value="">{placeholder}</option>
          {options.map(o => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
      );
    }

    if (type === "date") {
      return (
        <input
          ref={ref}
          type="date"
          className="input"
          value={draft ?? ""}
          onClick={stop}
          onChange={e => commit(e.target.value)}
          onBlur={cancel}
          style={{ fontSize:12, padding:"2px 6px", width:"100%" }}
        />
      );
    }

    return (
      <input
        ref={ref}
        type={type === "number" ? "number" : "text"}
        className="input"
        value={draft ?? ""}
        onClick={stop}
        onChange={e => setDraft(e.target.value)}
        onBlur={() => commit(draft)}
        onKeyDown={e => {
          e.stopPropagation();
          if (e.key === "Enter")  { e.preventDefault(); commit(draft); }
          if (e.key === "Escape") { e.preventDefault(); cancel(); }
        }}
        style={{ fontSize:12, padding:"2px 6px", width:"100%",
                 direction: rtl ? "rtl" : "ltr", textAlign: rtl ? "right" : "left" }}
      />
    );
  }

  // ── Display ────────────────────────────────────────────────────────────────
  return (
    <div
      onClick={e => { e.stopPropagation(); setEditing(true); }}
      title={error || title || "Click to edit"}
      style={{
        fontSize:12, textAlign:align, cursor:"text",
        padding:"2px 4px", margin:"-2px -4px", borderRadius:4,
        overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap",
        color: error ? "var(--red)" : "var(--text-secondary)",
        background: error ? "rgba(239,68,68,0.12)" : "transparent",
        opacity: busy ? 0.5 : 1,
        transition: "background 0.12s",
        border: "1px solid transparent",
      }}
      onMouseEnter={e => { if (!error) {
        e.currentTarget.style.background = "var(--bg-elevated)";
        e.currentTarget.style.borderColor = "var(--border-soft)";
      }}}
      onMouseLeave={e => { if (!error) {
        e.currentTarget.style.background = "transparent";
        e.currentTarget.style.borderColor = "transparent";
      }}}
    >
      <div style={{ direction: rtl ? "rtl" : "ltr", textAlign: rtl ? "right" : "inherit" }}>
        {render ? render(value) : (value || <span style={{ color:"var(--text-muted)" }}>{placeholder}</span>)}
      </div>
    </div>
  );
}
