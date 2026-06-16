import { useState, useRef, useCallback } from "react";
import { Upload, FileJson, AlertTriangle, CheckCircle, Database, Clock, XCircle } from "lucide-react";
import { useStore } from "@/store/useStore";
import { sampleJob } from "@/data/sampleJob";

export default function ImportPanel() {
  const [collapsed, setCollapsed] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const job = useStore((s) => s.job);
  const errors = useStore((s) => s.errors);
  const importJob = useStore((s) => s.importJob);
  const lastImportSuccess = useStore((s) => s.lastImportSuccess);
  const lastImportFailure = useStore((s) => s.lastImportFailure);

  const handleData = useCallback(
    (raw: unknown) => {
      importJob(raw);
    },
    [importJob]
  );

  const handleFile = useCallback(
    (file: File) => {
      if (!file.name.endsWith(".json")) return;
      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          const data = JSON.parse(e.target?.result as string);
          handleData(data);
        } catch {
          importJob(null);
        }
      };
      reader.readAsText(file);
    },
    [handleData, importJob]
  );

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragOver(false);
      const file = e.dataTransfer.files[0];
      if (file) handleFile(file);
    },
    [handleFile]
  );

  const onDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(true);
  }, []);

  const onDragLeave = useCallback(() => {
    setDragOver(false);
  }, []);

  const onFileChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) handleFile(file);
      if (fileInputRef.current) fileInputRef.current.value = "";
    },
    [handleFile]
  );

  const loadSample = useCallback(() => {
    handleData(sampleJob);
  }, [handleData]);

  const formatTime = (iso: string) => {
    try {
      const d = new Date(iso);
      return d.toLocaleString("zh-CN", {
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      });
    } catch {
      return iso;
    }
  };

  return (
    <div className="fixed top-4 left-4 z-50 w-80">
      <button
        onClick={() => setCollapsed((c) => !c)}
        className="flex items-center gap-2 px-3 py-2 rounded-lg bg-[#0F1B2D] border border-[#2D3748] text-gray-200 text-sm hover:border-[#4A5568] transition-colors"
      >
        <Database size={16} />
        <span>数据导入</span>
        <span className="ml-auto text-xs text-gray-400">
          {collapsed ? "▶" : "▼"}
        </span>
      </button>

      {!collapsed && (
        <div className="mt-2 rounded-lg bg-[#0F1B2D] border border-[#2D3748] overflow-hidden">
          <div
            onDrop={onDrop}
            onDragOver={onDragOver}
            onDragLeave={onDragLeave}
            onClick={() => fileInputRef.current?.click()}
            className={`flex flex-col items-center justify-center gap-2 p-6 cursor-pointer transition-colors ${
              dragOver
                ? "bg-[#1A2B44] border-2 border-dashed border-blue-400"
                : "bg-[#0F1B2D] border-2 border-dashed border-[#2D3748] hover:border-[#4A5568]"
            }`}
          >
            {dragOver ? (
              <Upload size={28} className="text-blue-400" />
            ) : (
              <FileJson size={28} className="text-gray-400" />
            )}
            <span className="text-sm text-gray-300">
              {dragOver ? "释放以导入" : "拖放 JSON 文件或点击选择"}
            </span>
            <input
              ref={fileInputRef}
              type="file"
              accept=".json"
              onChange={onFileChange}
              className="hidden"
            />
          </div>

          <div className="p-3 border-t border-[#2D3748]">
            <button
              onClick={loadSample}
              className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded bg-[#1A2B44] text-gray-200 text-sm hover:bg-[#243552] transition-colors"
            >
              <Database size={14} />
              加载样例数据
            </button>
          </div>

          {errors.length > 0 && (
            <div className="px-3 pb-2 space-y-1.5">
              <div className="flex items-center gap-1.5 mb-1">
                <XCircle size={13} className="text-red-400" />
                <span className="text-xs text-red-400 font-medium">
                  预检未通过，当前作业保持不变
                </span>
              </div>
              {errors.map((err, i) => (
                <div
                  key={i}
                  className="flex items-start gap-2 px-2.5 py-1.5 rounded bg-red-900/30 border border-red-700/50 text-xs"
                >
                  <AlertTriangle size={14} className="text-red-400 shrink-0 mt-0.5" />
                  <span className="text-red-300">{err.message}</span>
                </div>
              ))}
            </div>
          )}

          {job && errors.length === 0 && (
            <div className="px-3 pb-3">
              <div className="flex items-center gap-1.5 mb-2">
                <CheckCircle size={14} className="text-green-400" />
                <span className="text-xs text-green-400">数据加载成功</span>
              </div>
              <div className="space-y-1 text-xs text-gray-400">
                <div className="flex justify-between">
                  <span>作业名称</span>
                  <span className="text-gray-200">{job.meta.name}</span>
                </div>
                <div className="flex justify-between">
                  <span>日期</span>
                  <span className="text-gray-200">{job.meta.date}</span>
                </div>
                <div className="flex justify-between">
                  <span>起重机编号</span>
                  <span className="text-gray-200">{job.meta.craneId}</span>
                </div>
              </div>
            </div>
          )}

          {(lastImportSuccess || lastImportFailure) && (
            <div className="px-3 pb-3 border-t border-[#2D3748] pt-2 space-y-1">
              <div className="flex items-center gap-1.5 mb-1">
                <Clock size={12} className="text-[#5A7A9E]" />
                <span className="text-[10px] text-[#5A7A9E]">导入记录</span>
              </div>
              {lastImportSuccess && (
                <div className="flex items-center gap-1.5 text-[10px]">
                  <CheckCircle size={10} className="text-green-500" />
                  <span className="text-[#5A7A9E]">
                    上次成功: {formatTime(lastImportSuccess)}
                  </span>
                </div>
              )}
              {lastImportFailure && (
                <div className="flex items-center gap-1.5 text-[10px]">
                  <XCircle size={10} className="text-red-400" />
                  <span className="text-[#5A7A9E]">
                    上次失败: {formatTime(lastImportFailure.timestamp)} — {lastImportFailure.reason}
                  </span>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
