import { useState, useCallback, useMemo, useEffect } from "react";
import {
  Download,
  FileJson,
  FileSpreadsheet,
  ChevronDown,
  Camera,
  Save,
  Plus,
  Undo2,
  Trash2,
  AlertTriangle,
  Eye,
  RefreshCw,
  CheckCircle2,
} from "lucide-react";
import { useStore } from "@/store/useStore";
import {
  exportToJSONFromSnapshot,
  exportToCSVFromSnapshot,
  downloadFile,
} from "@/utils/export";
import type { ExportSnapshot } from "@/types";

export default function ExportPanel() {
  const [open, setOpen] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const [showNameDialog, setShowNameDialog] = useState(false);
  const [snapshotName, setSnapshotName] = useState("");
  const [showWarning, setShowWarning] = useState(false);

  const job = useStore((s) => s.job);
  const annotations = useStore((s) => s.annotations);
  const ignoredRiskIds = useStore((s) => s.ignoredRiskIds);
  const showIgnored = useStore((s) => s.showIgnored);
  const riskLevelFilter = useStore((s) => s.riskLevelFilter);
  const currentTime = useStore((s) => s.currentTime);
  const camera = useStore((s) => s.camera);

  const snapshots = useStore((s) => s.getCurrentJobSnapshots());
  const currentSnapshot = useStore((s) => s.getCurrentSnapshot());
  const currentSnapshotId = useStore((s) => s.currentSnapshotId);
  const filterChanged = useStore((s) => s.checkFilterChanged());
  const canUndo = useStore((s) => s.canUndo());

  const createExportSnapshot = useStore((s) => s.createExportSnapshot);
  const saveSnapshot = useStore((s) => s.saveSnapshot);
  const updateCurrentSnapshot = useStore((s) => s.updateCurrentSnapshot);
  const setCurrentSnapshot = useStore((s) => s.setCurrentSnapshot);
  const deleteSnapshot = useStore((s) => s.deleteSnapshot);
  const undoLastSnapshotChange = useStore((s) => s.undoLastSnapshotChange);

  useEffect(() => {
    if (currentSnapshot && filterChanged) {
      setShowWarning(true);
    } else {
      setShowWarning(false);
    }
  }, [filterChanged, currentSnapshot]);

  const visibleCount = useMemo(() => {
    return annotations.filter((a) => {
      if (!showIgnored && ignoredRiskIds.includes(a.id)) return false;
      if (!riskLevelFilter[a.riskLevel]) return false;
      return true;
    }).length;
  }, [annotations, showIgnored, ignoredRiskIds, riskLevelFilter]);

  const handleCreateSnapshot = useCallback(() => {
    if (!job) return;
    const defaultName = `复盘快照 ${new Date().toLocaleString("zh-CN")}`;
    setSnapshotName(defaultName);
    setShowNameDialog(true);
  }, [job]);

  const handleConfirmCreate = useCallback(() => {
    if (!job || !snapshotName.trim()) return;
    try {
      const snapshot = createExportSnapshot(snapshotName.trim());
      saveSnapshot(snapshot);
      setShowNameDialog(false);
      setSnapshotName("");
    } catch (e) {
      console.error("创建快照失败:", e);
    }
  }, [job, snapshotName, createExportSnapshot, saveSnapshot]);

  const handleUpdateSnapshot = useCallback(() => {
    if (!currentSnapshot) return;
    if (filterChanged) {
      const confirmed = window.confirm(
        "筛选条件已变更，覆盖更新将使用当前筛选条件，是否继续？"
      );
      if (!confirmed) return;
    }
    const result = updateCurrentSnapshot();
    if (!result.success) {
      alert("更新快照失败");
    }
  }, [currentSnapshot, filterChanged, updateCurrentSnapshot]);

  const handleUndo = useCallback(() => {
    const result = undoLastSnapshotChange();
    if (!result.success) {
      alert("没有可撤销的操作");
    }
  }, [undoLastSnapshotChange]);

  const handleExportJSON = useCallback(() => {
    if (!currentSnapshot) {
      alert("请先创建或选择一个快照");
      return;
    }
    if (filterChanged) {
      const confirmed = window.confirm(
        "筛选条件已变更，导出将使用快照中的筛选条件。\n\n建议重新生成快照后再导出。\n\n是否继续导出？"
      );
      if (!confirmed) return;
    }
    const content = exportToJSONFromSnapshot(currentSnapshot);
    const date = new Date().toISOString().slice(0, 10);
    downloadFile(
      content,
      `吊装复盘_${currentSnapshot.jobMeta.name}_${currentSnapshot.name}_${date}.json`,
      "application/json"
    );
  }, [currentSnapshot, filterChanged]);

  const handleExportCSV = useCallback(() => {
    if (!currentSnapshot) {
      alert("请先创建或选择一个快照");
      return;
    }
    if (filterChanged) {
      const confirmed = window.confirm(
        "筛选条件已变更，导出将使用快照中的筛选条件。\n\n建议重新生成快照后再导出。\n\n是否继续导出？"
      );
      if (!confirmed) return;
    }
    const content = exportToCSVFromSnapshot(currentSnapshot);
    const date = new Date().toISOString().slice(0, 10);
    downloadFile(
      content,
      `吊装复盘_${currentSnapshot.jobMeta.name}_${currentSnapshot.name}_${date}.csv`,
      "text/csv;charset=utf-8"
    );
  }, [currentSnapshot, filterChanged]);

  const handleSelectSnapshot = useCallback(
    (snapshot: ExportSnapshot) => {
      setCurrentSnapshot(snapshot.id);
    },
    [setCurrentSnapshot]
  );

  const handleDeleteSnapshot = useCallback(
    (snapshotId: string, e: React.MouseEvent) => {
      e.stopPropagation();
      const confirmed = window.confirm("确定要删除这个快照吗？");
      if (confirmed) {
        deleteSnapshot(snapshotId);
      }
    },
    [deleteSnapshot]
  );

  const getFilterDescription = (snapshot: ExportSnapshot) => {
    const f = snapshot.filter;
    const levels = [];
    if (f.riskLevelFilter.safe) levels.push("安全");
    if (f.riskLevelFilter.warning) levels.push("警告");
    if (f.riskLevelFilter.danger) levels.push("危险");
    return `${f.showIgnored ? "含已忽略" : "不含已忽略"} | ${levels.join("/")}`;
  };

  if (!job) return null;

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-2 px-3 py-2 rounded-lg bg-[#0F1B2D]/90 backdrop-blur border border-[#1E3A5F]/60 text-[#8BA4C7] hover:text-white hover:bg-[#162844] transition-colors text-sm"
      >
        <Download size={16} />
        <span>导出报告</span>
        <ChevronDown
          size={12}
          className={`transition-transform ${open ? "rotate-180" : ""}`}
        />
      </button>

      {open && (
        <div className="absolute top-full mt-2 right-0 w-96 bg-[#0F1B2D]/95 backdrop-blur rounded-lg border border-[#1E3A5F]/60 overflow-hidden shadow-xl shadow-black/40 z-50">
          <div className="p-3 border-b border-[#1E3A5F]/60">
            <div className="flex items-center justify-between mb-2">
              <div className="text-sm font-medium text-white">复盘快照</div>
              <button
                onClick={handleCreateSnapshot}
                className="flex items-center gap-1 px-2 py-1 rounded bg-cyan-600/80 hover:bg-cyan-500 text-white text-xs transition-colors"
              >
                <Plus size={12} />
                新建
              </button>
            </div>

            {currentSnapshot && showWarning && (
              <div className="flex items-start gap-2 p-2 rounded bg-amber-500/10 border border-amber-500/30 mb-2">
                <AlertTriangle size={14} className="text-amber-400 mt-0.5 flex-shrink-0" />
                <div className="text-xs text-amber-300">
                  筛选条件已变更，导出将使用快照中的数据。建议更新快照后再导出。
                </div>
              </div>
            )}

            {currentSnapshot && (
              <div className="space-y-1.5">
                <div className="flex items-center gap-2">
                  <CheckCircle2 size={12} className="text-green-400" />
                  <span className="text-xs text-[#8BA4C7]">
                    当前快照：<span className="text-white">{currentSnapshot.name}</span>
                  </span>
                </div>
                <div className="grid grid-cols-3 gap-2 text-xs">
                  <div className="p-1.5 rounded bg-[#162844]/50">
                    <div className="text-[#5A7A9E]">风险</div>
                    <div className="text-red-400 font-medium">{currentSnapshot.riskStats.danger}</div>
                  </div>
                  <div className="p-1.5 rounded bg-[#162844]/50">
                    <div className="text-[#5A7A9E]">批注</div>
                    <div className="text-cyan-400 font-medium">{currentSnapshot.riskStats.exported}</div>
                  </div>
                  <div className="p-1.5 rounded bg-[#162844]/50">
                    <div className="text-[#5A7A9E]">已忽略</div>
                    <div className="text-[#5A7A9E] font-medium">{currentSnapshot.riskStats.ignored}</div>
                  </div>
                </div>
                <div className="text-xs text-[#5A7A9E]">
                  筛选：{getFilterDescription(currentSnapshot)}
                </div>

                <div className="flex gap-2 pt-1">
                  <button
                    onClick={handleUpdateSnapshot}
                    className="flex-1 flex items-center justify-center gap-1 px-2 py-1.5 rounded bg-[#162844] hover:bg-[#1E3A5F] text-[#8BA4C7] hover:text-white text-xs transition-colors"
                  >
                    <RefreshCw size={12} />
                    覆盖更新
                  </button>
                  <button
                    onClick={handleUndo}
                    disabled={!canUndo}
                    className="flex-1 flex items-center justify-center gap-1 px-2 py-1.5 rounded bg-[#162844] hover:bg-[#1E3A5F] text-[#8BA4C7] hover:text-white text-xs transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    <Undo2 size={12} />
                    撤销
                  </button>
                  <button
                    onClick={() => setShowPreview(!showPreview)}
                    className={`flex-1 flex items-center justify-center gap-1 px-2 py-1.5 rounded text-xs transition-colors ${
                      showPreview ? "bg-cyan-600/80 text-white" : "bg-[#162844] text-[#8BA4C7] hover:bg-[#1E3A5F] hover:text-white"
                    }`}
                  >
                    <Eye size={12} />
                    预览
                  </button>
                </div>
              </div>
            )}

            {!currentSnapshot && (
              <div className="text-center py-4 text-[#5A7A9E] text-xs">
                <Camera size={24} className="mx-auto mb-2 opacity-40" />
                暂无快照，点击"新建"创建导出快照
              </div>
            )}
          </div>

          {snapshots.length > 0 && (
            <div className="border-b border-[#1E3A5F]/60 max-h-48 overflow-y-auto">
              <div className="px-3 py-2 text-xs text-[#5A7A9E] border-b border-[#1E3A5F]/40">
                历史快照
              </div>
              {snapshots.map((snap) => (
                <div
                  key={snap.id}
                  onClick={() => handleSelectSnapshot(snap)}
                  className={`flex items-center justify-between px-3 py-2 cursor-pointer transition-colors ${
                    currentSnapshotId === snap.id
                      ? "bg-cyan-600/20 border-l-2 border-cyan-400"
                      : "hover:bg-[#162844] border-l-2 border-transparent"
                  }`}
                >
                  <div className="flex-1 min-w-0">
                    <div className="text-sm text-white truncate">{snap.name}</div>
                    <div className="text-xs text-[#5A7A9E]">
                      {new Date(snap.updatedAt).toLocaleString("zh-CN")} · {snap.riskStats.exported} 条批注
                    </div>
                  </div>
                  <button
                    onClick={(e) => handleDeleteSnapshot(snap.id, e)}
                    className="ml-2 p-1 rounded hover:bg-red-500/20 text-[#5A7A9E] hover:text-red-400 transition-colors"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              ))}
            </div>
          )}

          {currentSnapshot && showPreview && (
            <div className="border-b border-[#1E3A5F]/60 max-h-64 overflow-y-auto p-3 bg-[#0A1628]">
              <div className="text-xs text-[#5A7A9E] mb-2">快照数据预览</div>
              {currentSnapshot.annotations.slice(0, 5).map((a) => (
                <div key={a.id} className="flex items-start gap-2 py-1.5 border-b border-[#1E3A5F]/30 last:border-0">
                  <span
                    className={`inline-block w-2 h-2 rounded-full mt-1.5 flex-shrink-0 ${
                      a.riskLevel === "danger"
                        ? "bg-red-500"
                        : a.riskLevel === "warning"
                        ? "bg-amber-500"
                        : "bg-green-500"
                    }`}
                  />
                  <div className="flex-1 min-w-0">
                    <div className="text-xs text-white truncate">{a.text}</div>
                    <div className="text-[10px] text-[#5A7A9E]">
                      {a.timestamp}ms · {a.riskLevel}
                      {a.ignored && " · 已忽略"}
                    </div>
                  </div>
                </div>
              ))}
              {currentSnapshot.annotations.length > 5 && (
                <div className="text-xs text-[#5A7A9E] text-center pt-1">
                  还有 {currentSnapshot.annotations.length - 5} 条批注...
                </div>
              )}
            </div>
          )}

          <div className="p-2">
            <button
              onClick={handleExportJSON}
              disabled={!currentSnapshot}
              className="w-full flex items-center gap-3 px-3 py-2.5 rounded hover:bg-[#162844] transition-colors text-left disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <FileJson size={18} className="text-cyan-400" />
              <div>
                <div className="text-sm text-white">导出 JSON</div>
                <div className="text-[10px] text-[#5A7A9E]">
                  完整轨迹数据 + 快照风险批注
                </div>
              </div>
            </button>

            <button
              onClick={handleExportCSV}
              disabled={!currentSnapshot}
              className="w-full flex items-center gap-3 px-3 py-2.5 rounded hover:bg-[#162844] transition-colors text-left disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <FileSpreadsheet size={18} className="text-green-400" />
              <div>
                <div className="text-sm text-white">导出 CSV</div>
                <div className="text-[10px] text-[#5A7A9E]">
                  轨迹表格 + 批注表格，可用 Excel 打开
                </div>
              </div>
            </button>
          </div>

          {currentSnapshot && (
            <div className="px-3 py-2 border-t border-[#1E3A5F]/60 text-[10px] text-[#3D5A7A]">
              导出内容基于快照数据，与创建快照时的筛选条件一致
            </div>
          )}
          {!currentSnapshot && (
            <div className="px-3 py-2 border-t border-[#1E3A5F]/60 text-[10px] text-[#3D5A7A]">
              请先创建快照后再导出
            </div>
          )}
        </div>
      )}

      {showNameDialog && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-[#0F1B2D] rounded-lg border border-[#1E3A5F]/60 p-4 w-80 shadow-xl">
            <div className="text-sm font-medium text-white mb-3">创建快照</div>
            <input
              type="text"
              value={snapshotName}
              onChange={(e) => setSnapshotName(e.target.value)}
              placeholder="输入快照名称"
              className="w-full px-3 py-2 rounded bg-[#162844] border border-[#1E3A5F]/60 text-white text-sm placeholder:text-[#5A7A9E] focus:outline-none focus:border-cyan-500"
              autoFocus
              onKeyDown={(e) => {
                if (e.key === "Enter") handleConfirmCreate();
                if (e.key === "Escape") setShowNameDialog(false);
              }}
            />
            <div className="flex gap-2 mt-3">
              <button
                onClick={() => setShowNameDialog(false)}
                className="flex-1 px-3 py-2 rounded bg-[#162844] text-[#8BA4C7] text-sm hover:bg-[#1E3A5F] transition-colors"
              >
                取消
              </button>
              <button
                onClick={handleConfirmCreate}
                disabled={!snapshotName.trim()}
                className="flex-1 px-3 py-2 rounded bg-cyan-600/80 text-white text-sm hover:bg-cyan-500 transition-colors disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-1"
              >
                <Save size={14} />
                保存
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
