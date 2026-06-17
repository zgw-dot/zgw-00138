import { create } from "zustand";
import { persist } from "zustand/middleware";
import type {
  LiftingJob,
  CameraPreset,
  Annotation,
  AnnotationTemplate,
  ValidationError,
  RiskLevelFilter,
  CameraState,
  ExportSnapshot,
  SnapshotHistoryEntry,
  ReviewSessionPackage,
  SessionPackageLogEntry,
  ImportResolution,
  ImportResult,
} from "@/types";
import { precheckJob, sanitizeJob } from "@/utils/validation";
import { createSnapshot, updateSnapshot, areFiltersEqual } from "@/utils/export";
import {
  createSessionPackage,
  updateSessionPackage,
  markPackageExpired,
  checkPackageExpired,
  canExportPackage,
  createLogEntry,
  createImportFailureLog,
  createConflictDetectedLog,
  createConflictResolutionLog,
  createAuditRestoreLog,
  createExportLog,
  createVersionIncompatibleLog,
  appendLogToPackage,
  mergeLogsFromPackage,
  mergeAndSortLogs,
  buildLogContext,
  serializePackage,
  deserializePackage,
  checkImportConflict,
  resolveImportConflict,
  restoreFromPackage,
  incrementVersion,
  CURRENT_PACKAGE_SCHEMA_VERSION,
} from "@/utils/sessionPackage";

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
  templates: AnnotationTemplate[];
  sessionPackages: Record<string, ReviewSessionPackage[]>;
  sessionPackageLogs: SessionPackageLogEntry[];
  currentPackageId: string | null;
  lastPublishId: string | null;

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
  addTemplate: (t: AnnotationTemplate) => boolean;
  updateTemplate: (id: string, updates: Partial<Omit<AnnotationTemplate, "id">>) => boolean;
  deleteTemplate: (id: string) => void;
  hasTemplateName: (name: string, excludeId?: string) => boolean;
  canUndo: () => boolean;
  checkDataChanged: () => boolean;
  isSnapshotStale: () => boolean;

  publishSessionPackage: (name: string, version: string) => ReviewSessionPackage;
  updateSessionPackage: (packageId: string, newVersion?: string) => { success: boolean; pkg?: ReviewSessionPackage };
  saveAsNewVersion: (packageId: string, customVersion?: string) => { success: boolean; pkg?: ReviewSessionPackage };
  revokeLastPublish: () => { success: boolean; pkg?: ReviewSessionPackage };
  getCurrentJobPackages: () => ReviewSessionPackage[];
  getPackageById: (packageId: string) => ReviewSessionPackage | null;
  getCurrentPackage: () => ReviewSessionPackage | null;
  setCurrentPackage: (packageId: string | null) => void;
  checkPackagesExpired: () => void;
  canExportSessionPackage: (packageId: string) => boolean;
  exportPackageToFile: (packageId: string) => string;
  importPackageFromFile: (content: string, resolution?: ImportResolution, newVersion?: string) => ImportResult;
  restoreFromPackage: (packageId: string) => { success: boolean; errors?: string[] };
  getPackageLogs: () => SessionPackageLogEntry[];
  getPackageLogsByPackageId: (packageId: string) => SessionPackageLogEntry[];
  hasPackageVersionConflict: (jobId: string, version: string) => boolean;
  isPackageExpired: (packageId: string) => boolean;
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

