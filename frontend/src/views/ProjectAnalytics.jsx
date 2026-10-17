import { useState, useEffect } from "react";
import { apiFetch, fmtDate } from "../App";

// ── Colors ────────────────────────────────────────────────────────────────────
const S_COLOR = { new:"#64748b", open:"#3b82f6", in_progress:"#f59e0b", done:"#10b981" };
const S_LABEL = { new:"New", open:"Open", in_progress:"In Progress", done:"Done" };
const P_COLOR = { low:"#10b981", medium:"#3b82f6", high:"#f59e0b", critical:"#ef4444" };
const P_LABEL = { low:"Low", medium:"Medium", high:"High", critical:"Critical" };

// ── SVG Donut Pie ─────────────────────────────────────────────────────────────
function PieChart({ data, size=180 }) {
  const total = data.reduce((s,d)=>s+d.value, 0);
  if (!total) return <div style={{width:size,height:size,display:"flex",alignItems:"center",justifyContent:"center",color:"var(--text-muted)",fontSize:12}}>No data</div>;
  const r=size/2-8, cx=size/2, cy=size/2;
  let angle=-Math.PI/2;
  const slices=[];
  data.forEach(d=>{
    if(!d.value) return;
    const a=(d.value/total)*2*Math.PI;
    const x1=cx+r*Math.cos(angle), y1=cy+r*Math.sin(angle);
    const x2=cx+r*Math.cos(angle+a), y2=cy+r*Math.sin(angle+a);
    slices.push({path:`M${cx} ${cy} L${x1} ${y1} A${r} ${r} 0 ${a>Math.PI?1:0} 1 ${x2} ${y2} Z`,color:d.color,label:d.label,value:d.value,pct:Math.round(d.value/total*100)});
    angle+=a;
  });
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      {slices.map((s,i)=><path key={i} d={s.path} fill={s.color} opacity="0.88" stroke="var(--bg-surface)" strokeWidth="2"><title>{s.label}: {s.value} ({s.pct}%)</title></path>)}
      <circle cx={cx} cy={cy} r={r*0.45} fill="var(--bg-surface)"/>
      <text x={cx} y={cy-6} textAnchor="middle" fontSize="18" fontWeight="700" fill="var(--text-primary)">{total}</text>
      <text x={cx} y={cy+12} textAnchor="middle" fontSize="10" fill="var(--text-muted)">tasks</text>
    </svg>
  );
}

// ── Horizontal Bar ────────────────────────────────────────────────────────────
function BarChart({ data, h=24 }) {
  const max=Math.max(...data.map(d=>d.value),1);
  return (
    <div style={{display:"flex",flexDirection:"column",gap:8}}>
      {data.map((d,i)=>(
        <div key={i} style={{display:"flex",alignItems:"center",gap:10}}>
          <div style={{width:110,fontSize:12,color:"var(--text-secondary)",textAlign:"left",flexShrink:0,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}} title={d.label}>{d.label}</div>
          <div style={{flex:1,height:h,background:"var(--bg-elevated)",borderRadius:4,overflow:"hidden"}}>
            <div style={{height:"100%",width:`${(d.value/max)*100}%`,background:d.color||"var(--accent)",borderRadius:4,minWidth:d.value>0?4:0,transition:"width 0.5s"}}/>
          </div>
          <div style={{width:28,fontSize:12,fontWeight:700,color:"var(--text-secondary)",flexShrink:0,textAlign:"right"}}>{d.value}</div>
        </div>
      ))}
    </div>
  );
}

