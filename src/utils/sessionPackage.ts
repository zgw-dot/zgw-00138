import type {
  LiftingJob,
  Annotation,
  AnnotationTemplate,
  ReviewSessionPackage,
  SessionPackageLogEntry,
  SessionPackageActionType,
  DataSignature,
  ImportConflictInfo,
  ImportResolution,
  RiskLevelFilter,
  CameraState,
} from "@/types";
import {
  createSnapshot,
  exportToJSONFromSnapshot,
  exportToCSVFromSnapshot,
} from "@/utils/export";

function generateId(): string {
  return `pkg-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function generateLogId(): string {
  return `log-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function hashString(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash = hash & hash;
  }
  return Math.abs(hash).toString(16);
}

function computeDataSignature(
  annotations: Annotation[],
  showIgnored: boolean,
  riskLevelFilter: RiskLevelFilter,
  ignoredRiskIds: string[]
): DataSignature {
  const annotationsStr = JSON.stringify(
    annotations.map((a) => ({
      id: a.id,
      riskLevel: a.riskLevel,
      text: a.text,
      ignored: a.ignored,
      templateSourceId: a.templateSourceId,
      templateSourceName: a.templateSourceName,
    }))
  );
  const filterStr = JSON.stringify({
    showIgnored,
    riskLevelFilter,
    ignoredRiskIds: [...ignoredRiskIds].sort(),
  });

  const annotationsHash = hashString(annotationsStr);
  const filterHash = hashString(filterStr);
  const combinedHash = hashString(annotationsStr + filterStr);

  return { annotationsHash, filterHash, combinedHash };
}

function computePackageChecksum(pkg: ReviewSessionPackage): string {
  const content = JSON.stringify({
    version: pkg.version,
    snapshot: pkg.snapshot,
    templateSources: pkg.templateSources,
    createdAt: pkg.createdAt,
  });
  return hashString(content);
}

export function createSessionPackage(
  job: LiftingJob,
  annotations: Annotation[],
  currentTime: number,
  camera: CameraState,
  showIgnored: boolean,
  riskLevelFilter: RiskLevelFilter,
  ignoredRiskIds: string[],
  templates: AnnotationTemplate[],
  name: string,
  version: string
): ReviewSessionPackage {
  const snapshot = createSnapshot(
    job,
    annotations,
    currentTime,
    camera,
    showIgnored,
    riskLevelFilter,
    ignoredRiskIds,
    name
  );

  const jsonExport = exportToJSONFromSnapshot(snapshot, templates);
  const csvExport = exportToCSVFromSnapshot(snapshot, templates);

  snapshot.annotations = annotations.map((a) => ({ ...a }));

  const signature = computeDataSignature(
    annotations,
    showIgnored,
    riskLevelFilter,
    ignoredRiskIds
  );

  const now = new Date().toISOString();
  const jobId = `${job.meta.name}-${job.meta.date}-${job.meta.craneId}`;

  const usedTemplateIds = new Set(
    annotations
      .filter((a) => a.templateSourceId)
      .map((a) => a.templateSourceId!)
  );
  const usedTemplates = templates.filter((t) => usedTemplateIds.has(t.id));

  const pkg: ReviewSessionPackage = {
    id: generateId(),
    version,
    name,
    jobId,
    jobMeta: { ...job.meta },
    createdAt: now,
    updatedAt: now,
    isExpired: false,
    snapshot,
    exportedFiles: {
      json: jsonExport,
      csv: csvExport,
    },
    signature: signature.combinedHash,
    templateSources: usedTemplates,
    checksum: "",
  };

  pkg.checksum = computePackageChecksum(pkg);

  return pkg;
}

