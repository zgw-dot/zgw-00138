import type { LiftingJob, TrajectoryPoint, ValidationError } from "@/types";

export function validateJob(
  raw: unknown
): { job: LiftingJob; errors: ValidationError[] } {
  const errors: ValidationError[] = [];

  const job = raw as LiftingJob;

  if (!job || !job.trajectory || !Array.isArray(job.trajectory)) {
    errors.push({
      type: "invalid_load",
      message: "JSON 缺少 trajectory 数组",
    });
    return { job: job || ({} as LiftingJob), errors };
  }

  if (!job.restrictedZones || !Array.isArray(job.restrictedZones)) {
    job.restrictedZones = [];
  }

  const zoneIds = new Set(job.restrictedZones.map((z) => z.id));

  for (let i = 0; i < job.trajectory.length; i++) {
    const pt = job.trajectory[i];

    if (
      pt.zoneIds &&
      Array.isArray(pt.zoneIds)
    ) {
      for (const zid of pt.zoneIds) {
        if (!zoneIds.has(zid)) {
          errors.push({
            type: "unknown_zone",
            message: `轨迹点 ${i} 引用了未知区域 "${zid}"`,
            pointIndex: i,
          });
        }
      }
    }

    if (typeof pt.load !== "number" || isNaN(pt.load)) {
      errors.push({
        type: "invalid_load",
        message: `轨迹点 ${i} 载重字段格式错误: "${pt.load}"`,
        pointIndex: i,
      });
      pt.load = NaN;
    }

    if (i > 0 && pt.timestamp < job.trajectory[i - 1].timestamp) {
      errors.push({
        type: "timestamp_reverse",
        message: `轨迹点 ${i} 时间戳 ${pt.timestamp} 小于前一点 ${job.trajectory[i - 1].timestamp}`,
        pointIndex: i,
      });
    }
  }

  const hasReverse = errors.some((e) => e.type === "timestamp_reverse");
  if (hasReverse) {
    job.trajectory.sort(
      (a: TrajectoryPoint, b: TrajectoryPoint) => a.timestamp - b.timestamp
    );
  }

  return { job, errors };
}
