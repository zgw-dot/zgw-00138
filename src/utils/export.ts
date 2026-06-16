import type {
  LiftingJob,
  Annotation,
  AnnotationTemplate,
  ExportSnapshot,
  RiskLevelFilter,
  CameraState,
} from "@/types";

interface RiskStats {
  total: number;
  danger: number;
  warning: number;
  safe: number;
  ignored: number;
  visible: number;
  exported: number;
}

function resolveTemplateName(
  a: { templateSourceId?: string; templateSourceName?: string },
  tplMap: Map<string, AnnotationTemplate>
): string | null {
  if (!a.templateSourceId) return null;
  if (a.templateSourceName) return a.templateSourceName;
  if (tplMap.has(a.templateSourceId)) return tplMap.get(a.templateSourceId)!.name;
  return null;
}

function generateId(): string {
  return `snap-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function computeRiskStats(
  annotations: Annotation[],
  ignoredRiskIds: string[],
  showIgnored: boolean,
  riskLevelFilter: RiskLevelFilter = { safe: true, warning: true, danger: true }
): RiskStats {
  const total = annotations.length;
  const danger = annotations.filter((a) => a.riskLevel === "danger").length;
  const warning = annotations.filter((a) => a.riskLevel === "warning").length;
  const safe = annotations.filter((a) => a.riskLevel === "safe").length;
  const ignored = ignoredRiskIds.length;

  const visibleAnnotations = getFilteredAnnotations(
    annotations,
    ignoredRiskIds,
    showIgnored,
    riskLevelFilter
  );

  const visible = visibleAnnotations.length;
  const exported = visible;

  return { total, danger, warning, safe, ignored, visible, exported };
}

function getVisibleAnnotations(
  annotations: Annotation[],
  ignoredRiskIds: string[],
  showIgnored: boolean
): Annotation[] {
  return showIgnored
    ? annotations
    : annotations.filter((a) => !ignoredRiskIds.includes(a.id));
}

function getFilteredAnnotations(
  annotations: Annotation[],
  ignoredRiskIds: string[],
  showIgnored: boolean,
  riskLevelFilter: RiskLevelFilter
): Annotation[] {
  return annotations.filter((a) => {
    if (!showIgnored && ignoredRiskIds.includes(a.id)) {
      return false;
    }
    if (!riskLevelFilter[a.riskLevel]) {
      return false;
    }
    return true;
  });
}

function areFiltersEqual(
  f1: { showIgnored: boolean; riskLevelFilter: RiskLevelFilter; ignoredRiskIds: string[] },
  f2: { showIgnored: boolean; riskLevelFilter: RiskLevelFilter; ignoredRiskIds: string[] }
): boolean {
  return (
    f1.showIgnored === f2.showIgnored &&
    f1.riskLevelFilter.safe === f2.riskLevelFilter.safe &&
    f1.riskLevelFilter.warning === f2.riskLevelFilter.warning &&
    f1.riskLevelFilter.danger === f2.riskLevelFilter.danger &&
    f1.ignoredRiskIds.length === f2.ignoredRiskIds.length &&
    f1.ignoredRiskIds.every((id) => f2.ignoredRiskIds.includes(id))
  );
}

function createSnapshot(
  job: LiftingJob,
  annotations: Annotation[],
  currentTime: number,
  camera: CameraState,
  showIgnored: boolean,
  riskLevelFilter: RiskLevelFilter,
  ignoredRiskIds: string[],
  name: string
): ExportSnapshot {
  const filteredAnnotations = getFilteredAnnotations(
    annotations,
    ignoredRiskIds,
    showIgnored,
    riskLevelFilter
  );

  const riskStats = computeRiskStats(
    annotations,
    ignoredRiskIds,
    showIgnored,
    riskLevelFilter
  );

  const now = new Date().toISOString();
  const jobId = `${job.meta.name}-${job.meta.date}-${job.meta.craneId}`;

  return {
    id: generateId(),
    name,
    jobId,
    jobMeta: { ...job.meta },
    createdAt: now,
    updatedAt: now,
    currentTime,
    camera: { ...camera },
    filter: {
      showIgnored,
      riskLevelFilter: { ...riskLevelFilter },
      ignoredRiskIds: [...ignoredRiskIds],
    },
    annotations: filteredAnnotations.map((a) => ({ ...a })),
    riskStats,
    trajectory: job.trajectory.map((p) => ({ ...p })),
    crane: { ...job.crane, position: [...job.crane.position] as [number, number, number] },
    restrictedZones: job.restrictedZones.map((z) => ({
      ...z,
      position: [...z.position] as [number, number, number],
    })),
  };
}

function updateSnapshot(
  existing: ExportSnapshot,
  job: LiftingJob,
  annotations: Annotation[],
  currentTime: number,
  camera: CameraState,
  showIgnored: boolean,
  riskLevelFilter: RiskLevelFilter,
  ignoredRiskIds: string[]
): ExportSnapshot {
  const filteredAnnotations = getFilteredAnnotations(
    annotations,
    ignoredRiskIds,
    showIgnored,
    riskLevelFilter
  );

  const riskStats = computeRiskStats(
    annotations,
    ignoredRiskIds,
    showIgnored,
    riskLevelFilter
  );

  return {
    ...existing,
    updatedAt: new Date().toISOString(),
    currentTime,
    camera: { ...camera },
    filter: {
      showIgnored,
      riskLevelFilter: { ...riskLevelFilter },
      ignoredRiskIds: [...ignoredRiskIds],
    },
    annotations: filteredAnnotations.map((a) => ({ ...a })),
    riskStats,
    trajectory: job.trajectory.map((p) => ({ ...p })),
    crane: { ...job.crane, position: [...job.crane.position] as [number, number, number] },
    restrictedZones: job.restrictedZones.map((z) => ({
      ...z,
      position: [...z.position] as [number, number, number],
    })),
  };
}

export function exportToJSON(
  job: LiftingJob,
  annotations: Annotation[],
  ignoredRiskIds: string[],
  showIgnored: boolean,
  templates: AnnotationTemplate[] = []
): string {
  const visibleAnnotations = getVisibleAnnotations(
    annotations,
    ignoredRiskIds,
    showIgnored
  );
  const stats = computeRiskStats(annotations, ignoredRiskIds, showIgnored);
  const tplMap = new Map<string, AnnotationTemplate>();
  for (const t of templates) tplMap.set(t.id, t);

  const report = {
    meta: job.meta,
    crane: job.crane,
    restrictedZones: job.restrictedZones,
    trajectory: job.trajectory,
    annotations: visibleAnnotations.map((a) => ({
      id: a.id,
      timestamp: a.timestamp,
      position: a.position,
      riskLevel: a.riskLevel,
      text: a.text,
      ignored: a.ignored,
      createdAt: a.createdAt,
      templateSourceId: a.templateSourceId || null,
      templateName: resolveTemplateName(a, tplMap),
    })),
    riskStats: stats,
    exportedAt: new Date().toISOString(),
    exportOptions: {
      includeIgnored: showIgnored,
      ignoredCount: ignoredRiskIds.length,
      visibleCount: stats.visible,
      exportedCount: stats.exported,
    },
  };

  return JSON.stringify(report, null, 2);
}

export function exportToCSV(
  job: LiftingJob,
  annotations: Annotation[],
  ignoredRiskIds: string[],
  showIgnored: boolean,
  templates: AnnotationTemplate[] = []
): string {
  const visibleAnnotations = getVisibleAnnotations(
    annotations,
    ignoredRiskIds,
    showIgnored
  );
  const stats = computeRiskStats(annotations, ignoredRiskIds, showIgnored);
  const tplMap = new Map<string, AnnotationTemplate>();
  for (const t of templates) tplMap.set(t.id, t);

  const lines: string[] = [];

  lines.push("=== 轨迹数据 ===");
  lines.push(
    "时间戳,吊钩X,吊钩Y,吊钩Z,吊臂角度,载重(t),作业半径,风险等级,备注"
  );
  for (const pt of job.trajectory) {
    lines.push(
      `${pt.timestamp},${pt.hookPosition[0]},${pt.hookPosition[1]},${pt.hookPosition[2]},${pt.boomAngle},${pt.load},${pt.radius},${pt.riskLevel || "safe"},"${(pt.note || "").replace(/"/g, '""')}"`
    );
  }

  lines.push("");
  lines.push("=== 风险批注 ===");
  lines.push(
    "ID,时间戳,位置X,位置Y,位置Z,风险等级,批注内容,已忽略,创建时间,模板来源ID,模板名称"
  );
  for (const a of visibleAnnotations) {
    const tplName = resolveTemplateName(a, tplMap) || "";
    lines.push(
      `${a.id},${a.timestamp},${a.position[0]},${a.position[1]},${a.position[2]},${a.riskLevel},"${a.text.replace(/"/g, '""')}",${a.ignored},${a.createdAt},${a.templateSourceId || ""},"${tplName.replace(/"/g, '""')}"`
    );
  }

  lines.push("");
  lines.push("=== 风险统计 ===");
  lines.push(`批注总数,${stats.total}`);
  lines.push(`危险,${stats.danger}`);
  lines.push(`警告,${stats.warning}`);
  lines.push(`安全,${stats.safe}`);
  lines.push(`已忽略,${stats.ignored}`);
  lines.push(`可见,${stats.visible}`);
  lines.push(`导出,${stats.exported}`);
  lines.push(`包含已忽略,${showIgnored}`);

  return lines.join("\n");
}

