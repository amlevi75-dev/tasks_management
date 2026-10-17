import { useState, useEffect } from "react";
import { apiFetch } from "../App";
import TaskCard from "../components/TaskCard";
import TaskModal from "../components/TaskModal";

export default function MyTasks({ navigate }) {
  const [tasks, setTasks] = useState([]);
  const [editTask, setEditTask] = useState(null);

  const load = () => apiFetch("/tasks/my/assigned").then(setTasks).catch(() => {});
  useEffect(() => { load(); }, []);

  const grouped = tasks.reduce((acc, t) => {
    acc[t.project_name] = acc[t.project_name] || [];
    acc[t.project_name].push(t);
    return acc;
  }, {});

  return (
    <div style={{ padding: 28, maxWidth: 900, margin: "0 auto" }}>
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ fontSize: 20, fontWeight: 700 }}>My Tasks</h1>
        <p style={{ color: "var(--text-secondary)", fontSize: 13, marginTop: 4 }}>
          {tasks.length} active task{tasks.length !== 1 ? "s" : ""} assigned to you
        </p>
      </div>

      {Object.entries(grouped).map(([proj, ptasks]) => (
        <div key={proj} style={{ marginBottom: 28 }}>
          <h2 style={{ fontSize: 13, fontWeight: 700, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: 10 }}>{proj}</h2>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {ptasks.map((t) => <TaskCard key={t.id} task={t} onClick={() => setEditTask(t)} />)}
          </div>
        </div>
      ))}

      {tasks.length === 0 && (
        <div style={{ textAlign: "center", padding: "60px 0", color: "var(--text-muted)", fontSize: 14 }}>
          <div style={{ fontSize: 40, marginBottom: 12 }}>🎉</div>
          No tasks assigned to you
        </div>
      )}

      {editTask && (
        <TaskModal task={editTask} projectId={editTask.project_id} members={[]}
          onSave={() => { load(); setEditTask(null); }}
          onClose={() => setEditTask(null)} />
      )}
    </div>
  );
}