function checkAndMarkExpired(
  state: AppState,
  annotations: Annotation[],
  showIgnored: boolean,
  riskLevelFilter: RiskLevelFilter,
  ignoredRiskIds: string[]
): {
  sessionPackages: Record<string, ReviewSessionPackage[]>;
  newLogs: SessionPackageLogEntry[];
} {
  const jobId = state.currentJobId;
  if (!jobId) {
    return { sessionPackages: state.sessionPackages, newLogs: [] };
  }

  const jobPackages = state.sessionPackages[jobId] || [];
  const updatedPackages: ReviewSessionPackage[] = [];
  const newLogs: SessionPackageLogEntry[] = [];

  for (const pkg of jobPackages) {
    if (pkg.isExpired) {
      updatedPackages.push(pkg);
      continue;
    }

    const check = checkPackageExpired(
      pkg,
      annotations,
      showIgnored,
      riskLevelFilter,
      ignoredRiskIds
    );

    if (check.expired && check.reason) {
      const expiredPkg = markPackageExpired(pkg, check.reason);
      updatedPackages.push(expiredPkg);
      newLogs.push(
        createLogEntry(expiredPkg, "expire", true, check.reason)
      );
    } else {
      updatedPackages.push(pkg);
    }
  }

  return {
    sessionPackages: {
      ...state.sessionPackages,
      [jobId]: updatedPackages,
    },
    newLogs,
  };
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
      templates: [],
      sessionPackages: {},
      sessionPackageLogs: [],
      currentPackageId: null,
      lastPublishId: null,

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
        set((s) => {
          const newAnnotations = [...s.annotations, a];
          const updated = checkAndMarkExpired(s, newAnnotations, s.showIgnored, s.riskLevelFilter, s.ignoredRiskIds);
          return {
            annotations: newAnnotations,
            sessionPackages: updated.sessionPackages,
            sessionPackageLogs: [...s.sessionPackageLogs, ...updated.newLogs],
          };
        }),
      updateAnnotation: (id, updates) =>
        set((s) => {
          const newAnnotations = s.annotations.map((a) =>
            a.id === id ? { ...a, ...updates } : a
          );
          const updated = checkAndMarkExpired(s, newAnnotations, s.showIgnored, s.riskLevelFilter, s.ignoredRiskIds);
          return {
            annotations: newAnnotations,
            sessionPackages: updated.sessionPackages,
            sessionPackageLogs: [...s.sessionPackageLogs, ...updated.newLogs],
          };
        }),
      removeAnnotation: (id) =>
        set((s) => {
          const newAnnotations = s.annotations.filter((a) => a.id !== id);
          const updated = checkAndMarkExpired(s, newAnnotations, s.showIgnored, s.riskLevelFilter, s.ignoredRiskIds);
          return {
            annotations: newAnnotations,
            sessionPackages: updated.sessionPackages,
            sessionPackageLogs: [...s.sessionPackageLogs, ...updated.newLogs],
          };
        }),
      toggleIgnoreRisk: (id) =>
        set((s) => {
          const newIgnored = s.ignoredRiskIds.includes(id)
            ? s.ignoredRiskIds.filter((i) => i !== id)
            : [...s.ignoredRiskIds, id];
          const updated = checkAndMarkExpired(s, s.annotations, s.showIgnored, s.riskLevelFilter, newIgnored);
          return {
            ignoredRiskIds: newIgnored,
            sessionPackages: updated.sessionPackages,
            sessionPackageLogs: [...s.sessionPackageLogs, ...updated.newLogs],
          };
        }),
      setShowIgnored: (showIgnored) =>
        set((s) => {
          const updated = checkAndMarkExpired(s, s.annotations, showIgnored, s.riskLevelFilter, s.ignoredRiskIds);
          return {
            showIgnored,
            sessionPackages: updated.sessionPackages,
            sessionPackageLogs: [...s.sessionPackageLogs, ...updated.newLogs],
          };
        }),
      setRiskLevelFilter: (filter) =>
        set((s) => {
          const newFilter = { ...s.riskLevelFilter, ...filter };
          const updated = checkAndMarkExpired(s, s.annotations, s.showIgnored, newFilter, s.ignoredRiskIds);
          return {
            riskLevelFilter: newFilter,
            sessionPackages: updated.sessionPackages,
            sessionPackageLogs: [...s.sessionPackageLogs, ...updated.newLogs],
          };
        }),
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

      addTemplate: (t: AnnotationTemplate) => {
        const state = get();
        if (state.templates.some((tpl) => tpl.name === t.name)) {
          return false;
        }
        set({ templates: [...state.templates, t] });
        return true;
      },

      updateTemplate: (id: string, updates: Partial<Omit<AnnotationTemplate, "id">>) => {
        const state = get();
        if (updates.name !== undefined) {
          const duplicate = state.templates.some(
            (tpl) => tpl.name === updates.name && tpl.id !== id
          );
          if (duplicate) return false;
        }
        set({
          templates: state.templates.map((tpl) =>
            tpl.id === id ? { ...tpl, ...updates } : tpl
          ),
        });
        return true;
      },

      deleteTemplate: (id: string) => {
        set((s) => ({
          templates: s.templates.filter((tpl) => tpl.id !== id),
        }));
      },

      hasTemplateName: (name: string, excludeId?: string) => {
        return get().templates.some(
          (tpl) => tpl.name === name && tpl.id !== excludeId
        );
      },

      canUndo: () => {
        return get().snapshotHistory.length > 0;
      },

      checkDataChanged: () => {
        const state = get();
        const snapshot = state.getCurrentSnapshot();
        if (!snapshot) return false;
        const currentIds = new Set(state.annotations.map((a) => a.id));
        const snapshotIds = new Set(snapshot.annotations.map((a) => a.id));
        if (currentIds.size !== snapshotIds.size) return true;
        for (const id of currentIds) {
          if (!snapshotIds.has(id)) return true;
        }
        for (const id of snapshotIds) {
          if (!currentIds.has(id)) return true;
        }
        for (const ann of state.annotations) {
          const snapAnn = snapshot.annotations.find((a) => a.id === ann.id);
          if (!snapAnn) return true;
          if (
            ann.riskLevel !== snapAnn.riskLevel ||
            ann.text !== snapAnn.text ||
            ann.ignored !== snapAnn.ignored ||
            ann.templateSourceId !== snapAnn.templateSourceId ||
            ann.templateSourceName !== snapAnn.templateSourceName
          ) {
            return true;
          }
        }
        return false;
      },

      isSnapshotStale: () => {
        const state = get();
        return state.checkDataChanged() || state.checkFilterChanged();
      },

      publishSessionPackage: (name: string, version: string) => {
        const state = get();
        if (!state.job) {
          throw new Error("没有加载作业，无法发布会话包");
        }

        const jobId = getJobId(state.job);
        if (state.hasPackageVersionConflict(jobId, version)) {
          throw new Error(`版本号 ${version} 已存在，请使用其他版本号`);
        }

        const pkg = createSessionPackage(
          state.job,
          state.annotations,
          state.currentTime,
          state.camera,
          state.showIgnored,
          state.riskLevelFilter,
          state.ignoredRiskIds,
          state.templates,
          name,
          version
        );

        const logContext = buildLogContext(
          state.currentTime,
          state.camera,
          state.showIgnored,
          state.riskLevelFilter,
          state.ignoredRiskIds,
          state.annotations,
          state.templates
        );

        const logEntry = createLogEntry(pkg, "publish", true, "发布会话包成功", logContext);
        const pkgWithLog = appendLogToPackage(pkg, logEntry);

        set((s) => {
          const jobPackages = s.sessionPackages[jobId] || [];
          return {
            sessionPackages: {
              ...s.sessionPackages,
              [jobId]: [...jobPackages, pkgWithLog],
            },
            currentPackageId: pkgWithLog.id,
            lastPublishId: pkgWithLog.id,
            sessionPackageLogs: [...s.sessionPackageLogs, logEntry],
          };
        });

        return pkgWithLog;
      },

      updateSessionPackage: (packageId: string, newVersion?: string) => {
        const state = get();
        if (!state.job) {
          return { success: false };
        }

        const pkg = state.getPackageById(packageId);
        if (!pkg) {
          return { success: false };
        }

        if (newVersion && state.hasPackageVersionConflict(pkg.jobId, newVersion)) {
          return { success: false };
        }

        const updated = updateSessionPackage(
          pkg,
          state.job,
          state.annotations,
          state.currentTime,
          state.camera,
          state.showIgnored,
          state.riskLevelFilter,
          state.ignoredRiskIds,
          state.templates,
          newVersion
        );

        const logContext = buildLogContext(
          state.currentTime,
          state.camera,
          state.showIgnored,
          state.riskLevelFilter,
          state.ignoredRiskIds,
          state.annotations,
          state.templates
        );

        const logEntry = createLogEntry(updated, "update", true, "更新会话包成功", logContext);
        const updatedWithLog = appendLogToPackage(updated, logEntry);

        set((s) => {
          const jobPackages = s.sessionPackages[pkg.jobId] || [];
          const newPackages = jobPackages.map((p) =>
            p.id === pkg.id ? updatedWithLog : p
          );
          return {
            sessionPackages: {
              ...s.sessionPackages,
              [pkg.jobId]: newPackages,
            },
            sessionPackageLogs: [...s.sessionPackageLogs, logEntry],
          };
        });

        return { success: true, pkg: updatedWithLog };
      },

      saveAsNewVersion: (packageId: string, customVersion?: string) => {
        const state = get();
        if (!state.job) {
          return { success: false };
        }

        const existingPkg = state.getPackageById(packageId);
        if (!existingPkg) {
          return { success: false };
        }

        const newVersion = customVersion || incrementVersion(existingPkg.version);
        if (state.hasPackageVersionConflict(existingPkg.jobId, newVersion)) {
          return { success: false };
        }

        const newPkg = createSessionPackage(
          state.job,
          state.annotations,
          state.currentTime,
          state.camera,
          state.showIgnored,
          state.riskLevelFilter,
          state.ignoredRiskIds,
          state.templates,
          existingPkg.name,
          newVersion
        );

        const logContext = buildLogContext(
          state.currentTime,
          state.camera,
          state.showIgnored,
          state.riskLevelFilter,
          state.ignoredRiskIds,
          state.annotations,
          state.templates
        );

        const logEntry = createLogEntry(newPkg, "save_as", true, `另存新版本 ${newVersion} 成功`, logContext);
        const newPkgWithLog = appendLogToPackage(newPkg, logEntry);

        set((s) => {
          const jobPackages = s.sessionPackages[existingPkg.jobId] || [];
          return {
            sessionPackages: {
              ...s.sessionPackages,
              [existingPkg.jobId]: [...jobPackages, newPkgWithLog],
            },
            currentPackageId: newPkgWithLog.id,
            lastPublishId: newPkgWithLog.id,
            sessionPackageLogs: [...s.sessionPackageLogs, logEntry],
          };
        });

        return { success: true, pkg: newPkgWithLog };
      },

      revokeLastPublish: () => {
        const state = get();
        if (!state.lastPublishId) {
          return { success: false };
        }

        const pkg = state.getPackageById(state.lastPublishId);
        if (!pkg) {
          return { success: false };
        }

        const expiredPkg = markPackageExpired(pkg, "已撤销发布");

        const logEntry = createLogEntry(expiredPkg, "revoke", true, "撤销发布成功");
        const expiredWithLog = appendLogToPackage(expiredPkg, logEntry);

        set((s) => {
          const jobPackages = s.sessionPackages[pkg.jobId] || [];
          const newPackages = jobPackages.map((p) =>
            p.id === pkg.id ? expiredWithLog : p
          );
          return {
            sessionPackages: {
              ...s.sessionPackages,
              [pkg.jobId]: newPackages,
            },
            lastPublishId: null,
            sessionPackageLogs: [...s.sessionPackageLogs, logEntry],
          };
        });

        return { success: true, pkg: expiredWithLog };
      },

      getCurrentJobPackages: () => {
        const state = get();
        if (!state.currentJobId) return [];
        return state.sessionPackages[state.currentJobId] || [];
      },

      getPackageById: (packageId: string) => {
        const state = get();
        for (const jobPackages of Object.values(state.sessionPackages)) {
          const pkg = jobPackages.find((p) => p.id === packageId);
          if (pkg) return pkg;
        }
        return null;
      },

      getCurrentPackage: () => {
        const state = get();
        if (!state.currentPackageId) return null;
        return state.getPackageById(state.currentPackageId);
      },

      setCurrentPackage: (packageId: string | null) => {
        set({ currentPackageId: packageId });
      },

      checkPackagesExpired: () => {
        const state = get();
        const jobId = state.currentJobId;
        if (!jobId) return;

        const jobPackages = state.sessionPackages[jobId] || [];
        const updatedPackages: ReviewSessionPackage[] = [];
        const newLogs: SessionPackageLogEntry[] = [];

        for (const pkg of jobPackages) {
          if (pkg.isExpired) {
            updatedPackages.push(pkg);
            continue;
          }

          const check = checkPackageExpired(
            pkg,
            state.annotations,
            state.showIgnored,
            state.riskLevelFilter,
            state.ignoredRiskIds
          );

          if (check.expired && check.reason) {
            const expiredPkg = markPackageExpired(pkg, check.reason);
            updatedPackages.push(expiredPkg);
            newLogs.push(
              createLogEntry(expiredPkg, "expire", true, check.reason)
            );
          } else {
            updatedPackages.push(pkg);
          }
        }

        if (newLogs.length > 0) {
          set((s) => ({
            sessionPackages: {
              ...s.sessionPackages,
              [jobId]: updatedPackages,
            },
            sessionPackageLogs: [...s.sessionPackageLogs, ...newLogs],
          }));
        }
      },

      canExportSessionPackage: (packageId: string) => {
        const pkg = get().getPackageById(packageId);
        if (!pkg) return false;
        return canExportPackage(pkg);
      },

      exportPackageToFile: (packageId: string) => {
        const state = get();
        const pkg = get().getPackageById(packageId);
        if (!pkg) {
          throw new Error("会话包不存在");
        }
        if (!canExportPackage(pkg)) {
          throw new Error("会话包已过期，无法导出");
        }

        const logContext = buildLogContext(
          state.currentTime,
          state.camera,
          state.showIgnored,
          state.riskLevelFilter,
          state.ignoredRiskIds,
          state.annotations,
          state.templates
        );
        const exportLog = createExportLog(pkg, logContext);
        const pkgWithLog = appendLogToPackage(pkg, exportLog);

        set((s) => {
          const jobPackages = s.sessionPackages[pkg.jobId] || [];
          const newPackages = jobPackages.map((p) =>
            p.id === pkg.id ? pkgWithLog : p
          );
          return {
            sessionPackages: {
              ...s.sessionPackages,
              [pkg.jobId]: newPackages,
            },
            sessionPackageLogs: [...s.sessionPackageLogs, exportLog],
          };
        });

        return serializePackage(pkgWithLog);
      },

      importPackageFromFile: (content: string, resolution?: ImportResolution, newVersion?: string) => {
        const state = get();
        const result = deserializePackage(content);

        if (!result.valid || !result.pkg) {
          const isIncompatibility = result.errors.some(
            (e) => e.includes("版本不兼容") && e.includes("无法导入")
          );
          if (isIncompatibility) {
            const schemaVersion = (() => {
              try {
                const raw = JSON.parse(content);
                return raw?.schemaVersion;
              } catch {
                return undefined;
              }
            })();
            const viLog = createVersionIncompatibleLog(
              schemaVersion,
              CURRENT_PACKAGE_SCHEMA_VERSION,
              result.errors.find((e) => e.includes("版本不兼容"))!
            );
            set((s) => ({
              sessionPackageLogs: [...s.sessionPackageLogs, viLog],
            }));
          } else {
            const logEntry = createImportFailureLog(
              "unknown",
              "unknown",
              `导入失败: ${result.errors.join(", ")}`
            );
            set((s) => ({
              sessionPackageLogs: [...s.sessionPackageLogs, logEntry],
            }));
          }
          return { success: false, errors: result.errors };
        }

        let incoming = result.pkg;
        const allPackages = Object.values(state.sessionPackages).flat();
        const conflict = checkImportConflict(incoming, allPackages);

        const pendingLogs: SessionPackageLogEntry[] = [];

        if (conflict) {
          const conflictDetectedLog = createConflictDetectedLog(
            conflict.existingPackage,
            incoming
          );
          pendingLogs.push(conflictDetectedLog);
          incoming = appendLogToPackage(incoming, conflictDetectedLog);

          if (!resolution) {
            set((s) => ({
              sessionPackageLogs: [...s.sessionPackageLogs, conflictDetectedLog],
            }));
            return { success: false, conflict };
          }

          const resolutionLog = createConflictResolutionLog(
            incoming,
            resolution,
            newVersion
          );
          pendingLogs.push(resolutionLog);
          incoming = appendLogToPackage(incoming, resolutionLog);

          const resolved = resolveImportConflict(
            incoming,
            conflict.existingPackage,
            resolution,
            newVersion
          );

          if (!resolved) {
            set((s) => ({
              sessionPackageLogs: [...s.sessionPackageLogs, ...pendingLogs],
            }));
            return { success: false };
          }

          incoming.id = resolved.id;
          incoming.version = resolved.version;
        }

        const importLog = createLogEntry(incoming, "import", true, "导入会话包成功");
        pendingLogs.push(importLog);
        incoming = appendLogToPackage(incoming, importLog);

        set((s) => {
          const jobPackages = s.sessionPackages[incoming.jobId] || [];
          const existingIndex = jobPackages.findIndex((p) => p.id === incoming.id);
          let newPackages;
          if (existingIndex >= 0) {
            newPackages = [...jobPackages];
            newPackages[existingIndex] = incoming;
          } else {
            newPackages = [...jobPackages, incoming];
          }

          const mergedLogs = mergeAndSortLogs(
            s.sessionPackageLogs,
            incoming.operationLogs || []
          );
          const finalLogs = [...mergedLogs];
          const existingLogIds = new Set(finalLogs.map((l) => l.id));
          for (const pl of pendingLogs) {
            if (!existingLogIds.has(pl.id)) {
              finalLogs.push(pl);
              existingLogIds.add(pl.id);
            }
          }

          return {
            sessionPackages: {
              ...s.sessionPackages,
              [incoming.jobId]: newPackages,
            },
            sessionPackageLogs: finalLogs,
          };
        });

        return { success: true, package: incoming };
      },

      restoreFromPackage: (packageId: string) => {
        const state = get();
        const pkg = state.getPackageById(packageId);
        if (!pkg) {
          return { success: false, errors: ["会话包不存在"] };
        }

        try {
          const restored = restoreFromPackage(pkg);
          const jobId = getJobId(restored.job);

          const packageLogs = restored.operationLogs || [];
          const existingLogIds = new Set(state.sessionPackageLogs.map((l) => l.id));
          const newLogsFromPackage = packageLogs.filter((l) => !existingLogIds.has(l.id));
          const restoredLogIds = newLogsFromPackage.map((l) => l.id);

          const logContext = buildLogContext(
            state.currentTime,
            state.camera,
            state.showIgnored,
            state.riskLevelFilter,
            state.ignoredRiskIds,
            state.annotations,
            state.templates
          );

          const auditLog = createAuditRestoreLog(
            pkg,
            newLogsFromPackage.length,
            restoredLogIds,
            logContext
          );
          const pkgWithLog = appendLogToPackage(pkg, auditLog);

          set((s) => {
            const jobPackages = s.sessionPackages[pkg.jobId] || [];
            const newPackages = jobPackages.map((p) =>
              p.id === pkg.id ? pkgWithLog : p
            );

            const mergedWithPackage = mergeAndSortLogs(
              s.sessionPackageLogs,
              packageLogs
            );
            const finalLogs = [...mergedWithPackage, auditLog];

            return {
              job: restored.job,
              currentTime: restored.currentTime,
              camera: restored.camera,
              annotations: restored.annotations,
              ignoredRiskIds: restored.ignoredRiskIds,
              showIgnored: restored.showIgnored,
              riskLevelFilter: restored.riskLevelFilter,
              templates: restored.templates,
              currentJobId: jobId,
              currentPackageId: packageId,
              isPlaying: false,
              sessionPackages: {
                ...s.sessionPackages,
                [pkg.jobId]: newPackages,
              },
              sessionPackageLogs: finalLogs,
            };
          });

          return { success: true };
        } catch (e) {
          return { success: false, errors: [(e as Error).message] };
        }
      },

      getPackageLogs: () => {
        return get().sessionPackageLogs;
      },

      getPackageLogsByPackageId: (packageId: string) => {
        return get().sessionPackageLogs.filter((log) => log.packageId === packageId);
      },

      hasPackageVersionConflict: (jobId: string, version: string) => {
        const state = get();
        const jobPackages = state.sessionPackages[jobId] || [];
        return jobPackages.some((p) => p.version === version);
      },

      isPackageExpired: (packageId: string) => {
        const pkg = get().getPackageById(packageId);
        return pkg?.isExpired ?? false;
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
        templates: state.templates,
        sessionPackages: state.sessionPackages,
        sessionPackageLogs: state.sessionPackageLogs,
        currentPackageId: state.currentPackageId,
        lastPublishId: state.lastPublishId,
      }),
    }
  )
);
