import { create } from "zustand";
import { persist } from "zustand/middleware";
import type {
  LiftingJob,
  CameraPreset,
  Annotation,
  ValidationError,
  RiskLevelFilter,
  CameraState,
  ExportSnapshot,
  SnapshotHistoryEntry,
} from "@/types";
import { precheckJob, sanitizeJob } from "@/utils/validation";
import { createSnapshot, updateSnapshot, areFiltersEqual } from "@/utils/export";

export interface ImportFailureRecord {
  reason: string;
  errors: ValidationError[];
  timestamp: string;
}

interface AppState {
  job: LiftingJob | null;
  currentTime: number;
  isPlaying: boolean;
  playbackSpeed: number;
  cameraPresets: CameraPreset[];
  camera: CameraState;
  annotations: Annotation[];
  ignoredRiskIds: string[];
  showIgnored: boolean;
  riskLevelFilter: RiskLevelFilter;
  errors: ValidationError[];
  rightPanelOpen: boolean;
  lastImportSuccess: string | null;
  lastImportFailure: ImportFailureRecord | null;
  snapshots: Record<string, ExportSnapshot[]>;
  currentSnapshotId: string | null;
  currentJobId: string | null;
  snapshotHistory: SnapshotHistoryEntry[];

  setJob: (job: LiftingJob | null) => void;
  importJob: (raw: unknown) => { success: boolean; errors: ValidationError[] };
  setCurrentTime: (t: number) => void;
  setIsPlaying: (p: boolean) => void;
  setPlaybackSpeed: (s: number) => void;
  setCamera: (camera: CameraState) => void;
  addCameraPreset: (p: CameraPreset) => void;
  removeCameraPreset: (id: string) => void;
  setCameraPresets: (ps: CameraPreset[]) => void;
  addAnnotation: (a: Annotation) => void;
  updateAnnotation: (id: string, updates: Partial<Annotation>) => void;
  removeAnnotation: (id: string) => void;
  toggleIgnoreRisk: (id: string) => void;
  setShowIgnored: (v: boolean) => void;
  setRiskLevelFilter: (filter: Partial<RiskLevelFilter>) => void;
  setErrors: (e: ValidationError[]) => void;
  addErrors: (e: ValidationError[]) => void;
  clearErrors: () => void;
  setRightPanelOpen: (v: boolean) => void;
  resetPlayback: () => void;
  createExportSnapshot: (name: string) => ExportSnapshot;
  saveSnapshot: (snapshot: ExportSnapshot) => void;
  updateCurrentSnapshot: () => { success: boolean; snapshot?: ExportSnapshot };
  setCurrentSnapshot: (snapshotId: string | null) => void;
  deleteSnapshot: (snapshotId: string) => void;
  getCurrentJobSnapshots: () => ExportSnapshot[];
  getCurrentSnapshot: () => ExportSnapshot | null;
  checkFilterChanged: () => boolean;
  undoLastSnapshotChange: () => { success: boolean; snapshot?: ExportSnapshot };
  canUndo: () => boolean;
}

const defaultCameraPresets: CameraPreset[] = [
  {
    id: "preset-top",
    name: "俯视",
    position: [0, 80, 0.1],
    target: [0, 0, 0],
  },
  {
    id: "preset-side",
    name: "侧视",
    position: [60, 20, 0],
    target: [0, 10, 0],
  },
  {
    id: "preset-front",
    name: "正视",
    position: [0, 15, 60],
    target: [0, 10, 0],
  },
  {
    id: "preset-follow",
    name: "跟随吊钩",
    position: [10, 25, 10],
    target: [0, 15, 0],
  },
];

function getJobId(job: LiftingJob): string {
  return `${job.meta.name}-${job.meta.date}-${job.meta.craneId}`;
}

