import type { LiftingJob, Annotation } from "@/types";

interface RiskStats {
  total: number;
  danger: number;
  warning: number;
  safe: number;
  ignored: number;
  visible: number;
  exported: number;
}

function computeRiskStats(
  annotations: Annotation[],
  ignoredRiskIds: string[],
  showIgnored: boolean
): RiskStats {
  const total = annotations.length;
  const danger = annotations.filter((a) => a.riskLevel === "danger").length;
  const warning = annotations.filter((a) => a.riskLevel === "warning").length;
  const safe = annotations.filter((a) => a.riskLevel === "safe").length;
  const ignored = ignoredRiskIds.length;
  const visible = showIgnored
    ? total
    : annotations.filter((a) => !ignoredRiskIds.includes(a.id)).length;
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

export function exportToJSON(
  job: LiftingJob,
  annotations: Annotation[],
  ignoredRiskIds: string[],
  showIgnored: boolean
): string {
  const visibleAnnotations = getVisibleAnnotations(
    annotations,
    ignoredRiskIds,
    showIgnored
  );
  const stats = computeRiskStats(annotations, ignoredRiskIds, showIgnored);

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
  showIgnored: boolean
): string {
  const visibleAnnotations = getVisibleAnnotations(
    annotations,
    ignoredRiskIds,
    showIgnored
  );
  const stats = computeRiskStats(annotations, ignoredRiskIds, showIgnored);

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
    "ID,时间戳,位置X,位置Y,位置Z,风险等级,批注内容,已忽略,创建时间"
  );
  for (const a of visibleAnnotations) {
    lines.push(
      `${a.id},${a.timestamp},${a.position[0]},${a.position[1]},${a.position[2]},${a.riskLevel},"${a.text.replace(/"/g, '""')}",${a.ignored},${a.createdAt}`
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

export { computeRiskStats, getVisibleAnnotations };
