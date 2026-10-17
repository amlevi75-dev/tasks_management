import { useRef, useEffect, useCallback } from "react";
import { isRTL } from "../App";
import { tr, trVal } from "../i18n";

/**
 * Minimal rich-text editor for the task description field.
 *
 * Deliberately not a full editor library (TipTap/Slate/Quill) — the ask is
 * three formatting options (bold, italic, numbered list), and a library for
 * that is a heavy dependency for very little gain. Uses contentEditable +
 * document.execCommand, which is broadly supported for exactly this small
 * set of commands (bold/italic/insertOrderedList) across the evergreen
 * browsers this app targets, and stores/reads plain HTML — the same
 * approach used nowhere else in this codebase, so `description` moves from
 * plain text to a small HTML subset. Existing plain-text descriptions still
 * render fine, since plain text is valid (trivial) HTML.
 *
 * RTL follows the same per-field detection already used for comments and
 * plain descriptions elsewhere (isRTL from App.jsx) — checked on every
 * input event so typing Hebrew/Arabic flips direction immediately, same as
 * the textarea it replaces.
 */
export default function RichTextEditor({ value, onChange, placeholder, readOnly = false }) {
  const ref = useRef(null);
  const lastValue = useRef(value);

  // Only overwrite the DOM when the value changed from *outside* (e.g. task
  // switched) — otherwise every keystroke's onChange would immediately
  // stomp the cursor position by resetting innerHTML under it.
  useEffect(() => {
    if (ref.current && value !== lastValue.current && document.activeElement !== ref.current) {
      ref.current.innerHTML = value || "";
      lastValue.current = value;
    }
  }, [value]);

  const emit = useCallback(() => {
    if (!ref.current) return;
    const html = ref.current.innerHTML;
    lastValue.current = html;
    onChange(html === "<br>" ? "" : html);
  }, [onChange]);

  const exec = (command) => (e) => {
    e.preventDefault();   // keep focus/selection in the editor
    document.execCommand(command, false, null);
    ref.current?.focus();
    emit();
  };

  const rtl = isRTL(ref.current?.innerText || value || "");

  const btnStyle = (active) => ({
    width: 26, height: 26, display: "flex", alignItems: "center", justifyContent: "center",
    borderRadius: 5, cursor: "pointer", fontSize: 13, border: "1px solid var(--border-soft)",
    background: active ? "var(--accent)" : "var(--bg-elevated)",
    color: active ? "#fff" : "var(--text-secondary)",
  });

  if (readOnly) {
    return (
      <div
        style={{
          fontSize: 13, color: "var(--text-secondary)", lineHeight: 1.5,
          direction: rtl ? "rtl" : "ltr", textAlign: rtl ? "right" : "left",
        }}
        dangerouslySetInnerHTML={{ __html: value || `<span style="color:var(--text-muted)">${placeholder || ""}</span>` }}
      />
    );
  }

  return (
    <div>
      <div style={{ display: "flex", gap: 4, marginBottom: 6 }}>
        <button type="button" title={tr("Bold (Ctrl+B)")} onMouseDown={exec("bold")} style={btnStyle(false)}>
          <strong>B</strong>
        </button>
        <button type="button" title={tr("Italic (Ctrl+I)")} onMouseDown={exec("italic")} style={btnStyle(false)}>
          <em>I</em>
        </button>
        <button type="button" title={tr("Numbered list")} onMouseDown={exec("insertOrderedList")} style={btnStyle(false)}>
          1.
        </button>
      </div>
      <div
        ref={ref}
        contentEditable
        suppressContentEditableWarning
        onInput={emit}
        onBlur={emit}
        data-placeholder={placeholder}
        className="input richtext-editor"
        style={{
          minHeight: 72, padding: "9px 12px", fontSize: 13, lineHeight: 1.5,
          direction: rtl ? "rtl" : "ltr", textAlign: rtl ? "right" : "left",
          whiteSpace: "pre-wrap", wordBreak: "break-word",
        }}
      />
    </div>
  );
}
