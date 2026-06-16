import { create } from "zustand";
import { persist } from "zustand/middleware";
import type {
  LiftingJob,
  CameraPreset,
  Annotation,
  ValidationError,
} from "@/types";
import { precheckJob, sanitizeJob } from "@/utils/validation";

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
  annotations: Annotation[];
  ignoredRiskIds: string[];
  showIgnored: boolean;
  errors: ValidationError[];
  rightPanelOpen: boolean;
  lastImportSuccess: string | null;
  lastImportFailure: ImportFailureRecord | null;

  setJob: (job: LiftingJob | null) => void;
  importJob: (raw: unknown) => { success: boolean; errors: ValidationError[] };
  setCurrentTime: (t: number) => void;
  setIsPlaying: (p: boolean) => void;
  setPlaybackSpeed: (s: number) => void;
  addCameraPreset: (p: CameraPreset) => void;
  removeCameraPreset: (id: string) => void;
  setCameraPresets: (ps: CameraPreset[]) => void;
  addAnnotation: (a: Annotation) => void;
  updateAnnotation: (id: string, updates: Partial<Annotation>) => void;
  removeAnnotation: (id: string) => void;
  toggleIgnoreRisk: (id: string) => void;
  setShowIgnored: (v: boolean) => void;
  setErrors: (e: ValidationError[]) => void;
  addErrors: (e: ValidationError[]) => void;
  clearErrors: () => void;
  setRightPanelOpen: (v: boolean) => void;
  resetPlayback: () => void;
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

export const useStore = create<AppState>()(
  persist(
    (set) => ({
      job: null,
      currentTime: 0,
      isPlaying: false,
      playbackSpeed: 1,
      cameraPresets: defaultCameraPresets,
      annotations: [],
      ignoredRiskIds: [],
      showIgnored: true,
      errors: [],
      rightPanelOpen: true,
      lastImportSuccess: null,
      lastImportFailure: null,

      setJob: (job) =>
        set({ job, currentTime: 0, isPlaying: false, errors: [] }),
      importJob: (raw: unknown) => {
        const result = precheckJob(raw);
        if (!result.passed) {
          const failureRecord: ImportFailureRecord = {
            reason: `预检未通过，共 ${result.errors.length} 项错误`,
            errors: result.errors,
            timestamp: new Date().toISOString(),
          };
          set({ errors: result.errors, lastImportFailure: failureRecord });
          return { success: false, errors: result.errors };
        }
        const job = sanitizeJob(raw);
        set({
          job,
          currentTime: 0,
          isPlaying: false,
          errors: [],
          lastImportSuccess: new Date().toISOString(),
        });
        return { success: true, errors: [] };
      },
      setCurrentTime: (currentTime) => set({ currentTime }),
      setIsPlaying: (isPlaying) => set({ isPlaying }),
      setPlaybackSpeed: (playbackSpeed) => set({ playbackSpeed }),
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
      setErrors: (errors) => set({ errors }),
      addErrors: (e) =>
        set((s) => ({ errors: [...s.errors, ...e] })),
      clearErrors: () => set({ errors: [] }),
      setRightPanelOpen: (rightPanelOpen) => set({ rightPanelOpen }),
      resetPlayback: () => set({ currentTime: 0, isPlaying: false }),
    }),
    {
      name: "crane-replay-storage",
      partialize: (state) => ({
        job: state.job,
        cameraPresets: state.cameraPresets,
        annotations: state.annotations,
        ignoredRiskIds: state.ignoredRiskIds,
        showIgnored: state.showIgnored,
        lastImportSuccess: state.lastImportSuccess,
        lastImportFailure: state.lastImportFailure,
      }),
    }
  )
);