export const useStore = create<AppState>()(
  persist(
    (set, get) => ({
      job: null,
      currentTime: 0,
      isPlaying: false,
      playbackSpeed: 1,
      cameraPresets: defaultCameraPresets,
      camera: { position: [0, 80, 0.1], target: [0, 0, 0] },
      annotations: [],
      ignoredRiskIds: [],
      showIgnored: true,
      riskLevelFilter: { safe: true, warning: true, danger: true },
      errors: [],
      rightPanelOpen: true,
      lastImportSuccess: null,
      lastImportFailure: null,
      snapshots: {},
      currentSnapshotId: null,
      currentJobId: null,
      snapshotHistory: [],

      setJob: (job) => {
        const jobId = job ? getJobId(job) : null;
        set({
          job,
          currentTime: 0,
          isPlaying: false,
          errors: [],
          currentJobId: jobId,
          currentSnapshotId: null,
          annotations: [],
          ignoredRiskIds: [],
          snapshotHistory: [],
        });
      },
      importJob: (raw: unknown) => {
        const result = precheckJob(raw);
        if (!result.passed) {
          const failureRecord: ImportFailureRecord = {
            reason: `预检未通过，共 ${result.errors.length} 项错误`,
            errors: result.errors,
            timestamp: new Date().toISOString(),
          };
          set({
            errors: result.errors,
            lastImportFailure: failureRecord,
          });
          return { success: false, errors: result.errors };
        }
        const job = sanitizeJob(raw);
        const jobId = getJobId(job);
        set({
          job,
          currentTime: 0,
          isPlaying: false,
          errors: [],
          lastImportSuccess: new Date().toISOString(),
          currentJobId: jobId,
          currentSnapshotId: null,
          annotations: [],
          ignoredRiskIds: [],
          snapshotHistory: [],
        });
        return { success: true, errors: [] };
      },
      setCurrentTime: (currentTime) => set({ currentTime }),
      setIsPlaying: (isPlaying) => set({ isPlaying }),
      setPlaybackSpeed: (playbackSpeed) => set({ playbackSpeed }),
      setCamera: (camera) => set({ camera }),
      addCameraPreset: (p) =>
        set((s) => ({ cameraPresets: [...s.cameraPresets, p] })),
      removeCameraPreset: (id) =>
        set((s) => ({
          cameraPresets: s.cameraPresets.filter((p) => p.id !== id),
        })),
      setCameraPresets: (cameraPresets) => set({ cameraPresets }),
      addAnnotation: (a) =>
        set((s) => ({ annotations: [...s.annotations, a] })),
      updateAnnotation: (id, updates) =>
        set((s) => ({
          annotations: s.annotations.map((a) =>
            a.id === id ? { ...a, ...updates } : a
          ),
        })),
      removeAnnotation: (id) =>
        set((s) => ({
          annotations: s.annotations.filter((a) => a.id !== id),
        })),
      toggleIgnoreRisk: (id) =>
        set((s) => ({
          ignoredRiskIds: s.ignoredRiskIds.includes(id)
            ? s.ignoredRiskIds.filter((i) => i !== id)
            : [...s.ignoredRiskIds, id],
        })),
      setShowIgnored: (showIgnored) => set({ showIgnored }),
      setRiskLevelFilter: (filter) =>
        set((s) => ({
          riskLevelFilter: { ...s.riskLevelFilter, ...filter },
        })),
      setErrors: (errors) => set({ errors }),
      addErrors: (e) =>
        set((s) => ({ errors: [...s.errors, ...e] })),
      clearErrors: () => set({ errors: [] }),
      setRightPanelOpen: (rightPanelOpen) => set({ rightPanelOpen }),
      resetPlayback: () => set({ currentTime: 0, isPlaying: false }),

      createExportSnapshot: (name: string) => {
        const state = get();
        if (!state.job) {
          throw new Error("没有加载作业，无法创建快照");
        }
        const snapshot = createSnapshot(
          state.job,
          state.annotations,
          state.currentTime,
          state.camera,
          state.showIgnored,
          state.riskLevelFilter,
          state.ignoredRiskIds,
          name
        );
        return snapshot;
      },

      saveSnapshot: (snapshot: ExportSnapshot) => {
        set((s) => {
          const jobSnapshots = s.snapshots[snapshot.jobId] || [];
          const existingIndex = jobSnapshots.findIndex((snap) => snap.id === snapshot.id);
          let newSnapshots;
          if (existingIndex >= 0) {
            newSnapshots = [...jobSnapshots];
            newSnapshots[existingIndex] = snapshot;
          } else {
            newSnapshots = [...jobSnapshots, snapshot];
          }
          return {
            snapshots: {
              ...s.snapshots,
              [snapshot.jobId]: newSnapshots,
            },
            currentSnapshotId: snapshot.id,
          };
        });
      },

      updateCurrentSnapshot: () => {
        const state = get();
        if (!state.job || !state.currentSnapshotId) {
          return { success: false };
        }
        const current = state.getCurrentSnapshot();
        if (!current) {
          return { success: false };
        }
        const historyEntry: SnapshotHistoryEntry = {
          snapshotId: current.id,
          previousVersion: JSON.parse(JSON.stringify(current)),
          timestamp: new Date().toISOString(),
        };
        const updated = updateSnapshot(
          current,
          state.job,
          state.annotations,
          state.currentTime,
          state.camera,
          state.showIgnored,
          state.riskLevelFilter,
          state.ignoredRiskIds
        );
        set((s) => {
          const jobSnapshots = s.snapshots[updated.jobId] || [];
          const newSnapshots = jobSnapshots.map((snap) =>
            snap.id === updated.id ? updated : snap
          );
          return {
            snapshots: {
              ...s.snapshots,
              [updated.jobId]: newSnapshots,
            },
            snapshotHistory: [...s.snapshotHistory, historyEntry],
          };
        });
        return { success: true, snapshot: updated };
      },

      setCurrentSnapshot: (snapshotId: string | null) =>
        set({ currentSnapshotId: snapshotId }),

      deleteSnapshot: (snapshotId: string) => {
        set((s) => {
          const newSnapshots: Record<string, ExportSnapshot[]> = {};
          for (const [jobId, snaps] of Object.entries(s.snapshots)) {
            newSnapshots[jobId] = snaps.filter((snap) => snap.id !== snapshotId);
          }
          return {
            snapshots: newSnapshots,
            currentSnapshotId:
              s.currentSnapshotId === snapshotId ? null : s.currentSnapshotId,
          };
        });
      },

      getCurrentJobSnapshots: () => {
        const state = get();
        if (!state.currentJobId) return [];
        return state.snapshots[state.currentJobId] || [];
      },

      getCurrentSnapshot: () => {
        const state = get();
        if (!state.currentJobId || !state.currentSnapshotId) return null;
        const jobSnapshots = state.snapshots[state.currentJobId] || [];
        return jobSnapshots.find((s) => s.id === state.currentSnapshotId) || null;
      },

      checkFilterChanged: () => {
        const state = get();
        const snapshot = state.getCurrentSnapshot();
        if (!snapshot) return false;
        return !areFiltersEqual(
          {
            showIgnored: state.showIgnored,
            riskLevelFilter: state.riskLevelFilter,
            ignoredRiskIds: state.ignoredRiskIds,
          },
          snapshot.filter
        );
      },

      undoLastSnapshotChange: () => {
        const state = get();
        if (state.snapshotHistory.length === 0) {
          return { success: false };
        }
        const lastEntry = state.snapshotHistory[state.snapshotHistory.length - 1];
        const restored = lastEntry.previousVersion;
        set((s) => {
          const jobSnapshots = s.snapshots[restored.jobId] || [];
          const newSnapshots = jobSnapshots.map((snap) =>
            snap.id === restored.id ? restored : snap
          );
          return {
            snapshots: {
              ...s.snapshots,
              [restored.jobId]: newSnapshots,
            },
            snapshotHistory: s.snapshotHistory.slice(0, -1),
          };
        });
        return { success: true, snapshot: restored };
      },

      canUndo: () => {
        return get().snapshotHistory.length > 0;
      },
    }),
    {
      name: "crane-replay-storage",
      partialize: (state) => ({
        job: state.job,
        cameraPresets: state.cameraPresets,
        camera: state.camera,
        annotations: state.annotations,
        ignoredRiskIds: state.ignoredRiskIds,
        showIgnored: state.showIgnored,
        riskLevelFilter: state.riskLevelFilter,
        lastImportSuccess: state.lastImportSuccess,
        lastImportFailure: state.lastImportFailure,
        snapshots: state.snapshots,
        currentSnapshotId: state.currentSnapshotId,
        currentJobId: state.currentJobId,
        snapshotHistory: state.snapshotHistory,
      }),
    }
  )
);