export function downloadFile(content: string, filename: string, mime: string) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function exportToJSONFromSnapshot(
  snapshot: ExportSnapshot,
  templates: AnnotationTemplate[] = []
): string {
  const tplMap = new Map<string, AnnotationTemplate>();
  for (const t of templates) tplMap.set(t.id, t);

  const report = {
    meta: snapshot.jobMeta,
    crane: snapshot.crane,
    restrictedZones: snapshot.restrictedZones,
    trajectory: snapshot.trajectory,
    annotations: snapshot.annotations.map((a) => ({
      id: a.id,
      timestamp: a.timestamp,
      position: a.position,
      riskLevel: a.riskLevel,
      text: a.text,
      ignored: a.ignored,
      createdAt: a.createdAt,
      templateSourceId: a.templateSourceId || null,
      templateName: resolveTemplateName(a, tplMap),
    })),
    riskStats: snapshot.riskStats,
    exportedAt: new Date().toISOString(),
    snapshotInfo: {
      id: snapshot.id,
      name: snapshot.name,
      createdAt: snapshot.createdAt,
      updatedAt: snapshot.updatedAt,
      currentTime: snapshot.currentTime,
      camera: snapshot.camera,
    },
    exportOptions: {
      includeIgnored: snapshot.filter.showIgnored,
      riskLevelFilter: snapshot.filter.riskLevelFilter,
      ignoredCount: snapshot.filter.ignoredRiskIds.length,
      visibleCount: snapshot.riskStats.visible,
      exportedCount: snapshot.riskStats.exported,
    },
  };

  return JSON.stringify(report, null, 2);
}

