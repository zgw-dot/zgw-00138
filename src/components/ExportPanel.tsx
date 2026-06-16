import { useState, useCallback } from "react";
import { Download, FileJson, FileSpreadsheet, ChevronDown } from "lucide-react";
import { useStore } from "@/store/useStore";
import { exportToJSON, exportToCSV, downloadFile } from "@/utils/export";

export default function ExportPanel() {
  const [open, setOpen] = useState(false);
  const job = useStore((s) => s.job);
  const annotations = useStore((s) => s.annotations);
  const ignoredRiskIds = useStore((s) => s.ignoredRiskIds);
  const showIgnored = useStore((s) => s.showIgnored);

  const handleExportJSON = useCallback(() => {
    if (!job) return;
    const content = exportToJSON(job, annotations, ignoredRiskIds, showIgnored);
    const date = new Date().toISOString().slice(0, 10);
    downloadFile(
      content,
      `吊装复盘_${job.meta.name}_${date}.json`,
      "application/json"
    );
    setOpen(false);
  }, [job, annotations, ignoredRiskIds, showIgnored]);

  const handleExportCSV = useCallback(() => {
    if (!job) return;
    const content = exportToCSV(job, annotations, ignoredRiskIds, showIgnored);
    const date = new Date().toISOString().slice(0, 10);
    downloadFile(
      content,
      `吊装复盘_${job.meta.name}_${date}.csv`,
      "text/csv;charset=utf-8"
    );
    setOpen(false);
  }, [job, annotations, ignoredRiskIds, showIgnored]);

  if (!job) return null;

  const ignoredCount = ignoredRiskIds.length;
  const visibleCount = showIgnored
    ? annotations.length
    : annotations.filter((a) => !ignoredRiskIds.includes(a.id)).length;

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
        <div className="absolute top-full mt-2 right-0 w-64 bg-[#0F1B2D]/95 backdrop-blur rounded-lg border border-[#1E3A5F]/60 overflow-hidden shadow-xl shadow-black/40 z-50">
          <div className="p-3 border-b border-[#1E3A5F]/60">
            <div className="text-xs text-[#5A7A9E] mb-1">导出范围</div>
            <div className="text-xs text-[#8BA4C7]">
              可见批注: {visibleCount} 条
              {ignoredCount > 0 && (
                <span className="text-[#3D5A7A]">
                  {" "}
                  (已忽略 {ignoredCount} 条
                  {showIgnored ? "已含" : "不含"})
                </span>
              )}
            </div>
          </div>

          <div className="p-2">
            <button
              onClick={handleExportJSON}
              className="w-full flex items-center gap-3 px-3 py-2.5 rounded hover:bg-[#162844] transition-colors text-left"
            >
              <FileJson size={18} className="text-cyan-400" />
              <div>
                <div className="text-sm text-white">导出 JSON</div>
                <div className="text-[10px] text-[#5A7A9E]">
                  完整轨迹数据 + 可见风险批注
                </div>
              </div>
            </button>

            <button
              onClick={handleExportCSV}
              className="w-full flex items-center gap-3 px-3 py-2.5 rounded hover:bg-[#162844] transition-colors text-left"
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

          <div className="px-3 py-2 border-t border-[#1E3A5F]/60 text-[10px] text-[#3D5A7A]">
            导出内容与当前可见复盘状态一致
          </div>
        </div>
      )}
    </div>
  );
}