export function updateSessionPackage(
  existing: ReviewSessionPackage,
  job: LiftingJob,
  annotations: Annotation[],
  currentTime: number,
  camera: CameraState,
  showIgnored: boolean,
  riskLevelFilter: RiskLevelFilter,
  ignoredRiskIds: string[],
  templates: AnnotationTemplate[],
  newVersion?: string
): ReviewSessionPackage {
  const snapshot = createSnapshot(
    job,
    annotations,
    currentTime,
    camera,
    showIgnored,
    riskLevelFilter,
    ignoredRiskIds,
    existing.name
  );

  const jsonExport = exportToJSONFromSnapshot(snapshot, templates);
  const csvExport = exportToCSVFromSnapshot(snapshot, templates);

  snapshot.annotations = annotations.map((a) => ({ ...a }));

  const signature = computeDataSignature(
    annotations,
    showIgnored,
    riskLevelFilter,
    ignoredRiskIds
  );

  const usedTemplateIds = new Set(
    annotations
      .filter((a) => a.templateSourceId)
      .map((a) => a.templateSourceId!)
  );
  const usedTemplates = templates.filter((t) => usedTemplateIds.has(t.id));

  const updated: ReviewSessionPackage = {
    ...existing,
    version: newVersion || existing.version,
    updatedAt: new Date().toISOString(),
    isExpired: false,
    expiredReason: undefined,
    expiredAt: undefined,
    snapshot,
    exportedFiles: {
      json: jsonExport,
      csv: csvExport,
    },
    signature: signature.combinedHash,
    templateSources: usedTemplates,
    checksum: "",
  };

  updated.checksum = computePackageChecksum(updated);

  return updated;
}

