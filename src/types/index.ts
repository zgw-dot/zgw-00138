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
}

export interface ValidationError {
  type: "unknown_zone" | "timestamp_reverse" | "invalid_load";
  message: string;
  pointIndex?: number;
}
