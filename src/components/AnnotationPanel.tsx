import { useState, useCallback, useMemo } from "react";
import {
  AlertTriangle,
  Plus,
  ToggleLeft,
  ToggleRight,
  Trash2,
  Edit3,
  X,
  Check,
  Filter,
  MessageSquare,
} from "lucide-react";
import { useStore } from "@/store/useStore";
import type { Annotation } from "@/types";

export default function AnnotationPanel() {
  const annotations = useStore((s) => s.annotations);
  const ignoredRiskIds = useStore((s) => s.ignoredRiskIds);
  const showIgnored = useStore((s) => s.showIgnored);
  const riskLevelFilter = useStore((s) => s.riskLevelFilter);
  const currentTime = useStore((s) => s.currentTime);
  const job = useStore((s) => s.job);
  const addAnnotation = useStore((s) => s.addAnnotation);
  const updateAnnotation = useStore((s) => s.updateAnnotation);
  const removeAnnotation = useStore((s) => s.removeAnnotation);
  const toggleIgnoreRisk = useStore((s) => s.toggleIgnoreRisk);
  const setShowIgnored = useStore((s) => s.setShowIgnored);
  const setRiskLevelFilter = useStore((s) => s.setRiskLevelFilter);
  const rightPanelOpen = useStore((s) => s.rightPanelOpen);
  const setRightPanelOpen = useStore((s) => s.setRightPanelOpen);

  const [isAdding, setIsAdding] = useState(false);
  const [newText, setNewText] = useState("");
  const [newRisk, setNewRisk] = useState<"safe" | "warning" | "danger">(
    "warning"
  );
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState("");

  const visibleAnnotations = useMemo(() => {
    let filtered = annotations;
    if (!showIgnored) {
      filtered = filtered.filter((a) => !ignoredRiskIds.includes(a.id));
    }
    filtered = filtered.filter((a) => riskLevelFilter[a.riskLevel]);
    return filtered.sort((a, b) => b.timestamp - a.timestamp);
  }, [annotations, ignoredRiskIds, showIgnored, riskLevelFilter]);

  const handleAdd = useCallback(() => {
    if (!newText.trim()) return;
    const hookPos = getHookPosAtTime(job, currentTime);
    addAnnotation({
      id: `ann-${Date.now()}`,
      timestamp: currentTime,
      position: hookPos,
      riskLevel: newRisk,
      text: newText.trim(),
      ignored: false,
      createdAt: new Date().toISOString(),
    });
    setNewText("");
    setIsAdding(false);
  }, [newText, newRisk, currentTime, job, addAnnotation]);

  const handleEdit = useCallback(
    (id: string) => {
      if (!editText.trim()) return;
      updateAnnotation(id, { text: editText.trim() });
      setEditingId(null);
      setEditText("");
    },
    [editText, updateAnnotation]
  );

  const riskBadgeClass = (level: "safe" | "warning" | "danger") => {
    if (level === "danger") return "bg-red-500/20 text-red-400 border-red-500/40";
    if (level === "warning")
      return "bg-orange-400/20 text-orange-400 border-orange-400/40";
    return "bg-green-400/20 text-green-400 border-green-400/40";
  };

  const riskLabel = (level: "safe" | "warning" | "danger") => {
    if (level === "danger") return "危险";
    if (level === "warning") return "警告";
    return "安全";
  };

  return (
    <div
      className={`fixed top-16 right-4 z-50 transition-all duration-300 ${
        rightPanelOpen ? "w-72" : "w-10"
      }`}
    >
      <button
        onClick={() => setRightPanelOpen(!rightPanelOpen)}
        className="flex items-center gap-2 px-3 py-2 rounded-lg bg-[#0F1B2D]/90 backdrop-blur border border-[#1E3A5F]/60 text-[#8BA4C7] hover:text-white hover:bg-[#162844] transition-colors text-sm mb-2"
      >
        <MessageSquare size={16} />
        {rightPanelOpen && <span>风险批注</span>}
      </button>

      {rightPanelOpen && (
        <div className="bg-[#0F1B2D]/90 backdrop-blur rounded-lg border border-[#1E3A5F]/60 overflow-hidden max-h-[calc(100vh-200px)] flex flex-col">
          <div className="p-2 border-b border-[#1E3A5F]/60 flex-shrink-0">
            <div className="flex items-center gap-1 mb-2">
              <Filter size={12} className="text-[#5A7A9E]" />
              <span className="text-xs text-[#5A7A9E]">风险等级</span>
            </div>
            <div className="flex items-center gap-1">
              {(["safe", "warning", "danger"] as const).map((level) => (
                <button
                  key={level}
                  onClick={() =>
                    setRiskLevelFilter({ [level]: !riskLevelFilter[level] })
                  }
                  className={`px-2 py-0.5 rounded text-[10px] font-medium border transition-colors ${
                    riskLevelFilter[level]
                      ? riskBadgeClass(level)
                      : "bg-transparent border-[#1E3A5F]/40 text-[#3D5A7A]"
                  }`}
                >
                  {riskLabel(level)}
                </button>
              ))}
              <button
                onClick={() => setShowIgnored(!showIgnored)}
                className="ml-auto flex items-center gap-1 text-xs text-[#5A7A9E] hover:text-white transition-colors"
              >
                {showIgnored ? (
                  <ToggleRight size={16} className="text-cyan-400" />
                ) : (
                  <ToggleLeft size={16} />
                )}
                <span className="hidden sm:inline">
                  {showIgnored ? "显示忽略" : "隐藏忽略"}
                </span>
              </button>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto p-2 space-y-2">
            {visibleAnnotations.length === 0 && (
              <div className="text-center text-xs text-[#3D5A7A] py-4">
                暂无风险批注
              </div>
            )}
            {visibleAnnotations.map((ann) => (
              <div
                key={ann.id}
                className={`p-2 rounded border transition-colors ${
                  ann.ignored
                    ? "bg-[#0A1628] border-[#1E3A5F]/30 opacity-60"
                    : "bg-[#0A1628] border-[#1E3A5F]/60"
                }`}
              >
                <div className="flex items-center gap-1.5 mb-1">
                  <span
                    className={`px-1.5 py-0.5 rounded text-[10px] font-medium border ${riskBadgeClass(ann.riskLevel)}`}
                  >
                    {riskLabel(ann.riskLevel)}
                  </span>
                  <span className="text-[10px] text-[#3D5A7A] font-mono">
                    {formatTimestamp(ann.timestamp)}
                  </span>
                  <div className="ml-auto flex items-center gap-1">
                    <button
                      onClick={() => {
                        setEditingId(ann.id);
                        setEditText(ann.text);
                      }}
                      className="text-[#5A7A9E] hover:text-white transition-colors"
                    >
                      <Edit3 size={11} />
                    </button>
                    <button
                      onClick={() => toggleIgnoreRisk(ann.id)}
                      className={`transition-colors ${
                        ann.ignored
                          ? "text-[#5A7A9E] hover:text-cyan-400"
                          : "text-[#5A7A9E] hover:text-orange-400"
                      }`}
                      title={ann.ignored ? "取消忽略" : "忽略此风险"}
                    >
                      {ann.ignored ? (
                        <ToggleLeft size={13} />
                      ) : (
                        <ToggleRight size={13} />
                      )}
                    </button>
                    <button
                      onClick={() => removeAnnotation(ann.id)}
                      className="text-[#5A7A9E] hover:text-red-400 transition-colors"
                    >
                      <Trash2 size={11} />
                    </button>
                  </div>
                </div>

                {editingId === ann.id ? (
                  <div className="flex items-center gap-1">
                    <input
                      type="text"
                      value={editText}
                      onChange={(e) => setEditText(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && handleEdit(ann.id)}
                      className="flex-1 bg-[#162844] border border-[#1E3A5F]/60 rounded px-1.5 py-0.5 text-xs text-white outline-none"
                    />
                    <button
                      onClick={() => handleEdit(ann.id)}
                      className="text-green-400"
                    >
                      <Check size={12} />
                    </button>
                    <button
                      onClick={() => setEditingId(null)}
                      className="text-red-400"
                    >
                      <X size={12} />
                    </button>
                  </div>
                ) : (
                  <p className="text-xs text-[#8BA4C7] leading-relaxed">
                    {ann.ignored && (
                      <span className="text-[#3D5A7A] line-through mr-1">
                        已忽略:
                      </span>
                    )}
                    {ann.text}
                  </p>
                )}
              </div>
            ))}
          </div>

          <div className="p-2 border-t border-[#1E3A5F]/60 flex-shrink-0">
            {isAdding ? (
              <div className="space-y-2">
                <div className="flex items-center gap-1.5">
                  {(["warning", "danger", "safe"] as const).map((level) => (
                    <button
                      key={level}
                      onClick={() => setNewRisk(level)}
                      className={`px-2 py-0.5 rounded text-[10px] font-medium border transition-colors ${
                        newRisk === level
                          ? riskBadgeClass(level)
                          : "bg-transparent border-[#1E3A5F]/40 text-[#3D5A7A]"
                      }`}
                    >
                      {riskLabel(level)}
                    </button>
                  ))}
                </div>
                <div className="flex items-center gap-1">
                  <input
                    type="text"
                    value={newText}
                    onChange={(e) => setNewText(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && handleAdd()}
                    placeholder="输入批注内容..."
                    className="flex-1 bg-[#0A1628] border border-[#1E3A5F]/60 rounded px-2 py-1.5 text-xs text-white placeholder-[#3D5A7A] outline-none focus:border-cyan-500/50"
                    autoFocus
                  />
                  <button
                    onClick={handleAdd}
                    disabled={!newText.trim()}
                    className="text-cyan-400 disabled:opacity-30"
                  >
                    <Check size={14} />
                  </button>
                  <button
                    onClick={() => {
                      setIsAdding(false);
                      setNewText("");
                    }}
                    className="text-[#5A7A9E]"
                  >
                    <X size={14} />
                  </button>
                </div>
              </div>
            ) : (
              <button
                onClick={() => setIsAdding(true)}
                className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded bg-[#162844] text-[#5A7A9E] hover:text-white hover:bg-[#1E3A5F] transition-colors text-xs"
              >
                <Plus size={14} />
                添加批注
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function formatTimestamp(ms: number): string {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
}

function getHookPosAtTime(
  job: import("@/types").LiftingJob | null,
  time: number
): [number, number, number] {
  if (!job?.trajectory.length) return [0, 15, 0];
  const traj = job.trajectory;
  if (time <= traj[0].timestamp) return traj[0].hookPosition;
  if (time >= traj[traj.length - 1].timestamp)
    return traj[traj.length - 1].hookPosition;
  for (let i = 0; i < traj.length - 1; i++) {
    if (time >= traj[i].timestamp && time <= traj[i + 1].timestamp) {
      const t =
        (time - traj[i].timestamp) /
        (traj[i + 1].timestamp - traj[i].timestamp);
      return [
        traj[i].hookPosition[0] +
          t * (traj[i + 1].hookPosition[0] - traj[i].hookPosition[0]),
        traj[i].hookPosition[1] +
          t * (traj[i + 1].hookPosition[1] - traj[i].hookPosition[1]),
        traj[i].hookPosition[2] +
          t * (traj[i + 1].hookPosition[2] - traj[i].hookPosition[2]),
      ];
    }
  }
  return [0, 15, 0];
}
