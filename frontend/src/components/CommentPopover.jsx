import { useState, useEffect, useLayoutEffect, useRef, useCallback } from "react";
import { createPortal } from "react-dom";
import { apiFetch, fmtDateTime, isRTL, renderCommentMarkdown } from "../App";
import { tr, trVal } from "../i18n";

/**
 * Comment thread in a popover, opened from a list-view row.
 *
 * Rendered through a portal into document.body with position:fixed. The status
 * groups in the list use overflow:hidden / overflow-x:auto, which clip an
 * absolutely positioned child — a portal escapes every ancestor's overflow, so
 * the panel always floats above the page.
 *
 * Loads lazily: nothing is fetched until opened, so a 50-row list costs no
 * extra requests.
 */
export default function CommentPopover({
  taskId, taskTitle, count = 0, members = [], canComment = true, onPosted,
}) {
  const [open,     setOpen]     = useState(false);
  const [comments, setComments] = useState([]);
  const [loading,  setLoading]  = useState(false);
  const [text,     setText]     = useState("");
  const [busy,     setBusy]     = useState(false);
  const [error,    setError]    = useState("");
  const [n,        setN]        = useState(count);
  const [pos,      setPos]      = useState({ top: 0, left: 0, above: false });

  const [mentionQuery, setMentionQuery] = useState(null);
  const [mentionPos,   setMentionPos]   = useState(0);

  const btnRef = useRef(null);
  const boxRef = useRef(null);
  const taRef  = useRef(null);
  // Where the cursor should land after the *next* time `text` actually
  // changes and the textarea's DOM value catches up to it. A setTimeout(0)
  // right after setText() races React's re-render — the timeout can fire
  // before the textarea's value has updated, so setSelectionRange lands on
  // the OLD text and computes a garbage offset. useLayoutEffect below runs
  // synchronously right after the DOM actually reflects the new value,
  // which is the fix.
  const pendingCursor = useRef(null);   // { start, end } — end === start for a plain caret

  // Larger than the original 340x340 — multi-line list comments and the
  // formatting toolbar made the old size cramped, per direct feedback.
  const W = 460, H = 520;

  useEffect(() => setN(count), [count]);

  // Anchor the fixed panel to the button's viewport rect
  const place = useCallback(() => {
    const b = btnRef.current?.getBoundingClientRect();
    if (!b) return;
    const above = window.innerHeight - b.bottom < H && b.top > H;
    let left = b.right - W;
    left = Math.max(8, Math.min(left, window.innerWidth - W - 8));
    setPos({ top: above ? b.top - 6 : b.bottom + 6, left, above });
  }, []);

  useEffect(() => {
    if (!open) return;
    place();
    window.addEventListener("scroll", place, true);
    window.addEventListener("resize", place);
    return () => {
      window.removeEventListener("scroll", place, true);
      window.removeEventListener("resize", place);
    };
  }, [open, place]);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    apiFetch(`/tasks/${taskId}/comments`)
      .then(rows => { setComments(rows); setN(rows.length); })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, [open, taskId]);

  useEffect(() => {
    if (!open) return;
    const onDown = e => {
      // React flushes discrete events synchronously, so a handler that
      // unmounts its own element (picking a mention removes the dropdown)
      // leaves e.target detached by the time this listener runs. A detached
      // node is contained by nothing, which would look like an outside click.
      if (!e.target || !e.target.isConnected) return;
      if (boxRef.current?.contains(e.target)) return;
      if (btnRef.current?.contains(e.target)) return;
      setOpen(false);
    };
    const onKey = e => {
      if (e.key === "Escape") {
        if (mentionQuery !== null) setMentionQuery(null);
        else setOpen(false);
      }
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, mentionQuery]);

  useEffect(() => { if (open && canComment) taRef.current?.focus(); }, [open, canComment]);

  // Applies a cursor position requested by wrapSelection/insertNumberedList/
  // the list-continuation Enter handler, once `text` has actually been
  // committed to the textarea's DOM value — see pendingCursor above.
  useLayoutEffect(() => {
    if (pendingCursor.current == null || !taRef.current) return;
    const { start, end } = pendingCursor.current;
    pendingCursor.current = null;
    taRef.current.setSelectionRange(start, end);
  }, [text]);

  // ── @mention ───────────────────────────────────────────────────────────────
  const onTextChange = (e) => {
    const val = e.target.value;
    const cursor = e.target.selectionStart;
    setText(val);
    const before = val.slice(0, cursor);
    const m = before.match(/@([\w.]*)$/);
    if (m) { setMentionQuery(m[1].toLowerCase()); setMentionPos(before.lastIndexOf("@")); }
    else   { setMentionQuery(null); }
  };

  const insertMention = (username) => {
    const before = text.slice(0, mentionPos);
    const after  = text.slice(taRef.current.selectionStart);
    setText(`${before}@${username} ${after}`);
    setMentionQuery(null);
    const p = mentionPos + username.length + 2;
    pendingCursor.current = { start: p, end: p };
    taRef.current?.focus();
  };

  // ── Formatting toolbar ────────────────────────────────────────────────────
  // Wraps the current selection in **bold**/*italic* markers, or prefixes
  // each selected line with "N. " for a numbered list — plain-text markup
  // stored in the comment body, rendered back by renderCommentMarkdown (see
  // App.jsx). Kept as textarea selection manipulation, the same approach
  // insertMention already uses above, rather than switching to a
  // contentEditable rich editor: that would require rebuilding the
  // @mention autocomplete's cursor tracking (selectionStart, string
  // slicing) against contentEditable's incompatible Range/Selection APIs.
  const wrapSelection = (marker) => {
    const ta = taRef.current;
    if (!ta) return;
    const start = ta.selectionStart, end = ta.selectionEnd;
    const selected = text.slice(start, end) || (marker === "**" ? "bold text" : "italic text");
    const next = text.slice(0, start) + marker + selected + marker + text.slice(end);
    setText(next);
    pendingCursor.current = { start: start + marker.length, end: start + marker.length + selected.length };
    ta.focus();
  };

  const insertNumberedList = () => {
    const ta = taRef.current;
    if (!ta) return;
    const start = ta.selectionStart, end = ta.selectionEnd;
    const selected = text.slice(start, end);
    // Marker lines need to start at their own line — pad with a newline
    // when the cursor sits mid-line rather than at a line start.
    const needsLeadingBreak = start > 0 && text[start - 1] !== "\n";
    const lead = needsLeadingBreak ? "\n" : "";

    if (!selected) {
      // No selection: insert just "1. " and put the cursor right after it
      // — not filler text the person has to notice and delete. Ctrl+Enter
      // still sends normally; plain Enter is handled below to continue
      // the list with "2. ", "3. ", etc.
      const insertion = `${lead}1. `;
      const next = text.slice(0, start) + insertion + text.slice(end);
      setText(next);
      const p = start + insertion.length;
      pendingCursor.current = { start: p, end: p };
      ta.focus();
      return;
    }

    const lines = selected.split("\n");
    const numbered = lines.map((l, i) => `${i + 1}. ${l}`).join("\n");
    const insertion = lead + numbered;
    const next = text.slice(0, start) + insertion + text.slice(end);
    setText(next);
    const p = start + insertion.length;
    pendingCursor.current = { start: p, end: p };
    ta.focus();
  };

  // Synthetic entry for @all — same shape as a real member so it drops
  // into the existing dropdown/insert logic with no special-case markup.
  // Filtered and ranked alongside real members rather than always pinned
  // first, so typing e.g. "am" still finds "Amit" without "all" crowding it.
  const ALL_ENTRY = { id: "all", username: "all", display_name: tr("Everyone (@all)") };

  const matches = mentionQuery !== null
    ? [ALL_ENTRY, ...members].filter(m =>
        (m.username || "").toLowerCase().includes(mentionQuery) ||
        (m.display_name || "").toLowerCase().includes(mentionQuery)
      ).slice(0, 6)
    : [];

  // @username in stored comment text is shown as the person's display name,
  // not the raw account name — the username is only what gets typed and
  // stored; the reader should see who it actually refers to.
  const renderBody = (body, _lineKey) => {
    const byUsername = new Map(members.map(m => [m.username, m]));
    // Non-mention chunks MUST stay plain strings, not <span>-wrapped —
    // renderCommentMarkdown (App.jsx) checks `typeof chunk === "string"` to
    // decide whether to run **bold**/*italic* parsing on a chunk. Wrapping
    // every chunk here (the previous behaviour) made that check always
    // false, so markdown silently never applied to anything that had gone
    // through mention rendering — which is all comment text, always.
    return String(body).split(/(@[\w.]+)/g).map((part, i) => {
      if (!part.startsWith("@")) return part;
      const uname = part.slice(1);
      const isAll = uname === "all";
      const m = byUsername.get(uname);
      const known = isAll || m;
      return (
        <span key={i} style={{
          background: known ? "rgba(139,92,246,0.15)" : "var(--bg-surface)",
          color: known ? "#a78bfa" : "var(--text-muted)",
          borderRadius:4, padding:"0 4px", fontWeight:600,
        }} title={part}>{isAll ? tr("@all") : m ? `@${m.display_name}` : part}</span>
      );
    });
  };

  const post = async () => {
    const body = text.trim();
    if (!body) return;
    setBusy(true); setError("");
    try {
      await apiFetch(`/tasks/${taskId}/comments`, {
        method: "POST",
        body: JSON.stringify({ body }),
      });
      setText(""); setMentionQuery(null);
      const rows = await apiFetch(`/tasks/${taskId}/comments`);
      setComments(rows);
      setN(rows.length);
      onPosted?.(taskId, rows.length);
    } catch (e) {
      setError(e.message || tr("Could not post comment"));
    } finally {
      setBusy(false);
    }
  };

  const stop = e => e.stopPropagation();

  const panel = (
    <div
      ref={boxRef}
      onClick={stop}
      onMouseDown={stop}
      onMouseUp={stop}
      style={{
        position:"fixed", top:pos.top, left:pos.left, zIndex:1000,
        width:W, maxHeight:H,
        transform: pos.above ? "translateY(-100%)" : "none",
        display:"flex", flexDirection:"column",
        background:"var(--bg-surface)", border:"1px solid var(--border-soft)",
        borderRadius:10, boxShadow:"0 12px 32px rgba(0,0,0,0.4)",
        cursor:"default",
      }}
    >
      <div style={{
        padding:"9px 12px", borderBottom:"1px solid var(--border)",
        display:"flex", alignItems:"center", gap:8,
        background:"var(--bg-elevated)", borderRadius:"10px 10px 0 0",
      }}>
        <span style={{ fontSize:12, fontWeight:700, color:"var(--text-primary)",
                       overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>
          {taskTitle}
        </span>
        <button onClick={()=>setOpen(false)}
          style={{ marginInlineStart:"auto", background:"none", border:"none",
                   color:"var(--text-muted)", cursor:"pointer", fontSize:15, lineHeight:1 }}>×</button>
      </div>

      <div style={{ flex:1, overflowY:"auto", padding:"12px 14px",
                    display:"flex", flexDirection:"column", gap:11, minHeight:120 }}>
        {loading && <div style={{ fontSize:12, color:"var(--text-muted)" }}>{tr("Loading…")}</div>}
        {!loading && comments.length === 0 && (
          <div style={{ fontSize:12, color:"var(--text-muted)", textAlign:"center", padding:"10px 0" }}>
            {tr("No comments yet")}
          </div>
        )}
        {comments.map(c => (
          <div key={c.id} style={{ background:"var(--bg-elevated)", borderRadius:7, padding:"7px 9px" }}>
            <div style={{ display:"flex", alignItems:"center", gap:7, marginBottom:5 }}>
              <div style={{
                width:22, height:22, borderRadius:"50%", flexShrink:0,
                background:`hsl(${(c.user_id*67)%360},50%,38%)`, color:"#fff",
                fontSize:10, fontWeight:700,
                display:"flex", alignItems:"center", justifyContent:"center",
              }}>{(c.display_name||"?")[0]}</div>
              <span style={{ fontSize:12, fontWeight:600, color:"var(--text-primary)" }}>{c.display_name}</span>
              <span style={{ fontSize:11, color:"var(--text-muted)", marginInlineStart:"auto" }}>
                {fmtDateTime(c.created_at)}
              </span>
            </div>
            <div style={{ fontSize:13, lineHeight:1.5, color:"var(--text-secondary)",
                          whiteSpace:"pre-wrap", wordBreak:"break-word",
                          direction: isRTL(c.body) ? "rtl" : "ltr",
                          textAlign: isRTL(c.body) ? "right" : "left" }}>
              {renderCommentMarkdown(c.body, renderBody)}
            </div>
          </div>
        ))}
      </div>

      {canComment && (
        <div style={{ borderTop:"1px solid var(--border)", padding:"8px 10px",
                      display:"flex", flexDirection:"column", gap:6, position:"relative" }}>
          {error && <div style={{ fontSize:11, color:"var(--red)" }}>{error}</div>}

          {mentionQuery !== null && matches.length > 0 && (
            <div style={{
              position:"absolute", bottom:"calc(100% - 4px)", left:10, right:10,
              background:"var(--bg-elevated)", border:"1px solid var(--border-soft)",
              borderRadius:8, boxShadow:"0 6px 20px rgba(0,0,0,0.35)",
              zIndex:1100, maxHeight:170, overflowY:"auto",
            }}>
              <div style={{ padding:"5px 10px", fontSize:9, fontWeight:700,
                            color:"var(--text-muted)", textTransform:"uppercase", letterSpacing:"0.5px" }}>
                {tr("Mention a member")}
              </div>
              {matches.map(m => (
                <div key={m.id}
                  onMouseDown={e => { e.preventDefault(); e.stopPropagation(); insertMention(m.username); }}
                  style={{ display:"flex", alignItems:"center", gap:7, padding:"6px 10px",
                           cursor:"pointer", borderTop:"1px solid var(--border)" }}
                  onMouseEnter={e=>e.currentTarget.style.background="var(--bg-hover)"}
                  onMouseLeave={e=>e.currentTarget.style.background="transparent"}
                >
                  <div style={{
                    width:20, height:20, borderRadius:"50%", flexShrink:0,
                    // "all" is a string id, not a number — hsl(NaN...) is
                    // invalid CSS and silently renders with no background,
                    // so it gets a fixed color instead of the per-user hash.
                    background: m.id === "all" ? "var(--accent)" : `hsl(${(m.id*67)%360},50%,38%)`,
                    color:"#fff", fontSize: m.id === "all" ? 11 : 9, fontWeight:700,
                    display:"flex", alignItems:"center", justifyContent:"center",
                  }}>{m.id === "all" ? "@" : (m.display_name||"?")[0]}</div>
                  <div style={{ minWidth:0 }}>
                    <div style={{ fontSize:12, fontWeight:500, color:"var(--text-primary)" }}>{m.display_name}</div>
                    {m.id !== "all" && <div style={{ fontSize:10, color:"var(--text-muted)" }}>@{m.username}</div>}
                  </div>
                </div>
              ))}
            </div>
          )}

          <div style={{ display:"flex", gap:4 }}>
            <button type="button" title={tr("Bold")} onMouseDown={e=>{e.preventDefault(); wrapSelection("**");}}
              style={{ width:24, height:24, display:"flex", alignItems:"center", justifyContent:"center",
                       borderRadius:5, cursor:"pointer", fontSize:12, fontWeight:700,
                       border:"1px solid var(--border-soft)", background:"var(--bg-elevated)", color:"var(--text-secondary)" }}>
              B
            </button>
            <button type="button" title={tr("Italic")} onMouseDown={e=>{e.preventDefault(); wrapSelection("*");}}
              style={{ width:24, height:24, display:"flex", alignItems:"center", justifyContent:"center",
                       borderRadius:5, cursor:"pointer", fontSize:12, fontStyle:"italic",
                       border:"1px solid var(--border-soft)", background:"var(--bg-elevated)", color:"var(--text-secondary)" }}>
              I
            </button>
            <button type="button" title={tr("Numbered list")} onMouseDown={e=>{e.preventDefault(); insertNumberedList();}}
              style={{ width:24, height:24, display:"flex", alignItems:"center", justifyContent:"center",
                       borderRadius:5, cursor:"pointer", fontSize:11,
                       border:"1px solid var(--border-soft)", background:"var(--bg-elevated)", color:"var(--text-secondary)" }}>
              1.
            </button>
          </div>
          <textarea
            ref={taRef}
            className="input"
            rows={2}
            placeholder={tr("Write a comment…  type @ to mention  (Ctrl+Enter sends)")}
            value={text}
            onChange={onTextChange}
            onKeyDown={e => {
              e.stopPropagation();
              if (mentionQuery !== null && e.key === "Enter" && matches.length) {
                e.preventDefault(); insertMention(matches[0].username); return;
              }
              if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); post(); return; }

              // Plain Enter inside a "N. " list continues it with "N+1. " —
              // a textarea has no built-in concept of list mode, so without
              // this Enter just adds a blank line and the numbering stops
              // dead after the first item.
              if (e.key === "Enter") {
                const ta = e.target;
                const pos = ta.selectionStart;
                const lineStart = text.lastIndexOf("\n", pos - 1) + 1;
                const currentLine = text.slice(lineStart, pos);
                const m = currentLine.match(/^(\d+)\.\s/);
                if (m) {
                  e.preventDefault();
                  // Enter on an empty "N. " line ends the list instead of
                  // continuing it forever — matches how list editors
                  // elsewhere (Word, Google Docs, etc.) behave.
                  if (currentLine.trim() === `${m[1]}.`) {
                    const next = text.slice(0, lineStart) + text.slice(pos);
                    setText(next);
                    pendingCursor.current = { start: lineStart, end: lineStart };
                    return;
                  }
                  const nextNum = parseInt(m[1], 10) + 1;
                  const insertion = `\n${nextNum}. `;
                  const next = text.slice(0, pos) + insertion + text.slice(pos);
                  setText(next);
                  const p = pos + insertion.length;
                  pendingCursor.current = { start: p, end: p };
                  ta.focus();
                }
              }
            }}
            style={{
              fontSize:12, resize:"vertical",
              direction: isRTL(text) ? "rtl" : "ltr",
              textAlign: isRTL(text) ? "right" : "left",
            }}
          />
          <div style={{ display:"flex", alignItems:"center", gap:8 }}>
            <span style={{ fontSize:10, color:"var(--text-muted)" }}>{tr("@ to mention")}</span>
            <button className="btn btn-primary btn-sm"
              style={{ marginInlineStart:"auto", fontSize:12 }}
              onClick={post} disabled={busy || !text.trim()}>
              {busy ? tr("Sending…") : tr("Send")}
            </button>
          </div>
        </div>
      )}
    </div>
  );

  return (
    <div style={{ display:"flex", justifyContent:"center" }} onClick={stop}>
      <button
        ref={btnRef}
        onClick={e => { e.stopPropagation(); setOpen(o=>!o); }}
        title={n ? `${n} comment${n===1?"":"s"}` : tr("Add a comment")}
        style={{
          display:"inline-flex", alignItems:"center", gap:4,
          background: open ? "var(--bg-elevated)" : "transparent",
          border:"1px solid", borderColor: open ? "var(--border-soft)" : "transparent",
          borderRadius:6, padding:"2px 7px", cursor:"pointer",
          fontSize:12, color: n ? "var(--accent)" : "var(--text-muted)",
          transition:"background 0.12s",
        }}
        onMouseEnter={e=>{ e.currentTarget.style.background="var(--bg-elevated)"; }}
        onMouseLeave={e=>{ if(!open) e.currentTarget.style.background="transparent"; }}
      >
        💬{n > 0 && <span style={{ fontWeight:600 }}>{n}</span>}
      </button>

      {open && createPortal(panel, document.body)}
    </div>
  );
}
