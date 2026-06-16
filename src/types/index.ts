export interface LiftingJobMeta {
  name: string;
  date: string;
  craneId: string;
  craneType: string;
  siteName: string;
}

export interface CraneConfig {
  position: [number, number, number];
  boomLength: number;
  boomAngle: number;
  maxRadius: number;
}

export interface RestrictedZone {
  id: string;
  name: string;
  type: "cylinder" | "box";
  position: [number, number, number];
  size: {
    radius?: number;
    height?: number;
    width?: number;
    depth?: number;
  };
  color?: string;
}

export interface TrajectoryPoint {
  timestamp: number;
  hookPosition: [number, number, number];
  boomAngle: number;
  load: number;
  radius: number;
  zoneIds?: string[];
  riskLevel?: "safe" | "warning" | "danger";
  note?: string;
}

export interface LiftingJob {
  meta: LiftingJobMeta;
  crane: CraneConfig;
  restrictedZones: RestrictedZone[];
  trajectory: TrajectoryPoint[];
}

export interface CameraPreset {
  id: string;
  name: string;
  position: [number, number, number];
  target: [number, number, number];
}

export interface Annotation {
  id: string;
  timestamp: number;
  position: [number, number, number];
  riskLevel: "safe" | "warning" | "danger";
  text: string;
  ignored: boolean;
  createdAt: string;
  templateSourceId?: string;
  templateSourceName?: string;
}

export interface AnnotationTemplate {
  id: string;
  name: string;
  defaultRiskLevel: "safe" | "warning" | "danger";
  defaultText: string;
  createdAt: string;
}

export interface ValidationError {
  type: "unknown_zone" | "timestamp_reverse" | "invalid_load";
  message: string;
  pointIndex?: number;
}

export type RiskLevel = "safe" | "warning" | "danger";

export interface RiskLevelFilter {
  safe: boolean;
  warning: boolean;
  danger: boolean;
}

export interface CameraState {
  position: [number, number, number];
  target: [number, number, number];
}

export interface ExportSnapshotFilter {
  showIgnored: boolean;
  riskLevelFilter: RiskLevelFilter;
  ignoredRiskIds: string[];
}

export interface ExportSnapshot {
  id: string;
  name: string;
  jobId: string;
  jobMeta: LiftingJobMeta;
  createdAt: string;
  updatedAt: string;
  currentTime: number;
  camera: CameraState;
  filter: ExportSnapshotFilter;
  annotations: Annotation[];
  riskStats: {
    total: number;
    danger: number;
    warning: number;
    safe: number;
    ignored: number;
    visible: number;
    exported: number;
  };
  trajectory: TrajectoryPoint[];
  crane: CraneConfig;
  restrictedZones: RestrictedZone[];
}

export interface SnapshotHistoryEntry {
  snapshotId: string;
  previousVersion: ExportSnapshot;
  timestamp: string;
}
