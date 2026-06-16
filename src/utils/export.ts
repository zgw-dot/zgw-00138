import type { LiftingJob, Annotation } from "@/types";

export function exportToJSON(
  job: LiftingJob,
  annotations: Annotation[],
  ignoredRiskIds: string[],
  showIgnored: boolean
): string {
  const visibleAnnotations = showIgnored
    ? annotations
    : annotations.filter((a) => !ignoredRiskIds.includes(a.id));

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
    exportedAt: new Date().toISOString(),
    exportOptions: {
      includeIgnored: showIgnored,
      ignoredCount: ignoredRiskIds.length,
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
  const visibleAnnotations = showIgnored
    ? annotations
    : annotations.filter((a) => !ignoredRiskIds.includes(a.id));

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
