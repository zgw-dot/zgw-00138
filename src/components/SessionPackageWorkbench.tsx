import { useState, useRef, useCallback, useMemo, useEffect } from "react";
import {
  Package,
  Upload,
  Download,
  Plus,
  Save,
  RotateCcw,
  History,
  Clock,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  ChevronDown,
  Eye,
  RefreshCw,
  Copy,
  FileJson,
  Logs,
  X,
  ArrowLeftRight,
  ShieldAlert,
  Play,
  Sparkles,
} from "lucide-react";
import { useStore } from "@/store/useStore";
import { downloadFile } from "@/utils/export";
import {
  incrementVersion,
  createConflictResolutionLog,
  deserializePackage,
} from "@/utils/sessionPackage";
import type {
  ReviewSessionPackage,
  ImportConflictInfo,
  ImportResolution,
  SessionPackageLogEntry,
} from "@/types";

type DialogType =
  | null
  | "publish"
  | "overwrite"
  | "saveas"
  | "conflict"
  | "logs"
  | "preview";

export default function SessionPackageWorkbench() {
  const [open, setOpen] = useState(false);
  const [dialog, setDialog] = useState<DialogType>(null);
  const [tab, setTab] = useState<"packages" | "logs">("packages");

  const [publishName, setPublishName] = useState("");
  const [publishVersion, setPublishVersion] = useState("1.0.0");
  const [saveAsVersion, setSaveAsVersion] = useState("");
  const [conflictResolution, setConflictResolution] =
    useState<ImportResolution>("rename");
  const [conflictNewVersion, setConflictNewVersion] = useState("");
  const [pendingImportContent, setPendingImportContent] = useState<string | null>(
    null
  );
  const [pendingConflict, setPendingConflict] =
    useState<ImportConflictInfo | null>(null);
  const [previewPackage, setPreviewPackage] =
    useState<ReviewSessionPackage | null>(null);
  const [toast, setToast] = useState<{
    type: "success" | "error" | "warning";
    message: string;
  } | null>(null);

  const importFileRef = useRef<HTMLInputElement>(null);

  const job = useStore((s) => s.job);
  const packagesMap = useStore((s) => s.sessionPackages);
  const currentJobId = useStore((s) => s.currentJobId);
  const currentPackageId = useStore((s) => s.currentPackageId);
  const lastPublishId = useStore((s) => s.lastPublishId);
  const allLogs = useStore((s) => s.sessionPackageLogs);

  const publishSessionPackage = useStore((s) => s.publishSessionPackage);
  const updateSessionPackage = useStore((s) => s.updateSessionPackage);
  const saveAsNewVersion = useStore((s) => s.saveAsNewVersion);
  const revokeLastPublish = useStore((s) => s.revokeLastPublish);
  const getCurrentPackage = useStore((s) => s.getCurrentPackage);
  const setCurrentPackage = useStore((s) => s.setCurrentPackage);
  const checkPackagesExpired = useStore((s) => s.checkPackagesExpired);
  const canExportSessionPackage = useStore((s) => s.canExportSessionPackage);
  const exportPackageToFile = useStore((s) => s.exportPackageToFile);
  const importPackageFromFile = useStore((s) => s.importPackageFromFile);
  const restoreFromPackage = useStore((s) => s.restoreFromPackage);
  const getPackageLogsByPackageId = useStore(
    (s) => s.getPackageLogsByPackageId
  );
  const hasPackageVersionConflict = useStore(
    (s) => s.hasPackageVersionConflict
  );

  const packages = useMemo(() => {
    if (!currentJobId) return [];
    return (packagesMap[currentJobId] || []).sort(
      (a, b) =>
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );
  }, [packagesMap, currentJobId]);

  const currentPackage = useMemo(() => {
    return getCurrentPackage();
  }, [getCurrentPackage]);

  const sortedLogs = useMemo(() => {
    return [...allLogs].sort(
      (a, b) =>
        new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
    );
  }, [allLogs]);

  const showToast = useCallback(
    (
      type: "success" | "error" | "warning",
      message: string,
      duration = 3000
    ) => {
      setToast({ type, message });
      setTimeout(() => setToast(null), duration);
    },
    []
  );

  useEffect(() => {
    if (job && open) {
      checkPackagesExpired();
    }
  }, [job, open, checkPackagesExpired]);

  const openPublishDialog = useCallback(() => {
    if (!job) return;
    const defaultName = `${job.meta.name}-会话包`;
    let nextVersion = "1.0.0";
    if (packages.length > 0) {
      const versions = packages.map((p) => p.version);
      const maxVersion = versions.reduce((a, b) => {
        const aParts = a.split(".").map(Number);
        const bParts = b.split(".").map(Number);
        for (let i = 0; i < Math.max(aParts.length, bParts.length); i++) {
          const av = aParts[i] || 0;
          const bv = bParts[i] || 0;
          if (av > bv) return a;
          if (av < bv) return b;
        }
        return a;
      });
      nextVersion = incrementVersion(maxVersion);
    }
    setPublishName(defaultName);
    setPublishVersion(nextVersion);
    setDialog("publish");
  }, [job, packages]);

  const handlePublish = useCallback(() => {
    if (!job || !publishName.trim() || !publishVersion.trim()) return;
    if (hasPackageVersionConflict(currentJobId!, publishVersion.trim())) {
      showToast("error", `版本号 ${publishVersion.trim()} 已存在`);
      return;
    }
    try {
      publishSessionPackage(publishName.trim(), publishVersion.trim());
      showToast("success", "发布会话包成功");
      setDialog(null);
    } catch (e) {
      showToast("error", (e as Error).message);
    }
  }, [
    job,
    publishName,
    publishVersion,
    currentJobId,
    hasPackageVersionConflict,
    publishSessionPackage,
    showToast,
  ]);

  const handleOverwrite = useCallback(() => {
    if (!currentPackageId) return;
    const result = updateSessionPackage(currentPackageId);
    if (result.success) {
      showToast("success", "覆盖更新成功");
      setDialog(null);
    } else {
      showToast("error", "覆盖更新失败");
    }
  }, [currentPackageId, updateSessionPackage, showToast]);

  const handleSaveAs = useCallback(() => {
    if (!currentPackageId || !saveAsVersion.trim()) return;
    if (
      saveAsVersion.trim() !== currentPackage!.version &&
      hasPackageVersionConflict(currentJobId!, saveAsVersion.trim())
    ) {
      showToast("error", `版本号 ${saveAsVersion.trim()} 已存在`);
      return;
    }
    const result = saveAsNewVersion(currentPackageId, saveAsVersion.trim());
    if (result.success) {
      showToast("success", `另存版本 ${saveAsVersion.trim()} 成功`);
      setDialog(null);
    } else {
      showToast("error", "另存新版本失败");
    }
  }, [
    currentPackageId,
    saveAsVersion,
    currentPackage,
    currentJobId,
    hasPackageVersionConflict,
    saveAsNewVersion,
    showToast,
  ]);

  const handleRevoke = useCallback(() => {
    const confirmed = window.confirm(
      "确定要撤销最近一次发布吗？撤销后该包将标记为已过期。"
    );
    if (!confirmed) return;
    const result = revokeLastPublish();
    if (result.success) {
      showToast("success", "撤销发布成功");
    } else {
      showToast("error", "没有可撤销的发布");
    }
  }, [revokeLastPublish, showToast]);

  const handleSelectPackage = useCallback(
    (pkg: ReviewSessionPackage) => {
      setCurrentPackage(pkg.id);
    },
    [setCurrentPackage]
  );

  const openSaveAsDialog = useCallback(() => {
    if (!currentPackage) return;
    const nextVer = incrementVersion(currentPackage.version);
    setSaveAsVersion(nextVer);
    setDialog("saveas");
  }, [currentPackage]);

  const handlePreview = useCallback((pkg: ReviewSessionPackage) => {
    setPreviewPackage(pkg);
    setDialog("preview");
  }, []);

  const handleExportPackage = useCallback(
    (pkg: ReviewSessionPackage) => {
      if (!canExportSessionPackage(pkg.id)) {
        showToast("warning", "包已过期，无法导出");
        return;
      }
      try {
        const content = exportPackageToFile(pkg.id);
        const date = new Date().toISOString().slice(0, 10);
        downloadFile(
          content,
          `会话包_${pkg.name}_v${pkg.version}_${date}.json`,
          "application/json"
        );
        showToast("success", "导出会话包成功");
      } catch (e) {
        showToast("error", (e as Error).message);
      }
    },
    [canExportSessionPackage, exportPackageToFile, showToast]
  );

  const handleRestore = useCallback(
    (pkg: ReviewSessionPackage) => {
      const confirmed = window.confirm(
        `确定要恢复到会话包「${pkg.name} v${pkg.version}」吗？\n当前作业、批注、筛选、相机视角将被替换。`
      );
      if (!confirmed) return;
      const result = restoreFromPackage(pkg.id);
      if (result.success) {
        showToast("success", "回放恢复成功");
      } else {
        showToast("error", `恢复失败: ${(result.errors || []).join(", ")}`);
      }
    },
    [restoreFromPackage, showToast]
  );

  const handleImportClick = useCallback(() => {
    importFileRef.current?.click();
  }, []);

  const handleImportFile = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (ev) => {
        const content = ev.target?.result as string;
        setPendingImportContent(content);
        const result = importPackageFromFile(content);
        if (result.success) {
          showToast("success", "导入会话包成功");
          setPendingImportContent(null);
        } else if (result.conflict) {
          setPendingConflict(result.conflict);
          setConflictNewVersion(
            incrementVersion(result.conflict.incomingPackage.version)
          );
          setConflictResolution("rename");
          setDialog("conflict");
        } else {
          showToast(
            "error",
            `导入失败: ${(result.errors || []).join(", ")}`
          );
          setPendingImportContent(null);
        }
      };
      reader.readAsText(file);
      if (importFileRef.current) importFileRef.current.value = "";
    },
    [importPackageFromFile, showToast]
  );

  const handleConflictCancel = useCallback(() => {
    if (pendingImportContent && pendingConflict) {
      const result = importPackageFromFile(
        pendingImportContent,
        "cancel",
        undefined
      );
      if (!result.success && !result.conflict) {
        showToast(
          "error",
          `记录取消日志失败: ${(result.errors || []).join(", ")}`
        );
      }
    }
    setDialog(null);
    setPendingImportContent(null);
    setPendingConflict(null);
  }, [
    pendingImportContent,
    pendingConflict,
    importPackageFromFile,
    showToast,
  ]);

  const handleConflictResolve = useCallback(() => {
    if (!pendingImportContent || !pendingConflict) return;
    const result = importPackageFromFile(
      pendingImportContent,
      conflictResolution,
      conflictNewVersion.trim() || undefined
    );
    if (result.success) {
      showToast(
        "success",
        conflictResolution === "overwrite"
          ? "覆盖导入成功"
          : conflictResolution === "rename"
          ? `重命名为 v${conflictNewVersion.trim()} 导入成功`
          : "已取消导入"
      );
      setDialog(null);
      setPendingImportContent(null);
      setPendingConflict(null);
    } else {
      showToast(
        "error",
        `导入失败: ${(result.errors || []).join(", ")}`
      );
    }
  }, [
    pendingImportContent,
    pendingConflict,
    conflictResolution,
    conflictNewVersion,
    importPackageFromFile,
    showToast,
  ]);

  const formatDateTime = (iso: string) => {
    try {
      const d = new Date(iso);
      return d.toLocaleString("zh-CN", {
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      });
    } catch {
      return iso;
    }
  };

  const formatTimeAgo = (iso: string) => {
    try {
      const diff = Date.now() - new Date(iso).getTime();
      const mins = Math.floor(diff / 60000);
      if (mins < 1) return "刚刚";
      if (mins < 60) return `${mins}分钟前`;
      const hours = Math.floor(mins / 60);
      if (hours < 24) return `${hours}小时前`;
      const days = Math.floor(hours / 24);
      return `${days}天前`;
    } catch {
      return iso;
    }
  };

  const getActionText = (action: SessionPackageLogEntry["action"]) => {
    switch (action) {
      case "publish":
        return "发布";
      case "update":
        return "覆盖更新";
      case "save_as":
        return "另存为";
      case "revoke":
        return "撤销发布";
      case "import":
        return "导入";
      case "import_failure":
        return "导入失败";
      case "import_conflict_detected":
        return "检测到冲突";
      case "import_conflict_cancel":
        return "冲突取消导入";
      case "import_conflict_rename":
        return "冲突改名导入";
      case "import_conflict_overwrite":
        return "冲突覆盖导入";
      case "restore":
        return "回放恢复";
      case "expire":
        return "标记过期";
      default:
        return action;
    }
  };

  const getPackageLogs = (pkgId: string) => {
    return getPackageLogsByPackageId(pkgId);
  };

  if (!job) return null;

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(!open)}
        className={`flex items-center gap-2 px-3 py-2 rounded-lg bg-[#0F1B2D]/90 backdrop-blur border transition-colors text-sm ${
          packages.some((p) => p.id === currentPackageId && p.isExpired)
            ? "border-amber-500/60 text-amber-300"
            : "border-[#1E3A5F]/60 text-[#8BA4C7] hover:text-white hover:bg-[#162844]"
        }`}
      >
        <Package size={16} />
        <span>会话包工作台</span>
        <ChevronDown
          size={12}
          className={`transition-transform ${open ? "rotate-180" : ""}`}
        />
      </button>

      {toast && (
        <div
          className={`fixed top-20 left-1/2 -translate-x-1/2 z-[100] flex items-center gap-2 px-4 py-2.5 rounded-lg shadow-xl text-sm animate-in fade-in slide-in-from-top-2 ${
            toast.type === "success"
              ? "bg-green-600/90 text-white border border-green-400/40"
              : toast.type === "error"
              ? "bg-red-600/90 text-white border border-red-400/40"
              : "bg-amber-600/90 text-white border border-amber-400/40"
          }`}
        >
          {toast.type === "success" ? (
            <CheckCircle2 size={16} />
          ) : toast.type === "error" ? (
            <XCircle size={16} />
          ) : (
            <AlertTriangle size={16} />
          )}
          <span>{toast.message}</span>
        </div>
      )}

      {open && (
        <div className="absolute top-full mt-2 right-0 w-[480px] max-h-[80vh] bg-[#0F1B2D]/95 backdrop-blur rounded-lg border border-[#1E3A5F]/60 overflow-hidden shadow-xl shadow-black/40 z-50 flex flex-col">
          <div className="p-3 border-b border-[#1E3A5F]/60">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <Package size={16} className="text-cyan-400" />
                <div className="text-sm font-medium text-white">
                  会话包工作台
                </div>
              </div>
              <div className="flex items-center gap-1.5">
                <button
                  onClick={handleImportClick}
                  className="flex items-center gap-1 px-2.5 py-1.5 rounded bg-[#162844] hover:bg-[#1E3A5F] text-[#8BA4C7] hover:text-white text-xs transition-colors"
                  title="导入会话包"
                >
                  <Upload size={12} />
                  导入
                </button>
                <input
                  ref={importFileRef}
                  type="file"
                  accept=".json"
                  onChange={handleImportFile}
                  className="hidden"
                />
                <button
                  onClick={openPublishDialog}
                  className="flex items-center gap-1 px-2.5 py-1.5 rounded bg-cyan-600/80 hover:bg-cyan-500 text-white text-xs transition-colors"
                  title="发布新会话包"
                >
                  <Plus size={12} />
                  发布
                </button>
              </div>
            </div>

            <div className="flex gap-1 p-0.5 rounded bg-[#0A1628]">
              <button
                onClick={() => setTab("packages")}
                className={`flex-1 flex items-center justify-center gap-1.5 px-2 py-1.5 rounded text-xs font-medium transition-colors ${
                  tab === "packages"
                    ? "bg-[#162844] text-white"
                    : "text-[#5A7A9E] hover:text-[#8BA4C7]"
                }`}
              >
                <Package size={12} />
                会话包列表
                <span className="ml-0.5 px-1.5 py-0.5 rounded-full bg-[#1E3A5F] text-[10px] text-[#8BA4C7]">
                  {packages.length}
                </span>
              </button>
              <button
                onClick={() => setTab("logs")}
                className={`flex-1 flex items-center justify-center gap-1.5 px-2 py-1.5 rounded text-xs font-medium transition-colors ${
                  tab === "logs"
                    ? "bg-[#162844] text-white"
                    : "text-[#5A7A9E] hover:text-[#8BA4C7]"
                }`}
              >
                <Logs size={12} />
                操作日志
                <span className="ml-0.5 px-1.5 py-0.5 rounded-full bg-[#1E3A5F] text-[10px] text-[#8BA4C7]">
                  {sortedLogs.length}
                </span>
              </button>
            </div>
          </div>

          {tab === "packages" && (
            <>
              {currentPackage && (
                <div
                  className={`p-3 border-b ${
                    currentPackage.isExpired
                      ? "border-amber-500/30 bg-amber-500/5"
                      : "border-[#1E3A5F]/60 bg-green-500/5"
                  }`}
                >
                  <div className="flex items-start justify-between mb-2">
                    <div className="flex items-center gap-2">
                      {currentPackage.isExpired ? (
                        <ShieldAlert
                          size={16}
                          className="text-amber-400 mt-0.5"
                        />
                      ) : (
                        <CheckCircle2
                          size={16}
                          className="text-green-400 mt-0.5"
                        />
                      )}
                      <div>
                        <div className="text-sm text-white font-medium">
                          {currentPackage.name}
                          <span className="ml-2 px-1.5 py-0.5 rounded bg-[#162844] text-[10px] text-cyan-400 font-mono">
                            v{currentPackage.version}
                          </span>
                        </div>
                        <div className="text-[10px] text-[#5A7A9E] mt-0.5">
                          发布于 {formatDateTime(currentPackage.createdAt)}
                          {currentPackage.isExpired && currentPackage.expiredAt && (
                            <>
                              {" · "}
                              <span className="text-amber-400">
                                过期于 {formatTimeAgo(currentPackage.expiredAt)}
                                （{currentPackage.expiredReason}）
                              </span>
                            </>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="grid grid-cols-4 gap-1.5 mb-2">
                    <div className="p-1.5 rounded bg-[#162844]/70">
                      <div className="text-[10px] text-[#5A7A9E]">批注</div>
                      <div className="text-sm text-cyan-400 font-medium">
                        {currentPackage.snapshot.riskStats.exported}
                      </div>
                    </div>
                    <div className="p-1.5 rounded bg-[#162844]/70">
                      <div className="text-[10px] text-[#5A7A9E]">危险</div>
                      <div className="text-sm text-red-400 font-medium">
                        {currentPackage.snapshot.riskStats.danger}
                      </div>
                    </div>
                    <div className="p-1.5 rounded bg-[#162844]/70">
                      <div className="text-[10px] text-[#5A7A9E]">时间轴</div>
                      <div className="text-sm text-amber-400 font-medium">
                        {currentPackage.snapshot.currentTime}ms
                      </div>
                    </div>
                    <div className="p-1.5 rounded bg-[#162844]/70">
                      <div className="text-[10px] text-[#5A7A9E]">模板</div>
                      <div className="text-sm text-green-400 font-medium">
                        {currentPackage.templateSources.length}
                      </div>
                    </div>
                  </div>

                  <div className="flex gap-1.5">
                    <button
                      onClick={() => setDialog("overwrite")}
                      className="flex-1 flex items-center justify-center gap-1 px-2 py-1.5 rounded bg-[#162844] hover:bg-[#1E3A5F] text-[#8BA4C7] hover:text-white text-xs transition-colors"
                      title="用当前状态覆盖此版本"
                    >
                      <Save size={11} />
                      覆盖
                    </button>
                    <button
                      onClick={openSaveAsDialog}
                      className="flex-1 flex items-center justify-center gap-1 px-2 py-1.5 rounded bg-[#162844] hover:bg-[#1E3A5F] text-[#8BA4C7] hover:text-white text-xs transition-colors"
                      title="另存为新版本"
                    >
                      <Copy size={11} />
                      另存
                    </button>
                    <button
                      onClick={handleRevoke}
                      disabled={!lastPublishId || lastPublishId !== currentPackage.id}
                      className="flex-1 flex items-center justify-center gap-1 px-2 py-1.5 rounded bg-[#162844] hover:bg-[#1E3A5F] text-[#8BA4C7] hover:text-white text-xs transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                      title="撤回最近一次发布"
                    >
                      <RotateCcw size={11} />
                      撤回
                    </button>
                    <button
                      onClick={() => handlePreview(currentPackage)}
                      className="flex-1 flex items-center justify-center gap-1 px-2 py-1.5 rounded bg-[#162844] hover:bg-[#1E3A5F] text-[#8BA4C7] hover:text-white text-xs transition-colors"
                      title="预览包内容"
                    >
                      <Eye size={11} />
                      预览
                    </button>
                    <button
                      onClick={() => handleRestore(currentPackage)}
                      className="flex-1 flex items-center justify-center gap-1 px-2 py-1.5 rounded bg-cyan-600/70 hover:bg-cyan-500 text-white text-xs transition-colors"
                      title="恢复到此包状态"
                    >
                      <Play size={11} />
                      回放
                    </button>
                    <button
                      onClick={() => handleExportPackage(currentPackage)}
                      disabled={!canExportSessionPackage(currentPackage.id)}
                      className="flex-1 flex items-center justify-center gap-1 px-2 py-1.5 rounded bg-[#162844] hover:bg-[#1E3A5F] text-[#8BA4C7] hover:text-white text-xs transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                      title="导出为文件"
                    >
                      <Download size={11} />
                      导出
                    </button>
                  </div>
                </div>
              )}

              <div className="flex-1 overflow-y-auto min-h-0">
                {packages.length === 0 && (
                  <div className="flex flex-col items-center justify-center py-12 text-[#5A7A9E]">
                    <Package size={36} className="mb-3 opacity-30" />
                    <div className="text-sm mb-1">暂无会话包</div>
                    <div className="text-xs opacity-60">
                      点击右上角「发布」创建首个会话包
                    </div>
                  </div>
                )}

                {packages.length > 0 && (
                  <div className="divide-y divide-[#1E3A5F]/40">
                    {packages.map((pkg) => {
                      const pkgLogs = getPackageLogs(pkg.id);
                      const isSelected = currentPackageId === pkg.id;
                      const isLastPublish = lastPublishId === pkg.id;
                      const expired = pkg.isExpired;
                      return (
                        <div
                          key={pkg.id}
                          onClick={() => handleSelectPackage(pkg)}
                          className={`px-3 py-2.5 cursor-pointer transition-colors ${
                            isSelected
                              ? "bg-cyan-600/15 border-l-2 border-cyan-400"
                              : "hover:bg-[#162844]/50 border-l-2 border-transparent"
                          }`}
                        >
                          <div className="flex items-start justify-between gap-2">
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 mb-0.5">
                                <span
                                  className={`inline-block w-2 h-2 rounded-full flex-shrink-0 ${
                                    expired
                                      ? "bg-amber-500"
                                      : "bg-green-500"
                                  }`}
                                />
                                <span className="text-sm text-white font-medium truncate">
                                  {pkg.name}
                                </span>
                                {isLastPublish && (
                                  <Sparkles
                                    size={10}
                                    className="text-yellow-400 flex-shrink-0"
                                  />
                                )}
                              </div>
                              <div className="flex items-center gap-2 mb-1">
                                <span className="px-1.5 py-0.5 rounded bg-[#162844] text-[10px] text-cyan-400 font-mono">
                                  v{pkg.version}
                                </span>
                                {expired ? (
                                  <span className="text-[10px] text-amber-400">
                                    已过期 · {pkg.expiredReason}
                                  </span>
                                ) : (
                                  <span className="text-[10px] text-green-400">
                                    有效
                                  </span>
                                )}
                              </div>
                              <div className="text-[10px] text-[#5A7A9E] flex items-center gap-2">
                                <Clock size={9} />
                                {formatDateTime(pkg.createdAt)}
                                <span className="text-[#3D5A7A]">·</span>
                                <History size={9} />
                                {pkgLogs.length}条日志
                                <span className="text-[#3D5A7A]">·</span>
                                {pkg.snapshot.riskStats.exported}批注
                              </div>
                            </div>

                            <div className="flex items-center gap-1 flex-shrink-0">
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handlePreview(pkg);
                                }}
                                className="p-1 rounded hover:bg-[#1E3A5F] text-[#5A7A9E] hover:text-[#8BA4C7] transition-colors"
                                title="预览"
                              >
                                <Eye size={12} />
                              </button>
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleRestore(pkg);
                                }}
                                className="p-1 rounded hover:bg-cyan-600/30 text-[#5A7A9E] hover:text-cyan-400 transition-colors"
                                title="回放恢复"
                              >
                                <Play size={12} />
                              </button>
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleExportPackage(pkg);
                                }}
                                disabled={!canExportSessionPackage(pkg.id)}
                                className="p-1 rounded hover:bg-[#1E3A5F] text-[#5A7A9E] hover:text-[#8BA4C7] transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                                title={
                                  canExportSessionPackage(pkg.id)
                                    ? "导出"
                                    : "已过期无法导出"
                                }
                              >
                                <Download size={12} />
                              </button>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              <div className="p-2 border-t border-[#1E3A5F]/60 text-[10px] text-[#3D5A7A]">
                批注或筛选变更后，旧包会自动标记过期
              </div>
            </>
          )}

          {tab === "logs" && (
            <div className="flex-1 overflow-y-auto min-h-0">
              {sortedLogs.length === 0 && (
                <div className="flex flex-col items-center justify-center py-12 text-[#5A7A9E]">
                  <Logs size={36} className="mb-3 opacity-30" />
                  <div className="text-sm mb-1">暂无操作日志</div>
                  <div className="text-xs opacity-60">
                    发布会话包后日志会自动记录
                  </div>
                </div>
              )}
              {sortedLogs.length > 0 && (
                <div className="divide-y divide-[#1E3A5F]/40">
                  {sortedLogs.slice(0, 100).map((log) => (
                    <div
                      key={log.id}
                      className="px-3 py-2 hover:bg-[#162844]/30"
                    >
                      <div className="flex items-start gap-2">
                        <div className="mt-0.5 flex-shrink-0">
                          {log.success ? (
                            log.action === "expire" ? (
                              <ShieldAlert size={12} className="text-amber-400" />
                            ) : log.action === "import_failure" ? (
                              <XCircle size={12} className="text-red-400" />
                            ) : (
                              <CheckCircle2
                                size={12}
                                className="text-green-400"
                              />
                            )
                          ) : (
                            <XCircle size={12} className="text-red-400" />
                          )}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 text-xs mb-0.5">
                            <span
                              className={`px-1.5 py-0.5 rounded ${
                                log.action === "publish" ||
                                log.action === "update" ||
                                log.action === "import"
                                  ? "bg-cyan-600/20 text-cyan-300"
                                  : log.action === "revoke"
                                  ? "bg-amber-600/20 text-amber-300"
                                  : log.action === "expire"
                                  ? "bg-amber-600/20 text-amber-300"
                                  : "bg-red-600/20 text-red-300"
                              }`}
                            >
                              {getActionText(log.action)}
                            </span>
                            <span className="text-[#8BA4C7] font-medium truncate">
                              {log.packageName}
                            </span>
                            <span className="text-[#5A7A9E] font-mono text-[10px] flex-shrink-0">
                              v{log.packageVersion}
                            </span>
                          </div>
                          <div className="text-[11px] text-[#8BA4C7] mb-0.5">
                            {log.message}
                          </div>
                          <div className="text-[10px] text-[#3D5A7A]">
                            {formatDateTime(log.timestamp)}
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {sortedLogs.length > 100 && tab === "logs" && (
            <div className="p-2 border-t border-[#1E3A5F]/60 text-[10px] text-[#5A7A9E] text-center">
              仅显示最近 100 条日志，刷新后继续查看
            </div>
          )}
        </div>
      )}

      {dialog === "publish" && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[100]">
          <div className="bg-[#0F1B2D] rounded-lg border border-[#1E3A5F]/60 p-4 w-96 shadow-xl">
            <div className="flex items-center justify-between mb-3">
              <div className="text-sm font-medium text-white">
                发布会话包
              </div>
              <button
                onClick={() => setDialog(null)}
                className="p-1 rounded hover:bg-[#162844] text-[#5A7A9E] hover:text-white"
              >
                <X size={14} />
              </button>
            </div>
            <div className="space-y-3">
              <div>
                <label className="block text-xs text-[#8BA4C7] mb-1">
                  会话包名称
                </label>
                <input
                  type="text"
                  value={publishName}
                  onChange={(e) => setPublishName(e.target.value)}
                  placeholder="输入会话包名称"
                  className="w-full px-3 py-2 rounded bg-[#162844] border border-[#1E3A5F]/60 text-white text-sm placeholder:text-[#5A7A9E] focus:outline-none focus:border-cyan-500"
                  autoFocus
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handlePublish();
                    if (e.key === "Escape") setDialog(null);
                  }}
                />
              </div>
              <div>
                <label className="block text-xs text-[#8BA4C7] mb-1">
                  版本号
                </label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={publishVersion}
                    onChange={(e) => setPublishVersion(e.target.value)}
                    placeholder="如 1.0.0"
                    className="flex-1 px-3 py-2 rounded bg-[#162844] border border-[#1E3A5F]/60 text-white text-sm placeholder:text-[#5A7A9E] focus:outline-none focus:border-cyan-500 font-mono"
                    onKeyDown={(e) => {
                      if (e.key === "Enter") handlePublish();
                      if (e.key === "Escape") setDialog(null);
                    }}
                  />
                  <button
                    onClick={() =>
                      setPublishVersion(
                        incrementVersion(
                          publishVersion || "1.0.0"
                        )
                      )
                    }
                    className="px-2.5 py-2 rounded bg-[#162844] hover:bg-[#1E3A5F] text-[#8BA4C7] hover:text-white text-xs transition-colors flex items-center gap-1"
                    title="自动递增版本号"
                  >
                    <ArrowLeftRight size={12} />
                    自增
                  </button>
                </div>
                {currentJobId &&
                  publishVersion.trim() &&
                  hasPackageVersionConflict(
                    currentJobId,
                    publishVersion.trim()
                  ) && (
                    <div className="text-[10px] text-red-400 mt-1 flex items-center gap-1">
                      <AlertTriangle size={10} />
                      版本号 {publishVersion.trim()} 已存在，请使用其他版本号
                    </div>
                  )}
              </div>
            </div>
            <div className="flex gap-2 mt-4">
              <button
                onClick={() => setDialog(null)}
                className="flex-1 px-3 py-2 rounded bg-[#162844] text-[#8BA4C7] text-sm hover:bg-[#1E3A5F] transition-colors"
              >
                取消
              </button>
              <button
                onClick={handlePublish}
                disabled={
                  !publishName.trim() ||
                  !publishVersion.trim() ||
                  (currentJobId &&
                    hasPackageVersionConflict(
                      currentJobId,
                      publishVersion.trim()
                    ))
                }
                className="flex-1 px-3 py-2 rounded bg-cyan-600/80 text-white text-sm hover:bg-cyan-500 transition-colors disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-1"
              >
                <Save size={14} />
                发布
              </button>
            </div>
          </div>
        </div>
      )}

      {dialog === "overwrite" && currentPackage && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[100]">
          <div className="bg-[#0F1B2D] rounded-lg border border-[#1E3A5F]/60 p-4 w-96 shadow-xl">
            <div className="flex items-center justify-between mb-3">
              <div className="text-sm font-medium text-white">
                覆盖更新
              </div>
              <button
                onClick={() => setDialog(null)}
                className="p-1 rounded hover:bg-[#162844] text-[#5A7A9E] hover:text-white"
              >
                <X size={14} />
              </button>
            </div>
            <div className="mb-4 p-3 rounded bg-amber-500/10 border border-amber-500/30">
              <div className="flex items-start gap-2">
                <AlertTriangle size={16} className="text-amber-400 mt-0.5 flex-shrink-0" />
                <div>
                  <div className="text-xs text-amber-300 font-medium mb-1">
                    确定覆盖「{currentPackage.name} v{currentPackage.version}」？
                  </div>
                  <div className="text-[10px] text-amber-400/80">
                    当前时间轴、相机视角、筛选条件和批注将写入此包，旧内容将被替换。
                  </div>
                </div>
              </div>
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => setDialog(null)}
                className="flex-1 px-3 py-2 rounded bg-[#162844] text-[#8BA4C7] text-sm hover:bg-[#1E3A5F] transition-colors"
              >
                取消
              </button>
              <button
                onClick={handleOverwrite}
                className="flex-1 px-3 py-2 rounded bg-amber-600/80 text-white text-sm hover:bg-amber-500 transition-colors flex items-center justify-center gap-1"
              >
                <RefreshCw size={14} />
                确认覆盖
              </button>
            </div>
          </div>
        </div>
      )}

      {dialog === "saveas" && currentPackage && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[100]">
          <div className="bg-[#0F1B2D] rounded-lg border border-[#1E3A5F]/60 p-4 w-96 shadow-xl">
            <div className="flex items-center justify-between mb-3">
              <div className="text-sm font-medium text-white">
                另存新版本
              </div>
              <button
                onClick={() => setDialog(null)}
                className="p-1 rounded hover:bg-[#162844] text-[#5A7A9E] hover:text-white"
              >
                <X size={14} />
              </button>
            </div>
            <div className="mb-3">
              <div className="text-xs text-[#8BA4C7] mb-1">原版本</div>
              <div className="px-3 py-2 rounded bg-[#162844] text-sm text-white">
                {currentPackage.name}
                <span className="ml-2 px-1.5 py-0.5 rounded bg-[#0A1628] text-[10px] text-cyan-400 font-mono">
                  v{currentPackage.version}
                </span>
              </div>
            </div>
            <div>
              <div className="text-xs text-[#8BA4C7] mb-1">新版本号</div>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={saveAsVersion}
                  onChange={(e) => setSaveAsVersion(e.target.value)}
                  placeholder="如 1.0.1"
                  className="flex-1 px-3 py-2 rounded bg-[#162844] border border-[#1E3A5F]/60 text-white text-sm placeholder:text-[#5A7A9E] focus:outline-none focus:border-cyan-500 font-mono"
                  autoFocus
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleSaveAs();
                    if (e.key === "Escape") setDialog(null);
                  }}
                />
                <button
                  onClick={() =>
                    setSaveAsVersion(incrementVersion(saveAsVersion || currentPackage.version))
                  }
                  className="px-2.5 py-2 rounded bg-[#162844] hover:bg-[#1E3A5F] text-[#8BA4C7] hover:text-white text-xs transition-colors flex items-center gap-1"
                >
                  <ArrowLeftRight size={12} />
                  自增
                </button>
              </div>
              {saveAsVersion.trim() !== currentPackage.version &&
                currentJobId &&
                saveAsVersion.trim() &&
                hasPackageVersionConflict(currentJobId, saveAsVersion.trim()) && (
                  <div className="text-[10px] text-red-400 mt-1 flex items-center gap-1">
                    <AlertTriangle size={10} />
                    版本号 {saveAsVersion.trim()} 已存在
                  </div>
                )}
            </div>
            <div className="flex gap-2 mt-4">
              <button
                onClick={() => setDialog(null)}
                className="flex-1 px-3 py-2 rounded bg-[#162844] text-[#8BA4C7] text-sm hover:bg-[#1E3A5F] transition-colors"
              >
                取消
              </button>
              <button
                onClick={handleSaveAs}
                disabled={
                  !saveAsVersion.trim() ||
                  (saveAsVersion.trim() !== currentPackage.version &&
                    currentJobId &&
                    hasPackageVersionConflict(
                      currentJobId,
                      saveAsVersion.trim()
                    ))
                }
                className="flex-1 px-3 py-2 rounded bg-cyan-600/80 text-white text-sm hover:bg-cyan-500 transition-colors disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-1"
              >
                <Copy size={14} />
                另存
              </button>
            </div>
          </div>
        </div>
      )}

      {dialog === "conflict" && pendingConflict && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[100]">
          <div className="bg-[#0F1B2D] rounded-lg border border-[#1E3A5F]/60 p-4 w-[440px] shadow-xl">
            <div className="flex items-center justify-between mb-3">
              <div className="text-sm font-medium text-white flex items-center gap-2">
                <AlertTriangle size={14} className="text-amber-400" />
                版本冲突
              </div>
              <button
                onClick={handleConflictCancel}
                className="p-1 rounded hover:bg-[#162844] text-[#5A7A9E] hover:text-white"
              >
                <X size={14} />
              </button>
            </div>
            <div className="grid grid-cols-2 gap-2 mb-4">
              <div className="p-2.5 rounded bg-[#162844]/80 border border-[#1E3A5F]/60">
                <div className="text-[10px] text-[#5A7A9E] mb-1">现有版本</div>
                <div className="text-xs text-white mb-0.5">
                  {pendingConflict.existingPackage.name}
                </div>
                <div className="text-[10px] text-cyan-400 font-mono mb-1">
                  v{pendingConflict.existingPackage.version}
                </div>
                <div className="text-[10px] text-[#5A7A9E]">
                  {formatDateTime(pendingConflict.existingPackage.createdAt)}
                </div>
              </div>
              <div className="p-2.5 rounded bg-amber-500/10 border border-amber-500/40">
                <div className="text-[10px] text-amber-400 mb-1">
                  待导入版本
                </div>
                <div className="text-xs text-white mb-0.5">
                  {pendingConflict.incomingPackage.name}
                </div>
                <div className="text-[10px] text-cyan-400 font-mono mb-1">
                  v{pendingConflict.incomingPackage.version}
                </div>
                <div className="text-[10px] text-[#5A7A9E]">
                  {formatDateTime(pendingConflict.incomingPackage.createdAt)}
                </div>
              </div>
            </div>
            <div className="space-y-2 mb-4">
              <label className="flex items-start gap-2 p-2.5 rounded border cursor-pointer transition-colors hover:bg-[#162844]">
                <input
                  type="radio"
                  name="conflict"
                  checked={conflictResolution === "rename"}
                  onChange={() => setConflictResolution("rename")}
                  className="mt-0.5"
                />
                <div className="flex-1">
                  <div className="text-xs text-white font-medium mb-1">
                    改名后导入
                  </div>
                  <div className="flex gap-2 items-center">
                    <span className="text-[10px] text-[#5A7A9E]">新版本号:</span>
                    <input
                      type="text"
                      value={conflictNewVersion}
                      onChange={(e) => setConflictNewVersion(e.target.value)}
                      disabled={conflictResolution !== "rename"}
                      className="flex-1 px-2 py-1 rounded bg-[#0A1628] border border-[#1E3A5F]/60 text-white text-[10px] font-mono placeholder:text-[#5A7A9E] focus:outline-none focus:border-cyan-500 disabled:opacity-50"
                    />
                  </div>
                </div>
              </label>
              <label className="flex items-start gap-2 p-2.5 rounded border cursor-pointer transition-colors hover:bg-[#162844]">
                <input
                  type="radio"
                  name="conflict"
                  checked={conflictResolution === "overwrite"}
                  onChange={() => setConflictResolution("overwrite")}
                  className="mt-0.5"
                />
                <div className="flex-1">
                  <div className="text-xs text-white font-medium mb-0.5">
                    覆盖现有版本
                  </div>
                  <div className="text-[10px] text-amber-400">
                    现有包「{pendingConflict.existingPackage.name} v{pendingConflict.existingPackage.version}」的内容将被替换
                  </div>
                </div>
              </label>
              <label className="flex items-start gap-2 p-2.5 rounded border cursor-pointer transition-colors hover:bg-[#162844]">
                <input
                  type="radio"
                  name="conflict"
                  checked={conflictResolution === "cancel"}
                  onChange={() => setConflictResolution("cancel")}
                  className="mt-0.5"
                />
                <div className="flex-1">
                  <div className="text-xs text-white font-medium mb-0.5">
                    取消导入
                  </div>
                  <div className="text-[10px] text-[#5A7A9E]">
                    跳过此包，保持现有数据不变
                  </div>
                </div>
              </label>
            </div>
            <div className="flex gap-2">
              <button
                onClick={handleConflictCancel}
                className="flex-1 px-3 py-2 rounded bg-[#162844] text-[#8BA4C7] text-sm hover:bg-[#1E3A5F] transition-colors"
              >
                取消
              </button>
              <button
                onClick={handleConflictResolve}
                disabled={
                  conflictResolution === "rename" &&
                  !conflictNewVersion.trim()
                }
                className="flex-1 px-3 py-2 rounded bg-cyan-600/80 text-white text-sm hover:bg-cyan-500 transition-colors disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-1"
              >
                <CheckCircle2 size={14} />
                确认
              </button>
            </div>
          </div>
        </div>
      )}

      {dialog === "preview" && previewPackage && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[100]">
          <div className="bg-[#0F1B2D] rounded-lg border border-[#1E3A5F]/60 p-4 w-[520px] max-h-[80vh] flex flex-col shadow-xl">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <Eye size={14} className="text-cyan-400" />
                <div className="text-sm font-medium text-white">
                  会话包预览
                </div>
                <span className="px-1.5 py-0.5 rounded bg-[#162844] text-[10px] text-cyan-400 font-mono">
                  v{previewPackage.version}
                </span>
              </div>
              <button
                onClick={() => setDialog(null)}
                className="p-1 rounded hover:bg-[#162844] text-[#5A7A9E] hover:text-white"
              >
                <X size={14} />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto space-y-3 min-h-0 pr-1">
              <div className="grid grid-cols-2 gap-2">
                <div className="p-2.5 rounded bg-[#162844]/60">
                  <div className="text-[10px] text-[#5A7A9E] mb-1">
                    包名称
                  </div>
                  <div className="text-xs text-white">
                    {previewPackage.name}
                  </div>
                </div>
                <div className="p-2.5 rounded bg-[#162844]/60">
                  <div className="text-[10px] text-[#5A7A9E] mb-1">作业</div>
                  <div className="text-xs text-white">
                    {previewPackage.jobMeta.name}
                  </div>
                </div>
                <div className="p-2.5 rounded bg-[#162844]/60">
                  <div className="text-[10px] text-[#5A7A9E] mb-1">
                    发布时间
                  </div>
                  <div className="text-xs text-white">
                    {formatDateTime(previewPackage.createdAt)}
                  </div>
                </div>
                <div className="p-2.5 rounded bg-[#162844]/60">
                  <div className="text-[10px] text-[#5A7A9E] mb-1">状态</div>
                  <div
                    className={`text-xs font-medium ${
                      previewPackage.isExpired
                        ? "text-amber-400"
                        : "text-green-400"
                    }`}
                  >
                    {previewPackage.isExpired
                      ? `已过期 · ${previewPackage.expiredReason}`
                      : "有效"}
                  </div>
                </div>
              </div>
              <div className="p-2.5 rounded bg-[#162844]/60">
                <div className="text-[10px] text-[#5A7A9E] mb-1.5">
                  风险统计
                </div>
                <div className="grid grid-cols-5 gap-2">
                  <div>
                    <div className="text-[10px] text-[#5A7A9E]">批注</div>
                    <div className="text-sm text-cyan-400 font-medium">
                      {previewPackage.snapshot.riskStats.exported}
                    </div>
                  </div>
                  <div>
                    <div className="text-[10px] text-[#5A7A9E]">危险</div>
                    <div className="text-sm text-red-400 font-medium">
                      {previewPackage.snapshot.riskStats.danger}
                    </div>
                  </div>
                  <div>
                    <div className="text-[10px] text-[#5A7A9E]">警告</div>
                    <div className="text-sm text-amber-400 font-medium">
                      {previewPackage.snapshot.riskStats.warning}
                    </div>
                  </div>
                  <div>
                    <div className="text-[10px] text-[#5A7A9E]">安全</div>
                    <div className="text-sm text-green-400 font-medium">
                      {previewPackage.snapshot.riskStats.safe}
                    </div>
                  </div>
                  <div>
                    <div className="text-[10px] text-[#5A7A9E]">忽略</div>
                    <div className="text-sm text-[#5A7A9E] font-medium">
                      {previewPackage.snapshot.riskStats.ignored}
                    </div>
                  </div>
                </div>
              </div>
              <div className="p-2.5 rounded bg-[#162844]/60">
                <div className="text-[10px] text-[#5A7A9E] mb-1.5">
                  固化的场景状态
                </div>
                <div className="space-y-1 text-[11px] text-[#8BA4C7]">
                  <div className="flex justify-between">
                    <span className="text-[#5A7A9E]">时间轴位置</span>
                    <span className="text-white font-mono">
                      {previewPackage.snapshot.currentTime}ms
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-[#5A7A9E]">相机位置</span>
                    <span className="text-white font-mono text-[10px]">
                      [{previewPackage.snapshot.camera.position.join(", ")}]
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-[#5A7A9E]">包含忽略</span>
                    <span className="text-white">
                      {previewPackage.snapshot.filter.showIgnored
                        ? "是"
                        : "否"}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-[#5A7A9E]">风险等级</span>
                    <span className="text-white">
                      {previewPackage.snapshot.filter.riskLevelFilter.safe && "安全"}
                      {previewPackage.snapshot.filter.riskLevelFilter.warning && "/警告"}
                      {previewPackage.snapshot.filter.riskLevelFilter.danger && "/危险"}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-[#5A7A9E]">模板来源</span>
                    <span className="text-white">
                      {previewPackage.templateSources.length}个
                    </span>
                  </div>
                </div>
              </div>
              <div className="p-2.5 rounded bg-[#162844]/60">
                <div className="text-[10px] text-[#5A7A9E] mb-1.5">
                  批注预览（前5条）
                </div>
                <div className="space-y-1.5">
                  {previewPackage.snapshot.annotations
                    .slice(0, 5)
                    .map((a) => (
                      <div
                        key={a.id}
                        className="flex items-start gap-2 py-1 border-b border-[#1E3A5F]/30 last:border-0"
                      >
                        <span
                          className={`inline-block w-2 h-2 rounded-full mt-1 flex-shrink-0 ${
                            a.riskLevel === "danger"
                              ? "bg-red-500"
                              : a.riskLevel === "warning"
                              ? "bg-amber-500"
                              : "bg-green-500"
                          }`}
                        />
                        <div className="flex-1 min-w-0">
                          <div className="text-[11px] text-white truncate">
                            {a.text}
                          </div>
                          <div className="text-[10px] text-[#5A7A9E]">
                            {a.timestamp}ms
                            {a.ignored && " · 已忽略"}
                            {a.templateSourceName &&
                              ` · 模板: ${a.templateSourceName}`}
                          </div>
                        </div>
                      </div>
                    ))}
                  {previewPackage.snapshot.annotations.length === 0 && (
                    <div className="text-[11px] text-[#5A7A9E] py-1">
                      无批注
                    </div>
                  )}
                  {previewPackage.snapshot.annotations.length > 5 && (
                    <div className="text-[10px] text-[#5A7A9E] pt-1">
                      还有 {previewPackage.snapshot.annotations.length - 5}{" "}
                      条批注...
                    </div>
                  )}
                </div>
              </div>
              <div className="p-2.5 rounded bg-[#162844]/60">
                <div className="text-[10px] text-[#5A7A9E] mb-1.5">
                  导出产物
                </div>
                <div className="flex gap-2">
                  <div className="flex-1 flex items-center gap-2 px-2 py-1.5 rounded bg-[#0A1628] border border-[#1E3A5F]/60">
                    <FileJson size={12} className="text-cyan-400" />
                    <div>
                      <div className="text-[10px] text-white">JSON</div>
                      <div className="text-[9px] text-[#5A7A9E]">
                        {(
                          previewPackage.exportedFiles.json.length / 1024
                        ).toFixed(1)}
                        KB
                      </div>
                    </div>
                  </div>
                  <div className="flex-1 flex items-center gap-2 px-2 py-1.5 rounded bg-[#0A1628] border border-[#1E3A5F]/60">
                    <FileJson size={12} className="text-green-400" />
                    <div>
                      <div className="text-[10px] text-white">CSV</div>
                      <div className="text-[9px] text-[#5A7A9E]">
                        {(
                          previewPackage.exportedFiles.csv.length / 1024
                        ).toFixed(1)}
                        KB
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
            <div className="flex gap-2 mt-4 pt-3 border-t border-[#1E3A5F]/60">
              <button
                onClick={() => setDialog(null)}
                className="flex-1 px-3 py-2 rounded bg-[#162844] text-[#8BA4C7] text-sm hover:bg-[#1E3A5F] transition-colors"
              >
                关闭
              </button>
              <button
                onClick={() => {
                  handleRestore(previewPackage);
                  setDialog(null);
                }}
                className="flex-1 px-3 py-2 rounded bg-cyan-600/80 text-white text-sm hover:bg-cyan-500 transition-colors flex items-center justify-center gap-1"
              >
                <Play size={14} />
                回放恢复
              </button>
              <button
                onClick={() => handleExportPackage(previewPackage)}
                disabled={!canExportSessionPackage(previewPackage.id)}
                className="flex-1 px-3 py-2 rounded bg-[#162844] hover:bg-[#1E3A5F] text-[#8BA4C7] hover:text-white text-sm transition-colors disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-1"
              >
                <Download size={14} />
                导出
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