export function markPackageExpired(
  pkg: ReviewSessionPackage,
  reason: string
): ReviewSessionPackage {
  return {
    ...pkg,
    isExpired: true,
    expiredReason: reason,
    expiredAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

export function checkPackageExpired(
  pkg: ReviewSessionPackage,
  currentAnnotations: Annotation[],
  currentShowIgnored: boolean,
  currentRiskLevelFilter: RiskLevelFilter,
  currentIgnoredRiskIds: string[]
): { expired: boolean; reason?: string } {
  if (pkg.isExpired) {
    return { expired: true, reason: pkg.expiredReason || "包已过期" };
  }

  const currentSignature = computeDataSignature(
    currentAnnotations,
    currentShowIgnored,
    currentRiskLevelFilter,
    currentIgnoredRiskIds
  );

  if (currentSignature.annotationsHash !== hashString(JSON.stringify(pkg.snapshot.annotations.map((a) => ({
    id: a.id,
    riskLevel: a.riskLevel,
    text: a.text,
    ignored: a.ignored,
    templateSourceId: a.templateSourceId,
    templateSourceName: a.templateSourceName,
  }))))) {
    return { expired: true, reason: "批注数据已变更" };
  }

  if (currentSignature.filterHash !== hashString(JSON.stringify({
    showIgnored: pkg.snapshot.filter.showIgnored,
    riskLevelFilter: pkg.snapshot.filter.riskLevelFilter,
    ignoredRiskIds: [...pkg.snapshot.filter.ignoredRiskIds].sort(),
  }))) {
    return { expired: true, reason: "筛选条件已变更" };
  }

  return { expired: false };
}

export function canExportPackage(pkg: ReviewSessionPackage): boolean {
  return !pkg.isExpired && verifyPackageChecksum(pkg);
}

export function verifyPackageChecksum(pkg: ReviewSessionPackage): boolean {
  const checksum = computePackageChecksum(pkg);
  return checksum === pkg.checksum;
}

export function createLogEntry(
  pkg: ReviewSessionPackage,
  action: SessionPackageActionType,
  success: boolean,
  message: string,
  details?: Record<string, unknown>
): SessionPackageLogEntry {
  return {
    id: generateLogId(),
    packageId: pkg.id,
    packageVersion: pkg.version,
    packageName: pkg.name,
    action,
    timestamp: new Date().toISOString(),
    success,
    message,
    details,
  };
}

export function createImportFailureLog(
  packageName: string,
  version: string,
  message: string,
  details?: Record<string, unknown>
): SessionPackageLogEntry {
  return {
    id: generateLogId(),
    packageId: "unknown",
    packageVersion: version,
    packageName: packageName,
    action: "import_failure",
    timestamp: new Date().toISOString(),
    success: false,
    message,
    details,
  };
}

export function serializePackage(pkg: ReviewSessionPackage): string {
  return JSON.stringify(pkg, null, 2);
}

export function validatePackageStructure(raw: unknown): { valid: boolean; errors: string[]; pkg?: ReviewSessionPackage } {
  const errors: string[] = [];

  if (!raw || typeof raw !== "object") {
    errors.push("包数据格式错误");
    return { valid: false, errors };
  }

  const obj = raw as Record<string, unknown>;

  const requiredFields = [
    "id",
    "version",
    "name",
    "jobId",
    "jobMeta",
    "createdAt",
    "updatedAt",
    "isExpired",
    "snapshot",
    "exportedFiles",
    "signature",
    "templateSources",
    "checksum",
  ];

  for (const field of requiredFields) {
    if (!(field in obj)) {
      errors.push(`缺少必填字段: ${field}`);
    }
  }

  if (obj.snapshot && typeof obj.snapshot === "object") {
    const snapshot = obj.snapshot as Record<string, unknown>;
    const snapshotFields = ["id", "name", "jobId", "annotations", "filter", "riskStats"];
    for (const field of snapshotFields) {
      if (!(field in snapshot)) {
        errors.push(`snapshot 缺少字段: ${field}`);
      }
    }
  } else {
    errors.push("snapshot 格式错误");
  }

  if (obj.exportedFiles && typeof obj.exportedFiles === "object") {
    const files = obj.exportedFiles as Record<string, unknown>;
    if (!files.json || typeof files.json !== "string") {
      errors.push("exportedFiles.json 格式错误");
    }
    if (!files.csv || typeof files.csv !== "string") {
      errors.push("exportedFiles.csv 格式错误");
    }
  } else {
    errors.push("exportedFiles 格式错误");
  }

  if (errors.length > 0) {
    return { valid: false, errors };
  }

  const pkg = obj as unknown as ReviewSessionPackage;

  if (!verifyPackageChecksum(pkg)) {
    errors.push("包校验和不匹配，数据可能已被篡改");
    return { valid: false, errors };
  }

  return { valid: true, errors: [], pkg };
}

export function deserializePackage(content: string): { valid: boolean; errors: string[]; pkg?: ReviewSessionPackage } {
  try {
    const raw = JSON.parse(content);
    return validatePackageStructure(raw);
  } catch (e) {
    return { valid: false, errors: [`JSON 解析失败: ${(e as Error).message}`] };
  }
}

export function checkImportConflict(
  incoming: ReviewSessionPackage,
  existingPackages: ReviewSessionPackage[]
): ImportConflictInfo | null {
  const existing = existingPackages.find(
    (p) => p.jobId === incoming.jobId && p.version === incoming.version
  );
  if (existing) {
    return { existingPackage: existing, incomingPackage: incoming };
  }
  return null;
}

export function resolveImportConflict(
  incoming: ReviewSessionPackage,
  existing: ReviewSessionPackage,
  resolution: ImportResolution,
  newVersion?: string
): ReviewSessionPackage | null {
  switch (resolution) {
    case "overwrite":
      return { ...incoming, id: existing.id };
    case "rename":
      if (!newVersion) {
        throw new Error("重命名需要提供新版本号");
      }
      return { ...incoming, version: newVersion, id: generateId() };
    case "cancel":
      return null;
  }
}

export function restoreFromPackage(
  pkg: ReviewSessionPackage
): {
  job: LiftingJob;
  annotations: Annotation[];
  currentTime: number;
  camera: CameraState;
  showIgnored: boolean;
  riskLevelFilter: RiskLevelFilter;
  ignoredRiskIds: string[];
  templates: AnnotationTemplate[];
} {
  const snapshot = pkg.snapshot;

  return {
    job: {
      meta: snapshot.jobMeta,
      crane: snapshot.crane,
      restrictedZones: snapshot.restrictedZones,
      trajectory: snapshot.trajectory,
    },
    annotations: snapshot.annotations.map((a) => ({ ...a })),
    currentTime: snapshot.currentTime,
    camera: { ...snapshot.camera },
    showIgnored: snapshot.filter.showIgnored,
    riskLevelFilter: { ...snapshot.filter.riskLevelFilter },
    ignoredRiskIds: [...snapshot.filter.ignoredRiskIds],
    templates: pkg.templateSources.map((t) => ({ ...t })),
  };
}

export function incrementVersion(version: string): string {
  const parts = version.split(".");
  if (parts.length === 3) {
    const major = parseInt(parts[0], 10);
    const minor = parseInt(parts[1], 10);
    const patch = parseInt(parts[2], 10);
    return `${major}.${minor}.${patch + 1}`;
  }
  return `${version}.1`;
}

export { computeDataSignature };