// ── Stacked Bar ───────────────────────────────────────────────────────────────
function StackedBar({ data }) {
  const max=Math.max(...data.map(d=>d.total),1);
  return (
    <div style={{display:"flex",flexDirection:"column",gap:8}}>
      {data.map((d,i)=>(
        <div key={i} style={{display:"flex",alignItems:"center",gap:10}}>
          <div style={{width:120,fontSize:12,color:"var(--text-secondary)",textAlign:"left",flexShrink:0,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}} title={d.assignee}>{d.assignee}</div>
          <div style={{flex:1,height:22,background:"var(--bg-elevated)",borderRadius:4,overflow:"hidden",display:"flex"}}>
            <div style={{width:`${(d.done/max)*100}%`,background:"#10b981",opacity:0.85}} title={`Done: ${d.done}`}/>
            <div style={{width:`${(d.open/max)*100}%`,background:"#3b82f6",opacity:0.75}} title={`Open: ${d.open}`}/>
          </div>
          <div style={{width:60,fontSize:11,color:"var(--text-muted)",flexShrink:0,textAlign:"right"}}>
            <span style={{color:"#10b981"}}>{d.done}</span>/<span style={{color:"#3b82f6"}}>{d.open}</span>
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Sparkline ─────────────────────────────────────────────────────────────────
function WeeklyChart({ data }) {
  if(!data.length) return <div style={{color:"var(--text-muted)",fontSize:13}}>No data</div>;
  const W=600,H=120,pad=32,maxV=Math.max(...data.map(d=>Math.max(d.created,d.completed)),1);
  const xStep=(W-pad*2)/Math.max(data.length-1,1);
  const pts=key=>data.map((d,i)=>[pad+i*xStep, H-pad-((d[key]/maxV)*(H-pad*2))]);
  const path=pts=>pts.map((p,i)=>`${i===0?"M":"L"} ${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(" ");
  const cr=pts("created"), cp=pts("completed");
  return (
    <svg width="100%" viewBox={`0 0 ${W} ${H}`} style={{overflow:"visible"}}>
      {[0,0.25,0.5,0.75,1].map((f,i)=><line key={i} x1={pad} x2={W-pad} y1={H-pad-f*(H-pad*2)} y2={H-pad-f*(H-pad*2)} stroke="var(--border)" strokeWidth="1"/>)}
      <path d={path(cr)} fill="none" stroke="#3b82f6" strokeWidth="2.5" strokeLinejoin="round"/>
      <path d={path(cp)} fill="none" stroke="#10b981" strokeWidth="2.5" strokeLinejoin="round"/>
      {cr.map((p,i)=><circle key={i} cx={p[0]} cy={p[1]} r="4" fill="#3b82f6" stroke="var(--bg-surface)" strokeWidth="2"><title>Created: {data[i].created}</title></circle>)}
      {cp.map((p,i)=><circle key={i} cx={p[0]} cy={p[1]} r="4" fill="#10b981" stroke="var(--bg-surface)" strokeWidth="2"><title>Done: {data[i].completed}</title></circle>)}
      {data.map((d,i)=><text key={i} x={pad+i*xStep} y={H-4} textAnchor="middle" fontSize="9" fill="var(--text-muted)">{d.week?.includes("W")?`W${d.week.split("W")[1]}`:d.week}</text>)}
    </svg>
  );
}

// ── Legend ────────────────────────────────────────────────────────────────────
function Legend({ items }) {
  return (
    <div style={{display:"flex",gap:10,flexWrap:"wrap",marginTop:10}}>
      {items.map((it,i)=>(
        <div key={i} style={{display:"flex",alignItems:"center",gap:5,fontSize:11,color:"var(--text-secondary)"}}>
          <div style={{width:10,height:10,borderRadius:2,background:it.color,opacity:0.88}}/>
          {it.label} ({it.value})
        </div>
      ))}
    </div>
  );
}

// ── KPI Card ──────────────────────────────────────────────────────────────────
function KPI({ label, value, color, sub }) {
  return (
    <div className="card" style={{textAlign:"center",padding:"16px 12px"}}>
      <div style={{fontSize:32,fontWeight:800,color:color||"var(--text-primary)",lineHeight:1}}>{value}</div>
      <div style={{fontSize:12,color:"var(--text-secondary)",marginTop:4,fontWeight:500}}>{label}</div>
      {sub && <div style={{fontSize:11,color:"var(--text-muted)",marginTop:2}}>{sub}</div>}
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────
export default function ProjectAnalytics({ projectId, navigate }) {
  const [data,       setData]       = useState(null);
  const [project,    setProject]    = useState(null);
  const [categories, setCategories] = useState([]);
  const [filterCat,  setFilterCat]  = useState("");
  const [fields,     setFields]     = useState([]);
  const [fieldFilters, setFieldFilters] = useState({});
  const [dateFrom,   setDateFrom]   = useState("");
  const [dateTo,     setDateTo]     = useState("");
  const [loading,    setLoading]    = useState(true);
  const [error,      setError]      = useState("");

  // Fetch categories once
  useEffect(() => {
    apiFetch(`/projects/${projectId}/categories`)
      .then(setCategories).catch(() => {});
    apiFetch(`/projects/${projectId}/fields`)
      .then(rows => setFields(rows.filter(f => f.filterable == null || f.filterable)))
      .catch(() => {});
  }, [projectId]);

  // Fetch analytics (re-runs when filterCat changes)
  useEffect(() => {
    setLoading(true); setError("");
    const params = new URLSearchParams();
    if (filterCat) params.set("category_id", filterCat);
    if (dateFrom)  params.set("date_from",   dateFrom);
    if (dateTo)    params.set("date_to",     dateTo);
    Object.entries(fieldFilters).forEach(([fid, v]) => {
      if (v) params.append("fv", `${fid}:${v}`);
    });
    const qs = params.toString() ? `?${params.toString()}` : "";
    Promise.all([
      apiFetch(`/projects/${projectId}`),
      apiFetch(`/projects/${projectId}/analytics${qs}`),
    ]).then(([p, a]) => { setProject(p); setData(a); setLoading(false); })
      .catch(e => { setError(e.message); setLoading(false); });
  }, [projectId, filterCat, dateFrom, dateTo, JSON.stringify(fieldFilters)]);

  // Presets set both ends of the range at once
  const applyPreset = (days) => {
    if (days === null) { setDateFrom(""); setDateTo(""); return; }
    const to   = new Date();
    const from = new Date(); from.setDate(from.getDate() - days);
    const iso  = d => d.toISOString().slice(0, 10);
    setDateFrom(iso(from)); setDateTo(iso(to));
  };
  const activePreset = (days) => {
    if (days === null) return !dateFrom && !dateTo;
    if (!dateFrom || !dateTo) return false;
    const to   = new Date();
    const from = new Date(); from.setDate(from.getDate() - days);
    const iso  = d => d.toISOString().slice(0, 10);
    return dateFrom === iso(from) && dateTo === iso(to);
  };


  return (
    <div data-build="ANALYTICS-V16" style={{ padding:24, maxWidth:1100, margin:"0 auto" }}>

      {/* Breadcrumb */}
      <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:20, fontSize:13, color:"var(--text-muted)" }}>
        <button onClick={()=>navigate({name:"project",params:{projectId}})}
          style={{ background:"none", border:"none", color:"var(--accent)", cursor:"pointer", fontSize:13, padding:0 }}>
          ← {project?.name || "Project"}
        </button>
        <span>/</span>
        <span>Analytics</span>
      </div>

      {/* Header row — always visible */}
      <div style={{ display:"flex", alignItems:"flex-start", justifyContent:"space-between", marginBottom:24, flexWrap:"wrap", gap:12 }}>
        <div>
          <h1 style={{ fontSize:20, fontWeight:700 }}>Project Analytics</h1>
          <p style={{ color:"var(--text-secondary)", fontSize:13, marginTop:4 }}>{project?.name}</p>
        </div>
        <div style={{ display:"flex", alignItems:"center", gap:10, flexWrap:"wrap" }}>
          {/* Category filter — shown whenever there are categories */}
          {categories.length > 0 && (
            <select className="select" value={filterCat} onChange={e => setFilterCat(e.target.value)}>
              <option value="">All Categories</option>
              {categories.map(c => <option key={c.id} value={String(c.id)}>{c.name}</option>)}
            </select>
          )}

          {/* Custom field filters — the same fields marked filterable */}
          {fields.map(f => {
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
                <option value="">All {f.label}</option>
                {opts.map(o => <option key={o} value={o}>{o}</option>)}
              </select>
            ) : (
              <input key={fid} className="input" value={val} placeholder={f.label}
                onChange={e=>set(e.target.value)}
                type={f.field_type === "date" ? "date" : f.field_type === "number" ? "number" : "text"}
                style={{ fontSize:12, padding:"5px 8px", width: f.field_type==="date" ? 140 : 120 }} />
            );
          })}
          {/* Date range presets */}
          <div style={{ display:"flex", gap:0, border:"1px solid var(--border)", borderRadius:6, overflow:"hidden" }}>
            {[["30d",30],["90d",90],["1y",365],["All",null]].map(([lbl,d]) => (
              <button key={lbl} onClick={()=>applyPreset(d)}
                style={{
                  padding:"6px 11px", fontSize:12, border:"none", cursor:"pointer",
                  borderRight:"1px solid var(--border)",
                  background: activePreset(d) ? "var(--accent)" : "var(--bg-elevated)",
                  color:      activePreset(d) ? "#fff"          : "var(--text-secondary)",
                  fontWeight: activePreset(d) ? 600 : 400,
                }}>{lbl}</button>
            ))}
          </div>

          {/* Explicit from / to date pickers */}
          <div style={{ display:"flex", alignItems:"center", gap:6 }}>
            <input type="date" className="input" value={dateFrom} max={dateTo || undefined}
              onChange={e=>setDateFrom(e.target.value)} title="From date"
              style={{ fontSize:12, padding:"5px 8px", width:145 }} />
            <span style={{ fontSize:12, color:"var(--text-muted)" }}>→</span>
            <input type="date" className="input" value={dateTo} min={dateFrom || undefined}
              onChange={e=>setDateTo(e.target.value)} title="To date"
              style={{ fontSize:12, padding:"5px 8px", width:145 }} />
          </div>
        </div>
      </div>

      {/* Active filter badge */}
      {(filterCat || dateFrom || dateTo || Object.keys(fieldFilters).length > 0) && (
        <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:16, flexWrap:"wrap" }}>
          <span style={{ fontSize:12, color:"var(--text-muted)" }}>Showing:</span>
          {filterCat && (
            <span style={{ fontSize:12, fontWeight:600, padding:"2px 10px", borderRadius:99,
              background:"var(--accent-soft)", color:"var(--accent)" }}>
              {categories.find(c=>String(c.id)===filterCat)?.name}
            </span>
          )}
          {(dateFrom || dateTo) && (
            <span style={{ fontSize:12, fontWeight:600, padding:"2px 10px", borderRadius:99,
              background:"var(--bg-elevated)", color:"var(--text-secondary)",
              border:"1px solid var(--border)" }}>
              📅 {dateFrom || "start"} → {dateTo || "today"}
            </span>
          )}
          {Object.entries(fieldFilters).map(([fid, v]) => {
            const f = fields.find(x => String(x.field_id ?? x.id) === fid);
            return (
              <span key={fid} style={{ fontSize:12, fontWeight:600, padding:"2px 10px",
                borderRadius:99, background:"var(--bg-elevated)", color:"var(--text-secondary)",
                border:"1px solid var(--border)" }}>
                {(f?.label || "field")}: {v}
              </span>
            );
          })}
          <button onClick={()=>{ setFilterCat(""); setDateFrom(""); setDateTo(""); setFieldFilters({}); }}
            style={{ background:"none", border:"none", color:"var(--text-muted)", cursor:"pointer", fontSize:12 }}>
            ✕ Clear all
          </button>
        </div>
      )}

      {/* Loading / error */}
      {loading && <div style={{ padding:"40px 0", textAlign:"center", color:"var(--text-muted)", fontSize:14 }}>Loading…</div>}
      {error   && <div style={{ padding:"20px 0", color:"var(--red)", fontSize:14 }}>Error: {error}</div>}

      {/* Data sections */}
      {!loading && !error && data && <AnalyticsBody data={data} categories={categories} filterCat={filterCat} />}
    </div>
  );
}

// ── Analytics body (separate component so data is always defined) ─────────────
function AnalyticsBody({ data, categories, filterCat }) {
  const { totals, by_status, by_priority, by_assignee, by_category, backlog, delayed, weekly } = data;
  const pct = totals.total > 0 ? Math.round((totals.done / totals.total) * 100) : 0;

  const statusPie   = by_status.map(r=>({ label:S_LABEL[r.status]||r.status, value:r.count, color:S_COLOR[r.status]||"#64748b" }));
  const prioPie     = by_priority.map(r=>({ label:P_LABEL[r.priority]||r.priority, value:r.count, color:P_COLOR[r.priority]||"#64748b" }));
  const categoryPie = (by_category||[]).map(r=>({ label:r.category, value:r.count, color:r.color||"#64748b" }));
  const assigneeBar = by_assignee.map(r=>({ label:r.assignee, value:r.total, color:"var(--accent)", done:r.done, open:r.open, total:r.total }));
  const PRIO_ORDER  = ["critical","high","medium","low"];
  const prioBar     = PRIO_ORDER.map(p=>({ label:P_LABEL[p], value:by_priority.find(r=>r.priority===p)?.count||0, color:P_COLOR[p] })).filter(d=>d.value>0);

  return (
    <>
      {/* KPI cards */}
      <div style={{ display:"grid", gridTemplateColumns:"repeat(5,1fr)", gap:12, marginBottom:28 }}>
        <KPI label="Total"       value={totals.total}       color="var(--text-primary)" />
        <KPI label="Done"        value={totals.done}        color="#10b981" sub={`${pct}% complete`} />
        <KPI label="In Progress" value={totals.in_progress} color="#f59e0b" />
        <KPI label="Backlog"     value={totals.open}        color="#3b82f6" />
        <KPI label="Overdue"     value={totals.overdue}     color="#ef4444" sub="past due" />
      </div>

      {/* Progress bar */}
      <div className="card" style={{ marginBottom:20, padding:"16px 20px" }}>
        <div style={{ display:"flex", justifyContent:"space-between", marginBottom:8, fontSize:13 }}>
          <span style={{ fontWeight:600 }}>Overall Completion</span>
          <span style={{ fontWeight:700, color:"#10b981" }}>{pct}%</span>
        </div>
        <div style={{ height:10, background:"var(--bg-elevated)", borderRadius:5, overflow:"hidden" }}>
          <div style={{ height:"100%", width:`${pct}%`, background:"linear-gradient(90deg,#10b981,#0d9488)", borderRadius:5, transition:"width 0.8s" }}/>
        </div>
        <div style={{ display:"flex", gap:16, marginTop:8, fontSize:11, color:"var(--text-muted)" }}>
          <span style={{ color:"#10b981" }}>✓ {totals.done} done</span>
          <span style={{ color:"#f59e0b" }}>⏳ {totals.in_progress} in progress</span>
          <span style={{ color:"#3b82f6" }}>○ {totals.open} open</span>
        </div>
      </div>

      {/* Status + Priority */}
      <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:20, marginBottom:20 }}>
        <div className="card">
          <h2 style={{ fontSize:14, fontWeight:700, marginBottom:16 }}>By Status</h2>
          <div style={{ display:"flex", gap:20, alignItems:"center" }}>
            <PieChart data={statusPie} size={160}/>
            <div style={{ flex:1 }}><BarChart data={statusPie} h={22}/><Legend items={statusPie}/></div>
          </div>
        </div>
        <div className="card">
          <h2 style={{ fontSize:14, fontWeight:700, marginBottom:16 }}>By Priority</h2>
          <div style={{ display:"flex", gap:20, alignItems:"center" }}>
            <PieChart data={prioPie} size={160}/>
            <div style={{ flex:1 }}><BarChart data={prioBar} h={22}/><Legend items={prioPie}/></div>
          </div>
        </div>
      </div>

      {/* Category chart */}
      {categoryPie.length > 0 && (
        <div className="card" style={{ marginBottom:20 }}>
          <h2 style={{ fontSize:14, fontWeight:700, marginBottom:16 }}>By Category</h2>
          <div style={{ display:"flex", gap:20, alignItems:"center" }}>
            <PieChart data={categoryPie} size={160}/>
            <div style={{ flex:1 }}><BarChart data={categoryPie} h={22}/><Legend items={categoryPie}/></div>
          </div>
        </div>
      )}

      {/* Assignee workload */}
      {assigneeBar.length > 0 && (
        <div className="card" style={{ marginBottom:20 }}>
          <h2 style={{ fontSize:14, fontWeight:700, marginBottom:16 }}>Workload by Assignee</h2>
          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:32 }}>
            <div>
              <div style={{ fontSize:11, fontWeight:600, color:"var(--text-muted)", marginBottom:10, textTransform:"uppercase" }}>Total Tasks</div>
              <BarChart data={assigneeBar} h={26}/>
            </div>
            <div>
              <div style={{ fontSize:11, fontWeight:600, color:"var(--text-muted)", marginBottom:10, textTransform:"uppercase" }}>
                Done <span style={{ color:"#10b981" }}>█</span> vs Open <span style={{ color:"#3b82f6" }}>█</span>
              </div>
              <StackedBar data={by_assignee}/>
            </div>
          </div>
        </div>
      )}

      {/* Weekly trend */}
      <div className="card" style={{ marginBottom:20 }}>
        <h2 style={{ fontSize:14, fontWeight:700, marginBottom:4 }}>Weekly Activity (last 8 weeks)</h2>
        <div style={{ display:"flex", gap:16, fontSize:11, color:"var(--text-muted)", marginBottom:12 }}>
          <span><span style={{ color:"#3b82f6", fontWeight:700 }}>—</span> Created</span>
          <span><span style={{ color:"#10b981", fontWeight:700 }}>—</span> Completed</span>
        </div>
        <WeeklyChart data={weekly||[]}/>
      </div>

      {/* Delayed tasks */}
      {delayed?.length > 0 && (
        <div className="card" style={{ marginBottom:20 }}>
          <h2 style={{ fontSize:14, fontWeight:700, marginBottom:16, color:"var(--red)" }}>🔔 Delayed ({delayed.length})</h2>
          <div style={{ overflowX:"auto" }}>
            <table style={{ width:"100%", borderCollapse:"collapse", fontSize:13 }}>
              <thead>
                <tr style={{ borderBottom:"1px solid var(--border)" }}>
                  {["#","Task","Assignee","Priority","Status","Due Date","Days Over"].map(h=>(
                    <th key={h} style={{ textAlign:"left", padding:"6px 10px", fontSize:11, fontWeight:700, color:"var(--text-muted)", textTransform:"uppercase" }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {delayed.map(t=>(
                  <tr key={t.id} style={{ borderBottom:"1px solid var(--border)" }}>
                    <td style={{ padding:"8px 10px", color:"var(--text-muted)", fontSize:11, fontFamily:"monospace" }}>#{t.id}</td>
                    <td style={{ padding:"8px 10px", fontWeight:500 }}>{t.title}</td>
                    <td style={{ padding:"8px 10px", color:"var(--text-secondary)" }}>{t.assignee}</td>
                    <td style={{ padding:"8px 10px" }}><span style={{ fontSize:11, fontWeight:700, padding:"2px 7px", borderRadius:99, background:`${P_COLOR[t.priority]}20`, color:P_COLOR[t.priority] }}>{t.priority}</span></td>
                    <td style={{ padding:"8px 10px" }}><span style={{ fontSize:11, fontWeight:600, padding:"2px 7px", borderRadius:99, background:`${S_COLOR[t.status]}20`, color:S_COLOR[t.status] }}>{S_LABEL[t.status]}</span></td>
                    <td style={{ padding:"8px 10px", color:"var(--red)", fontWeight:500 }}>{fmtDate(t.due_date)}</td>
                    <td style={{ padding:"8px 10px", color:"var(--red)", fontWeight:700 }}>{t.days_overdue}d</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Backlog */}
      {backlog?.length > 0 && (
        <div className="card">
          <h2 style={{ fontSize:14, fontWeight:700, marginBottom:16 }}>📋 Backlog ({backlog.length})</h2>
          <div style={{ overflowX:"auto" }}>
            <table style={{ width:"100%", borderCollapse:"collapse", fontSize:13 }}>
              <thead>
                <tr style={{ borderBottom:"1px solid var(--border)" }}>
                  {["#","Task","Assignee","Priority","Due Date","Created"].map(h=>(
                    <th key={h} style={{ textAlign:"left", padding:"6px 10px", fontSize:11, fontWeight:700, color:"var(--text-muted)", textTransform:"uppercase" }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {backlog.map(t=>(
                  <tr key={t.id} style={{ borderBottom:"1px solid var(--border)" }}>
                    <td style={{ padding:"8px 10px", color:"var(--text-muted)", fontSize:11, fontFamily:"monospace" }}>#{t.id}</td>
                    <td style={{ padding:"8px 10px", fontWeight:500 }}>{t.title}</td>
                    <td style={{ padding:"8px 10px", color:"var(--text-secondary)" }}>{t.assignee}</td>
                    <td style={{ padding:"8px 10px" }}><span style={{ fontSize:11, fontWeight:700, padding:"2px 7px", borderRadius:99, background:`${P_COLOR[t.priority]}20`, color:P_COLOR[t.priority] }}>{t.priority}</span></td>
                    <td style={{ padding:"8px 10px", color:"var(--text-secondary)" }}>{t.due_date ? fmtDate(t.due_date) : "—"}</td>
                    <td style={{ padding:"8px 10px", color:"var(--text-muted)", fontSize:11 }}>{fmtDate(t.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </>
  );
}