export function exportToCSVFromSnapshot(
  snapshot: ExportSnapshot,
  templates: AnnotationTemplate[] = []
): string {
  const tplMap = new Map<string, AnnotationTemplate>();
  for (const t of templates) tplMap.set(t.id, t);

  const lines: string[] = [];

  lines.push("=== 快照信息 ===");
  lines.push(`快照名称,${snapshot.name}`);
  lines.push(`快照ID,${snapshot.id}`);
  lines.push(`创建时间,${snapshot.createdAt}`);
  lines.push(`更新时间,${snapshot.updatedAt}`);
  lines.push(`时间轴位置,${snapshot.currentTime}`);
  lines.push(`相机位置,"${snapshot.camera.position.join(", ")}"`);
  lines.push(`相机目标,"${snapshot.camera.target.join(", ")}"`);
  lines.push("");

  lines.push("=== 筛选条件 ===");
  lines.push(`包含已忽略,${snapshot.filter.showIgnored}`);
  lines.push(`显示安全,${snapshot.filter.riskLevelFilter.safe}`);
  lines.push(`显示警告,${snapshot.filter.riskLevelFilter.warning}`);
  lines.push(`显示危险,${snapshot.filter.riskLevelFilter.danger}`);
  lines.push(`已忽略列表,"${snapshot.filter.ignoredRiskIds.join(", ")}"`);
  lines.push("");

  lines.push("=== 轨迹数据 ===");
  lines.push(
    "时间戳,吊钩X,吊钩Y,吊钩Z,吊臂角度,载重(t),作业半径,风险等级,备注"
  );
  for (const pt of snapshot.trajectory) {
    lines.push(
      `${pt.timestamp},${pt.hookPosition[0]},${pt.hookPosition[1]},${pt.hookPosition[2]},${pt.boomAngle},${pt.load},${pt.radius},${pt.riskLevel || "safe"},"${(pt.note || "").replace(/"/g, '""')}"`
    );
  }

  lines.push("");
  lines.push("=== 风险批注 ===");
  lines.push(
    "ID,时间戳,位置X,位置Y,位置Z,风险等级,批注内容,已忽略,创建时间,模板来源ID,模板名称"
  );
  for (const a of snapshot.annotations) {
    const tplName = resolveTemplateName(a, tplMap) || "";
    lines.push(
      `${a.id},${a.timestamp},${a.position[0]},${a.position[1]},${a.position[2]},${a.riskLevel},"${a.text.replace(/"/g, '""')}",${a.ignored},${a.createdAt},${a.templateSourceId || ""},"${tplName.replace(/"/g, '""')}"`
    );
  }

  lines.push("");
  lines.push("=== 风险统计 ===");
  lines.push(`批注总数,${snapshot.riskStats.total}`);
  lines.push(`危险,${snapshot.riskStats.danger}`);
  lines.push(`警告,${snapshot.riskStats.warning}`);
  lines.push(`安全,${snapshot.riskStats.safe}`);
  lines.push(`已忽略,${snapshot.riskStats.ignored}`);
  lines.push(`可见,${snapshot.riskStats.visible}`);
  lines.push(`导出,${snapshot.riskStats.exported}`);

  return lines.join("\n");
}

export {
  computeRiskStats,
  getVisibleAnnotations,
  getFilteredAnnotations,
  createSnapshot,
  updateSnapshot,
  areFiltersEqual,
};

