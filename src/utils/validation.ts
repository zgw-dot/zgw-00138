import type { LiftingJob, ValidationError } from "@/types";

export interface PrecheckResult {
  passed: boolean;
  errors: ValidationError[];
}

export function precheckJob(raw: unknown): PrecheckResult {
  const errors: ValidationError[] = [];

  if (!raw || typeof raw !== "object") {
    errors.push({
      type: "invalid_load",
      message: "JSON 根对象无效或为空",
    });
    return { passed: false, errors };
  }

  const job = raw as LiftingJob;

  if (!job.trajectory || !Array.isArray(job.trajectory)) {
    errors.push({
      type: "invalid_load",
      message: "JSON 缺少 trajectory 数组",
    });
    return { passed: false, errors };
  }

  if (job.trajectory.length === 0) {
    errors.push({
      type: "invalid_load",
      message: "trajectory 数组为空",
    });
    return { passed: false, errors };
  }

  if (!job.meta || typeof job.meta !== "object") {
    errors.push({
      type: "invalid_load",
      message: "JSON 缺少 meta 对象",
    });
  }

  if (!job.crane || typeof job.crane !== "object") {
    errors.push({
      type: "invalid_load",
      message: "JSON 缺少 crane 对象",
    });
  }

  const zoneIds = new Set<string>();
  if (job.restrictedZones && Array.isArray(job.restrictedZones)) {
    for (const z of job.restrictedZones) {
      if (z && z.id) zoneIds.add(z.id);
    }
  }

  for (let i = 0; i < job.trajectory.length; i++) {
    const pt = job.trajectory[i];

    if (pt.zoneIds && Array.isArray(pt.zoneIds)) {
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
    }

    if (i > 0 && pt.timestamp < job.trajectory[i - 1].timestamp) {
      errors.push({
        type: "timestamp_reverse",
        message: `轨迹点 ${i} 时间戳 ${pt.timestamp} 小于前一点 ${job.trajectory[i - 1].timestamp}`,
        pointIndex: i,
      });
    }
  }

  return { passed: errors.length === 0, errors };
}

export function sanitizeJob(raw: unknown): LiftingJob {
  const job = raw as LiftingJob;
  if (!job.restrictedZones || !Array.isArray(job.restrictedZones)) {
    job.restrictedZones = [];
  }
  return job;
}
