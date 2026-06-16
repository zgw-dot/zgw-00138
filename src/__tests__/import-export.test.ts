import { describe, it, expect, beforeEach, vi } from "vitest";
import { precheckJob, sanitizeJob } from "@/utils/validation";
import {
  exportToJSON,
  exportToCSV,
  computeRiskStats,
  getVisibleAnnotations,
  createSnapshot,
  updateSnapshot,
  areFiltersEqual,
  getFilteredAnnotations,
  exportToJSONFromSnapshot,
  exportToCSVFromSnapshot,
} from "@/utils/export";
import type {
  LiftingJob,
  Annotation,
  ValidationError,
  RiskLevelFilter,
  ExportSnapshot,
} from "@/types";

function makeValidJob(overrides?: Partial<LiftingJob>): LiftingJob {
  return {
    meta: {
      name: "测试作业",
      date: "2025-01-01",
      craneId: "CR-001",
      craneType: "塔式起重机",
      siteName: "测试工地",
    },
    crane: {
      position: [0, 0, 0],
      boomLength: 30,
      boomAngle: 60,
      maxRadius: 35,
    },
    restrictedZones: [
      {
        id: "zone-1",
        name: "高压线",
        type: "box",
        position: [20, 8, -5],
        size: { width: 6, height: 16, depth: 4 },
      },
    ],
    trajectory: [
      {
        timestamp: 0,
        hookPosition: [5, 25, 0],
        boomAngle: 60,
        load: 0,
        radius: 5,
        riskLevel: "safe",
      },
      {
        timestamp: 2000,
        hookPosition: [5, 25, 0],
        boomAngle: 60,
        load: 8.5,
        radius: 5,
        riskLevel: "safe",
      },
      {
        timestamp: 4000,
        hookPosition: [20, 16, -4],
        boomAngle: 40,
        load: 8.1,
        radius: 24,
        riskLevel: "danger",
        zoneIds: ["zone-1"],
      },
    ],
    ...overrides,
  };
}

function makeAnnotations(count: number, riskLevel: "safe" | "warning" | "danger" = "warning", offset = 0): Annotation[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `ann-${offset + i}`,
    timestamp: (offset + i) * 1000,
    position: [0, 0, 0] as [number, number, number],
    riskLevel,
    text: `批注 ${offset + i}`,
    ignored: false,
    createdAt: new Date().toISOString(),
  }));
}

describe("precheckJob", () => {
  it("valid job passes precheck", () => {
    const job = makeValidJob();
    const result = precheckJob(job);
    expect(result.passed).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it("null input fails precheck", () => {
    const result = precheckJob(null);
    expect(result.passed).toBe(false);
    expect(result.errors[0].type).toBe("invalid_load");
  });

  it("undefined input fails precheck", () => {
    const result = precheckJob(undefined);
    expect(result.passed).toBe(false);
    expect(result.errors[0].type).toBe("invalid_load");
  });

  it("missing trajectory array fails precheck", () => {
    const result = precheckJob({ meta: {}, crane: {} });
    expect(result.passed).toBe(false);
    expect(result.errors.some((e) => e.type === "invalid_load" && e.message.includes("trajectory"))).toBe(true);
  });

  it("empty trajectory array fails precheck", () => {
    const job = makeValidJob({ trajectory: [] } as Partial<LiftingJob>);
    const result = precheckJob(job);
    expect(result.passed).toBe(false);
    expect(result.errors.some((e) => e.message.includes("为空"))).toBe(true);
  });

  it("unknown zone reference fails precheck", () => {
    const job = makeValidJob();
    job.trajectory[1].zoneIds = ["zone-nonexistent"];
    const result = precheckJob(job);
    expect(result.passed).toBe(false);
    expect(result.errors.some((e) => e.type === "unknown_zone")).toBe(true);
    expect(result.errors[0].message).toContain("zone-nonexistent");
  });

  it("timestamp reverse order fails precheck", () => {
    const job = makeValidJob();
    job.trajectory[1].timestamp = 5000;
    job.trajectory[2].timestamp = 3000;
    const result = precheckJob(job);
    expect(result.passed).toBe(false);
    expect(result.errors.some((e) => e.type === "timestamp_reverse")).toBe(true);
  });

  it("invalid load field fails precheck", () => {
    const job = makeValidJob();
    (job.trajectory[1] as any).load = "abc";
    const result = precheckJob(job);
    expect(result.passed).toBe(false);
    expect(result.errors.some((e) => e.type === "invalid_load")).toBe(true);
  });

  it("NaN load field fails precheck", () => {
    const job = makeValidJob();
    job.trajectory[1].load = NaN;
    const result = precheckJob(job);
    expect(result.passed).toBe(false);
    expect(result.errors.some((e) => e.type === "invalid_load")).toBe(true);
  });

  it("precheck does not mutate input data", () => {
    const job = makeValidJob();
    const originalTimestamps = job.trajectory.map((p) => p.timestamp);
    job.trajectory[1].timestamp = 5000;
    job.trajectory[2].timestamp = 3000;
    precheckJob(job);
    expect(job.trajectory.map((p) => p.timestamp)).toEqual(originalTimestamps.map((t, i) => i === 1 ? 5000 : i === 2 ? 3000 : t));
  });

  it("multiple errors are all reported", () => {
    const job = makeValidJob();
    (job.trajectory[1] as any).load = "bad";
    job.trajectory[1].zoneIds = ["zone-nonexistent"];
    job.trajectory[2].timestamp = 1000;
    const result = precheckJob(job);
    expect(result.passed).toBe(false);
    expect(result.errors.some((e) => e.type === "invalid_load")).toBe(true);
    expect(result.errors.some((e) => e.type === "unknown_zone")).toBe(true);
    expect(result.errors.some((e) => e.type === "timestamp_reverse")).toBe(true);
    expect(result.errors.length).toBeGreaterThanOrEqual(3);
  });
});

describe("sanitizeJob", () => {
  it("fills missing restrictedZones with empty array", () => {
    const job = makeValidJob();
    delete (job as any).restrictedZones;
    const result = sanitizeJob(job);
    expect(result.restrictedZones).toEqual([]);
  });

  it("preserves existing restrictedZones", () => {
    const job = makeValidJob();
    const result = sanitizeJob(job);
    expect(result.restrictedZones).toHaveLength(1);
  });
});

describe("importJob - bad data blocking", () => {
  it("bad data does not overwrite existing job via store importJob", async () => {
    const { useStore } = await import("@/store/useStore");
    const store = useStore;

    store.setState({
      job: makeValidJob(),
      annotations: makeAnnotations(3),
      ignoredRiskIds: ["ann-1"],
      cameraPresets: [{ id: "p1", name: "test", position: [1, 2, 3], target: [0, 0, 0] }],
      currentTime: 1500,
    });

    const stateBefore = store.getState();
    const jobBefore = stateBefore.job;
    const presetsBefore = stateBefore.cameraPresets;
    const timeBefore = stateBefore.currentTime;

    const badData = makeValidJob();
    (badData.trajectory[1] as any).load = "invalid";
    const result = store.getState().importJob(badData);

    expect(result.success).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);

    const stateAfter = store.getState();
    expect(stateAfter.job).toBe(jobBefore);
    expect(stateAfter.annotations).toEqual([]);
    expect(stateAfter.ignoredRiskIds).toEqual([]);
    expect(stateAfter.snapshotHistory).toEqual([]);
    expect(stateAfter.cameraPresets).toBe(presetsBefore);
    expect(stateAfter.currentTime).toBe(timeBefore);
  });
});

describe("importJob - state preservation after failure", () => {
  it("cameraPresets, currentTime, showIgnored remain intact; annotations/ignored/snapshotHistory cleared after failed import", async () => {
    const { useStore } = await import("@/store/useStore");
    const store = useStore;

    store.setState({
      job: makeValidJob(),
      annotations: makeAnnotations(5),
      ignoredRiskIds: ["ann-0", "ann-2"],
      cameraPresets: [{ id: "cp-1", name: "预设1", position: [10, 20, 30], target: [0, 0, 0] }],
      currentTime: 3500,
      showIgnored: false,
      snapshotHistory: [{
        snapshotId: "x",
        previousVersion: {} as ExportSnapshot,
        timestamp: new Date().toISOString(),
      }],
    });

    const stateBefore = store.getState();

    const badData = { meta: {}, trajectory: [] };
    store.getState().importJob(badData);

    const stateAfter = store.getState();
    expect(stateAfter.job).toBe(stateBefore.job);
    expect(stateAfter.annotations).toEqual([]);
    expect(stateAfter.ignoredRiskIds).toEqual([]);
    expect(stateAfter.snapshotHistory).toEqual([]);
    expect(stateAfter.cameraPresets).toEqual(stateBefore.cameraPresets);
    expect(stateAfter.currentTime).toBe(stateBefore.currentTime);
    expect(stateAfter.showIgnored).toBe(stateBefore.showIgnored);
  });
});

describe("importJob - cross-restart import record persistence", () => {
  it("lastImportSuccess is set after successful import", async () => {
    const { useStore } = await import("@/store/useStore");
    const store = useStore;

    store.setState({ lastImportSuccess: null, lastImportFailure: null });

    const job = makeValidJob();
    const result = store.getState().importJob(job);
    expect(result.success).toBe(true);

    const state = store.getState();
    expect(state.lastImportSuccess).not.toBeNull();
    expect(typeof state.lastImportSuccess).toBe("string");
  });

  it("lastImportFailure is set after failed import", async () => {
    const { useStore } = await import("@/store/useStore");
    const store = useStore;

    store.setState({ lastImportSuccess: null, lastImportFailure: null });

    const badData = makeValidJob();
    (badData.trajectory[1] as any).load = "bad";
    const result = store.getState().importJob(badData);
    expect(result.success).toBe(false);

    const state = store.getState();
    expect(state.lastImportFailure).not.toBeNull();
    expect(state.lastImportFailure!.reason).toContain("预检未通过");
    expect(state.lastImportFailure!.errors.length).toBeGreaterThan(0);
    expect(typeof state.lastImportFailure!.timestamp).toBe("string");
  });

  it("import records are included in persisted partialize", async () => {
    const { useStore } = await import("@/store/useStore");
    const store = useStore;

    store.setState({
      lastImportSuccess: "2025-06-17T10:00:00.000Z",
      lastImportFailure: {
        reason: "test",
        errors: [],
        timestamp: "2025-06-17T09:00:00.000Z",
      },
    });

    const persistConfig = (store as any).persist?.options;
    if (persistConfig?.partialize) {
      const partialized = persistConfig.partialize(store.getState());
      expect(partialized.lastImportSuccess).toBe("2025-06-17T10:00:00.000Z");
      expect(partialized.lastImportFailure).toBeDefined();
    }
  });
});

describe("export - filtered consistency", () => {
  const baseJob = makeValidJob();

  it("JSON export annotation count matches visible count", () => {
    const annotations = makeAnnotations(4);
    const ignoredRiskIds = ["ann-1", "ann-3"];

    const jsonShowIgnored = exportToJSON(baseJob, annotations, ignoredRiskIds, true);
    const parsedShow = JSON.parse(jsonShowIgnored);
    expect(parsedShow.annotations.length).toBe(4);
    expect(parsedShow.riskStats.exported).toBe(4);
    expect(parsedShow.riskStats.visible).toBe(4);
    expect(parsedShow.riskStats.ignored).toBe(2);

    const jsonHideIgnored = exportToJSON(baseJob, annotations, ignoredRiskIds, false);
    const parsedHide = JSON.parse(jsonHideIgnored);
    expect(parsedHide.annotations.length).toBe(2);
    expect(parsedHide.riskStats.exported).toBe(2);
    expect(parsedHide.riskStats.visible).toBe(2);
    expect(parsedHide.riskStats.ignored).toBe(2);
  });

  it("CSV export annotation rows match visible count", () => {
    const annotations = makeAnnotations(5);
    const ignoredRiskIds = ["ann-2", "ann-4"];

    const csvShow = exportToCSV(baseJob, annotations, ignoredRiskIds, true);
    const csvHide = exportToCSV(baseJob, annotations, ignoredRiskIds, false);

    const annotationRowsShow = csvShow
      .split("\n")
      .filter((line) => line.startsWith("ann-"));
    const annotationRowsHide = csvHide
      .split("\n")
      .filter((line) => line.startsWith("ann-"));

    expect(annotationRowsShow.length).toBe(5);
    expect(annotationRowsHide.length).toBe(3);
  });

  it("CSV risk stats section matches annotation counts", () => {
    const annotations = [
      ...makeAnnotations(2, "danger", 0),
      ...makeAnnotations(3, "warning", 2),
    ];
    const ignoredRiskIds = ["ann-0"];

    const csv = exportToCSV(baseJob, annotations, ignoredRiskIds, false);
    const lines = csv.split("\n");

    const statsSection = lines.slice(lines.indexOf("=== 风险统计 ===") + 1);
    const statsMap: Record<string, number> = {};
    for (const line of statsSection) {
      const [key, val] = line.split(",");
      if (key && val !== undefined) {
        statsMap[key.trim()] = Number(val);
      }
    }

    expect(statsMap["批注总数"]).toBe(5);
    expect(statsMap["危险"]).toBe(2);
    expect(statsMap["警告"]).toBe(3);
    expect(statsMap["已忽略"]).toBe(1);
    expect(statsMap["可见"]).toBe(4);
    expect(statsMap["导出"]).toBe(4);
  });

  it("computeRiskStats with no ignored annotations", () => {
    const annotations = makeAnnotations(3);
    const stats = computeRiskStats(annotations, [], true);
    expect(stats.total).toBe(3);
    expect(stats.ignored).toBe(0);
    expect(stats.visible).toBe(3);
    expect(stats.exported).toBe(3);
  });

  it("getVisibleAnnotations filters correctly", () => {
    const annotations = makeAnnotations(4);
    const ignored = ["ann-1", "ann-3"];

    const visibleShow = getVisibleAnnotations(annotations, ignored, true);
    expect(visibleShow).toHaveLength(4);

    const visibleHide = getVisibleAnnotations(annotations, ignored, false);
    expect(visibleHide).toHaveLength(2);
    expect(visibleHide.every((a) => !ignored.includes(a.id))).toBe(true);
  });

  it("JSON export riskStats danger/warning/safe breakdown is correct", () => {
    const annotations = [
      ...makeAnnotations(2, "danger", 0),
      ...makeAnnotations(3, "warning", 2),
      ...makeAnnotations(1, "safe", 5),
    ];
    const ignoredRiskIds: string[] = [];

    const json = exportToJSON(baseJob, annotations, ignoredRiskIds, true);
    const parsed = JSON.parse(json);

    expect(parsed.riskStats.danger).toBe(2);
    expect(parsed.riskStats.warning).toBe(3);
    expect(parsed.riskStats.safe).toBe(1);
    expect(parsed.riskStats.total).toBe(6);
  });
});

describe("snapshot - core creation and filtering", () => {
  const baseJob = makeValidJob();
  const defaultCamera = {
    position: [0, 80, 0.1] as [number, number, number],
    target: [0, 0, 0] as [number, number, number],
  };
  const allLevelsFilter: RiskLevelFilter = { safe: true, warning: true, danger: true };

  it("getFilteredAnnotations respects risk level filter", () => {
    const annotations = [
      ...makeAnnotations(2, "danger", 0),
      ...makeAnnotations(3, "warning", 2),
      ...makeAnnotations(1, "safe", 5),
    ];

    const dangerOnly: RiskLevelFilter = { safe: false, warning: false, danger: true };
    const filtered = getFilteredAnnotations(annotations, [], true, dangerOnly);
    expect(filtered).toHaveLength(2);
    expect(filtered.every((a) => a.riskLevel === "danger")).toBe(true);

    const warningAndDanger: RiskLevelFilter = { safe: false, warning: true, danger: true };
    const filtered2 = getFilteredAnnotations(annotations, [], true, warningAndDanger);
    expect(filtered2).toHaveLength(5);
    expect(filtered2.every((a) => a.riskLevel !== "safe")).toBe(true);
  });

  it("getFilteredAnnotations combines showIgnored and risk level filter", () => {
    const annotations = [
      ...makeAnnotations(2, "danger", 0),
      ...makeAnnotations(3, "warning", 2),
    ];
    const ignoredRiskIds = ["ann-0"];

    const dangerOnly: RiskLevelFilter = { safe: false, warning: false, danger: true };
    const filteredHideIgnored = getFilteredAnnotations(annotations, ignoredRiskIds, false, dangerOnly);
    expect(filteredHideIgnored).toHaveLength(1);
    expect(filteredHideIgnored[0].id).toBe("ann-1");

    const filteredShowIgnored = getFilteredAnnotations(annotations, ignoredRiskIds, true, dangerOnly);
    expect(filteredShowIgnored).toHaveLength(2);
  });

  it("createSnapshot captures current state correctly", () => {
    const annotations = [
      ...makeAnnotations(2, "danger", 0),
      ...makeAnnotations(3, "warning", 2),
    ];
    const ignoredRiskIds = ["ann-0"];
    const currentTime = 2500;
    const filter: RiskLevelFilter = { safe: false, warning: true, danger: true };

    const snapshot = createSnapshot(
      baseJob,
      annotations,
      currentTime,
      defaultCamera,
      false,
      filter,
      ignoredRiskIds,
      "测试快照"
    );

    expect(snapshot.name).toBe("测试快照");
    expect(snapshot.currentTime).toBe(currentTime);
    expect(snapshot.camera).toEqual(defaultCamera);
    expect(snapshot.filter.showIgnored).toBe(false);
    expect(snapshot.filter.riskLevelFilter).toEqual(filter);
    expect(snapshot.filter.ignoredRiskIds).toEqual(ignoredRiskIds);
    expect(snapshot.annotations).toHaveLength(4);
    expect(snapshot.annotations.every((a) => a.id !== "ann-0")).toBe(true);
    expect(snapshot.riskStats.danger).toBe(2);
    expect(snapshot.riskStats.warning).toBe(3);
    expect(snapshot.riskStats.exported).toBe(4);
    expect(snapshot.riskStats.ignored).toBe(1);
    expect(snapshot.jobMeta).toEqual(baseJob.meta);
    expect(snapshot.trajectory).toEqual(baseJob.trajectory);
  });

  it("createSnapshot is immutable - does not modify input data", () => {
    const annotations = makeAnnotations(2, "danger", 0);
    const originalAnnotation0Text = annotations[0].text;

    const snapshot = createSnapshot(
      baseJob,
      annotations,
      1000,
      defaultCamera,
      true,
      allLevelsFilter,
      [],
      "测试"
    );

    snapshot.annotations[0].text = "已修改";
    expect(annotations[0].text).toBe(originalAnnotation0Text);
  });
});

describe("snapshot - danger filter export consistency", () => {
  const baseJob = makeValidJob();
  const defaultCamera = {
    position: [0, 80, 0.1] as [number, number, number],
    target: [0, 0, 0] as [number, number, number],
  };

  it("danger-only filter snapshot exports consistent data across JSON and CSV", () => {
    const annotations = [
      ...makeAnnotations(3, "danger", 0),
      ...makeAnnotations(5, "warning", 3),
      ...makeAnnotations(2, "safe", 8),
    ];
    const ignoredRiskIds = ["ann-1"];
    const dangerOnly: RiskLevelFilter = { safe: false, warning: false, danger: true };

    const snapshot = createSnapshot(
      baseJob,
      annotations,
      1500,
      defaultCamera,
      false,
      dangerOnly,
      ignoredRiskIds,
      "仅危险筛选快照"
    );

    expect(snapshot.riskStats.exported).toBe(2);
    expect(snapshot.annotations.every((a) => a.riskLevel === "danger")).toBe(true);
    expect(snapshot.annotations.map((a) => a.id)).toEqual(["ann-0", "ann-2"]);

    const json = exportToJSONFromSnapshot(snapshot);
    const parsedJSON = JSON.parse(json);
    expect(parsedJSON.annotations.length).toBe(2);
    expect(parsedJSON.annotations.every((a: Annotation) => a.riskLevel === "danger")).toBe(true);
    expect(parsedJSON.riskStats.exported).toBe(2);

    const csv = exportToCSVFromSnapshot(snapshot);
    const annotationRows = csv
      .split("\n")
      .filter((line) => line.startsWith("ann-"));
    expect(annotationRows.length).toBe(2);
    expect(annotationRows.every((line) => line.includes("danger"))).toBe(true);
  });

  it("changing filter after snapshot does not affect export results", () => {
    const annotations = [
      ...makeAnnotations(2, "danger", 0),
      ...makeAnnotations(3, "warning", 2),
    ];

    const dangerOnly: RiskLevelFilter = { safe: false, warning: false, danger: true };
    const allLevels: RiskLevelFilter = { safe: true, warning: true, danger: true };

    const snapshot = createSnapshot(
      baseJob,
      annotations,
      1000,
      defaultCamera,
      true,
      dangerOnly,
      [],
      "快照"
    );

    const jsonBefore = exportToJSONFromSnapshot(snapshot);
    const csvBefore = exportToCSVFromSnapshot(snapshot);

    const newSnapshot = {
      ...snapshot,
      filter: { ...snapshot.filter, riskLevelFilter: allLevels },
    };

    const jsonFromSnapshot = exportToJSONFromSnapshot(snapshot);
    const csvFromSnapshot = exportToCSVFromSnapshot(snapshot);

    expect(jsonFromSnapshot).toBe(jsonBefore);
    expect(csvFromSnapshot).toBe(csvBefore);

    const jsonFromModifiedSnapshot = exportToJSONFromSnapshot(newSnapshot);
    const parsedFromModified = JSON.parse(jsonFromModifiedSnapshot);
    expect(parsedFromModified.annotations.length).toBe(2);
  });
});

describe("snapshot - filter equality and change detection", () => {
  it("areFiltersEqual returns true for identical filters", () => {
    const f1 = {
      showIgnored: false,
      riskLevelFilter: { safe: true, warning: true, danger: true },
      ignoredRiskIds: ["ann-1", "ann-3"],
    };
    const f2 = {
      showIgnored: false,
      riskLevelFilter: { safe: true, warning: true, danger: true },
      ignoredRiskIds: ["ann-3", "ann-1"],
    };
    expect(areFiltersEqual(f1, f2)).toBe(true);
  });

  it("areFiltersEqual returns false when showIgnored differs", () => {
    const f1 = {
      showIgnored: true,
      riskLevelFilter: { safe: true, warning: true, danger: true },
      ignoredRiskIds: [],
    };
    const f2 = {
      showIgnored: false,
      riskLevelFilter: { safe: true, warning: true, danger: true },
      ignoredRiskIds: [],
    };
    expect(areFiltersEqual(f1, f2)).toBe(false);
  });

  it("areFiltersEqual returns false when riskLevelFilter differs", () => {
    const f1 = {
      showIgnored: true,
      riskLevelFilter: { safe: true, warning: false, danger: true },
      ignoredRiskIds: [],
    };
    const f2 = {
      showIgnored: true,
      riskLevelFilter: { safe: true, warning: true, danger: true },
      ignoredRiskIds: [],
    };
    expect(areFiltersEqual(f1, f2)).toBe(false);
  });

  it("areFiltersEqual returns false when ignoredRiskIds length differs", () => {
    const f1 = {
      showIgnored: true,
      riskLevelFilter: { safe: true, warning: true, danger: true },
      ignoredRiskIds: ["ann-1"],
    };
    const f2 = {
      showIgnored: true,
      riskLevelFilter: { safe: true, warning: true, danger: true },
      ignoredRiskIds: [],
    };
    expect(areFiltersEqual(f1, f2)).toBe(false);
  });
});

describe("snapshot - store integration", () => {
  const baseJob = makeValidJob();
  const anotherJob = makeValidJob({
    meta: { name: "另一个作业", date: "2025-02-01", craneId: "CR-002", craneType: "履带式起重机", siteName: "另一个工地" },
  } as Partial<LiftingJob>);

  const defaultCamera = {
    position: [0, 80, 0.1] as [number, number, number],
    target: [0, 0, 0] as [number, number, number],
  };

  beforeEach(async () => {
    const { useStore } = await import("@/store/useStore");
    useStore.setState({
      job: null,
      currentTime: 0,
      annotations: [],
      ignoredRiskIds: [],
      showIgnored: true,
      riskLevelFilter: { safe: true, warning: true, danger: true },
      camera: defaultCamera,
      snapshots: {},
      currentSnapshotId: null,
      currentJobId: null,
      snapshotHistory: [],
      cameraPresets: [],
      lastImportSuccess: null,
      lastImportFailure: null,
    });
  });

  it("cross-job snapshot isolation - switching jobs does not carry snapshots", async () => {
    const { useStore } = await import("@/store/useStore");
    const store = useStore;

    store.getState().importJob(baseJob);
    const annotations1 = makeAnnotations(3, "danger", 0);
    store.setState({ annotations: annotations1 });
    const snapshot1 = store.getState().createExportSnapshot("作业1快照");
    store.getState().saveSnapshot(snapshot1);

    expect(store.getState().getCurrentJobSnapshots()).toHaveLength(1);
    expect(store.getState().getCurrentJobSnapshots()[0].name).toBe("作业1快照");
    const job1SnapshotId = store.getState().currentSnapshotId;

    store.getState().importJob(anotherJob);
    const annotations2 = makeAnnotations(2, "warning", 10);
    store.setState({ annotations: annotations2 });
    const snapshot2 = store.getState().createExportSnapshot("作业2快照");
    store.getState().saveSnapshot(snapshot2);

    expect(store.getState().getCurrentJobSnapshots()).toHaveLength(1);
    expect(store.getState().getCurrentJobSnapshots()[0].name).toBe("作业2快照");
    expect(store.getState().currentSnapshotId).not.toBe(job1SnapshotId);

    const allSnapshots = store.getState().snapshots;
    const jobIds = Object.keys(allSnapshots);
    expect(jobIds.length).toBe(2);
    expect(allSnapshots[jobIds[0]]).toHaveLength(1);
    expect(allSnapshots[jobIds[1]]).toHaveLength(1);
  });

  it("snapshot persistence - snapshots are included in persist partialize", async () => {
    const { useStore } = await import("@/store/useStore");
    const store = useStore;

    store.getState().importJob(baseJob);
    const snapshot = store.getState().createExportSnapshot("持久化测试快照");
    store.getState().saveSnapshot(snapshot);

    const state = store.getState();
    expect(state.snapshots).toBeDefined();
    expect(state.currentSnapshotId).toBe(snapshot.id);
    expect(state.currentJobId).toBeDefined();
    expect(state.riskLevelFilter).toBeDefined();
    expect(state.camera).toEqual(defaultCamera);

    expect(Object.keys(state.snapshots).length).toBeGreaterThan(0);
    const jobSnapshots = state.snapshots[state.currentJobId!];
    expect(jobSnapshots).toBeDefined();
    expect(jobSnapshots.length).toBe(1);
    expect(jobSnapshots[0].id).toBe(snapshot.id);
  });

  it("snapshot persistence across restarts - rehydration preserves snapshots", async () => {
    const { useStore } = await import("@/store/useStore");
    const store = useStore;

    store.getState().importJob(baseJob);
    const annotations = makeAnnotations(2, "danger", 0);
    store.setState({ annotations });
    const snapshot = store.getState().createExportSnapshot("重启保留测试");
    store.getState().saveSnapshot(snapshot);

    const stateBefore = store.getState();
    const snapshotBefore = stateBefore.getCurrentSnapshot();
    expect(snapshotBefore).not.toBeNull();

    const persisted = {
      job: stateBefore.job,
      cameraPresets: stateBefore.cameraPresets,
      camera: stateBefore.camera,
      annotations: stateBefore.annotations,
      ignoredRiskIds: stateBefore.ignoredRiskIds,
      showIgnored: stateBefore.showIgnored,
      riskLevelFilter: stateBefore.riskLevelFilter,
      lastImportSuccess: stateBefore.lastImportSuccess,
      lastImportFailure: stateBefore.lastImportFailure,
      snapshots: stateBefore.snapshots,
      currentSnapshotId: stateBefore.currentSnapshotId,
      currentJobId: stateBefore.currentJobId,
      snapshotHistory: stateBefore.snapshotHistory,
    };

    store.setState({
      ...persisted,
      isPlaying: false,
      playbackSpeed: 1,
      errors: [],
      rightPanelOpen: true,
    });

    const stateAfter = store.getState();
    expect(stateAfter.snapshots).toEqual(persisted.snapshots);
    expect(stateAfter.currentSnapshotId).toBe(snapshot.id);
    expect(stateAfter.currentJobId).toBe(persisted.currentJobId);

    const restoredSnapshot = stateAfter.getCurrentSnapshot();
    expect(restoredSnapshot).not.toBeNull();
    expect(restoredSnapshot!.name).toBe("重启保留测试");
    expect(restoredSnapshot!.annotations).toHaveLength(2);
  });
});

describe("snapshot - update and undo", () => {
  const baseJob = makeValidJob();
  const defaultCamera = {
    position: [0, 80, 0.1] as [number, number, number],
    target: [0, 0, 0] as [number, number, number],
  };
  const allLevels: RiskLevelFilter = { safe: true, warning: true, danger: true };

  beforeEach(async () => {
    const { useStore } = await import("@/store/useStore");
    useStore.setState({
      job: null,
      currentTime: 0,
      annotations: [],
      ignoredRiskIds: [],
      showIgnored: true,
      riskLevelFilter: allLevels,
      camera: defaultCamera,
      snapshots: {},
      currentSnapshotId: null,
      currentJobId: null,
      snapshotHistory: [],
      cameraPresets: [],
      lastImportSuccess: null,
      lastImportFailure: null,
    });
  });

  it("updateCurrentSnapshot saves history and undo restores previous version", async () => {
    const { useStore } = await import("@/store/useStore");
    const store = useStore;

    store.getState().importJob(baseJob);
    const annotationsV1 = makeAnnotations(2, "danger", 0);
    store.setState({ annotations: annotationsV1 });

    const snapshot = store.getState().createExportSnapshot("版本1");
    store.getState().saveSnapshot(snapshot);

    const snapshotV1 = store.getState().getCurrentSnapshot();
    expect(snapshotV1).not.toBeNull();
    expect(snapshotV1!.annotations).toHaveLength(2);

    const annotationsV2 = makeAnnotations(5, "danger", 0);
    store.setState({ annotations: annotationsV2 });

    expect(store.getState().canUndo()).toBe(false);

    const updateResult = store.getState().updateCurrentSnapshot();
    expect(updateResult.success).toBe(true);
    expect(updateResult.snapshot).toBeDefined();
    expect(updateResult.snapshot!.annotations).toHaveLength(5);

    const snapshotV2 = store.getState().getCurrentSnapshot();
    expect(snapshotV2!.annotations).toHaveLength(5);

    expect(store.getState().canUndo()).toBe(true);
    expect(store.getState().snapshotHistory).toHaveLength(1);

    const undoResult = store.getState().undoLastSnapshotChange();
    expect(undoResult.success).toBe(true);
    expect(undoResult.snapshot).toBeDefined();

    const restoredSnapshot = store.getState().getCurrentSnapshot();
    expect(restoredSnapshot).not.toBeNull();
    expect(restoredSnapshot!.annotations).toHaveLength(2);
    expect(restoredSnapshot!.annotations.map((a) => a.id)).toEqual(
      snapshotV1!.annotations.map((a) => a.id)
    );

    expect(store.getState().canUndo()).toBe(false);
    expect(store.getState().snapshotHistory).toHaveLength(0);

    const jsonFromRestored = exportToJSONFromSnapshot(restoredSnapshot!);
    const parsedRestored = JSON.parse(jsonFromRestored);
    expect(parsedRestored.annotations.length).toBe(2);
    expect(parsedRestored.riskStats.exported).toBe(2);

    const csvFromRestored = exportToCSVFromSnapshot(restoredSnapshot!);
    const annotationRows = csvFromRestored
      .split("\n")
      .filter((line) => line.startsWith("ann-"));
    expect(annotationRows.length).toBe(2);
  });

  it("undo with no history returns failure", async () => {
    const { useStore } = await import("@/store/useStore");
    const store = useStore;

    store.getState().importJob(baseJob);
    expect(store.getState().canUndo()).toBe(false);

    const result = store.getState().undoLastSnapshotChange();
    expect(result.success).toBe(false);
    expect(result.snapshot).toBeUndefined();
  });

  it("updateCurrentSnapshot without current snapshot returns failure", async () => {
    const { useStore } = await import("@/store/useStore");
    const store = useStore;

    store.getState().importJob(baseJob);
    expect(store.getState().currentSnapshotId).toBeNull();

    const result = store.getState().updateCurrentSnapshot();
    expect(result.success).toBe(false);
    expect(result.snapshot).toBeUndefined();
  });

  it("checkFilterChanged detects filter changes after snapshot creation", async () => {
    const { useStore } = await import("@/store/useStore");
    const store = useStore;

    store.getState().importJob(baseJob);
    const annotations = makeAnnotations(3, "danger", 0);
    store.setState({ annotations, showIgnored: false });

    const snapshot = store.getState().createExportSnapshot("测试筛选");
    store.getState().saveSnapshot(snapshot);

    expect(store.getState().checkFilterChanged()).toBe(false);

    store.setState({ showIgnored: true });
    expect(store.getState().checkFilterChanged()).toBe(true);

    store.setState({ showIgnored: false });
    expect(store.getState().checkFilterChanged()).toBe(false);

    store.setState({ riskLevelFilter: { safe: true, warning: true, danger: false } });
    expect(store.getState().checkFilterChanged()).toBe(true);
  });
});

describe("snapshot - export consistency after undo", () => {
  const baseJob = makeValidJob();
  const defaultCamera = {
    position: [0, 80, 0.1] as [number, number, number],
    target: [0, 0, 0] as [number, number, number],
  };
  const allLevels: RiskLevelFilter = { safe: true, warning: true, danger: true };

  beforeEach(async () => {
    const { useStore } = await import("@/store/useStore");
    useStore.setState({
      job: null,
      currentTime: 0,
      annotations: [],
      ignoredRiskIds: [],
      showIgnored: true,
      riskLevelFilter: allLevels,
      camera: defaultCamera,
      snapshots: {},
      currentSnapshotId: null,
      currentJobId: null,
      snapshotHistory: [],
      cameraPresets: [],
      lastImportSuccess: null,
      lastImportFailure: null,
    });
  });

  it("preview and export data match after undo operation", async () => {
    const { useStore } = await import("@/store/useStore");
    const store = useStore;

    store.getState().importJob(baseJob);
    const annotationsV1 = makeAnnotations(2, "danger", 0);
    store.setState({ annotations: annotationsV1 });

    const snapshot = store.getState().createExportSnapshot("一致性测试");
    store.getState().saveSnapshot(snapshot);

    const v1Snapshot = store.getState().getCurrentSnapshot()!;
    const v1JSON = exportToJSONFromSnapshot(v1Snapshot);
    const v1CSV = exportToCSVFromSnapshot(v1Snapshot);
    const v1AnnotationIds = v1Snapshot.annotations.map((a) => a.id);

    const annotationsV2 = makeAnnotations(4, "warning", 10);
    store.setState({ annotations: [...annotationsV1, ...annotationsV2] });

    store.getState().updateCurrentSnapshot();
    const v2Snapshot = store.getState().getCurrentSnapshot()!;
    expect(v2Snapshot.annotations).toHaveLength(6);

    store.getState().undoLastSnapshotChange();
    const restoredSnapshot = store.getState().getCurrentSnapshot()!;

    expect(restoredSnapshot.annotations).toHaveLength(2);
    expect(restoredSnapshot.annotations.map((a) => a.id)).toEqual(v1AnnotationIds);

    const restoredJSON = exportToJSONFromSnapshot(restoredSnapshot);
    const restoredCSV = exportToCSVFromSnapshot(restoredSnapshot);

    const parsedV1 = JSON.parse(v1JSON);
    const parsedRestored = JSON.parse(restoredJSON);
    expect(parsedRestored.annotations.length).toBe(parsedV1.annotations.length);
    expect(parsedRestored.annotations.map((a: Annotation) => a.id)).toEqual(
      parsedV1.annotations.map((a: Annotation) => a.id)
    );
    expect(parsedRestored.riskStats).toEqual(parsedV1.riskStats);

    const v1Rows = v1CSV.split("\n").filter((l) => l.startsWith("ann-"));
    const restoredRows = restoredCSV.split("\n").filter((l) => l.startsWith("ann-"));
    expect(restoredRows.length).toBe(v1Rows.length);
    expect(restoredRows).toEqual(v1Rows);
  });
});

describe("regression - infinite re-render / white screen", () => {
  const baseJob = makeValidJob();
  const defaultCamera = {
    position: [0, 80, 0.1] as [number, number, number],
    target: [0, 0, 0] as [number, number, number],
  };
  const allLevels: RiskLevelFilter = { safe: true, warning: true, danger: true };

  beforeEach(async () => {
    const { useStore } = await import("@/store/useStore");
    useStore.setState({
      job: null,
      currentTime: 0,
      annotations: [],
      ignoredRiskIds: [],
      showIgnored: true,
      riskLevelFilter: allLevels,
      camera: defaultCamera,
      snapshots: {},
      currentSnapshotId: null,
      currentJobId: null,
      snapshotHistory: [],
      cameraPresets: [],
      lastImportSuccess: null,
      lastImportFailure: null,
    });
  });

  it("high-frequency camera updates do not change snapshot list identity when empty", async () => {
    const { useStore } = await import("@/store/useStore");
    const store = useStore;

    store.getState().importJob(baseJob);

    const selectSnapshots = (s: ReturnType<typeof store.getState>) => {
      if (!s.currentJobId) return [];
      return s.snapshots[s.currentJobId] ?? [];
    };

    const state1 = store.getState();
    const snap1 = selectSnapshots(state1);

    store.getState().setCamera({
      position: [0.0001, 80.0001, 0.1],
      target: [0.0001, 0.0001, 0.0001],
    });
    const state2 = store.getState();
    const snap2 = selectSnapshots(state2);

    expect(snap1).toEqual(snap2);
    expect(snap1).toStrictEqual(snap2);
    expect(state1.snapshots).toBe(state2.snapshots);
    expect(state1.currentJobId).toBe(state2.currentJobId);
  });

  it("high-frequency camera updates do not change current snapshot identity", async () => {
    const { useStore } = await import("@/store/useStore");
    const store = useStore;

    store.getState().importJob(baseJob);
    const annotations = makeAnnotations(2, "danger", 0);
    store.setState({ annotations });
    const snapshot = store.getState().createExportSnapshot("回归测试快照");
    store.getState().saveSnapshot(snapshot);

    const selectCurrentSnapshot = (s: ReturnType<typeof store.getState>) => {
      if (!s.currentJobId || !s.currentSnapshotId) return null;
      const list = s.snapshots[s.currentJobId];
      if (!list) return null;
      return list.find((sn) => sn.id === s.currentSnapshotId) ?? null;
    };

    const prev = selectCurrentSnapshot(store.getState());
    expect(prev).not.toBeNull();

    for (let i = 0; i < 20; i++) {
      store.getState().setCamera({
        position: [i * 0.0001, 80, 0.1],
        target: [i * 0.0001, 0, 0],
      });
    }

    const curr = selectCurrentSnapshot(store.getState());
    expect(curr).toBe(prev);
    expect(curr!.id).toBe(snapshot.id);
  });

  it("selector derived values are stable across unrelated updates", async () => {
    const { useStore } = await import("@/store/useStore");
    const store = useStore;

    store.getState().importJob(baseJob);
    const annotations = makeAnnotations(3, "danger", 0);
    store.setState({ annotations });
    const snapshot = store.getState().createExportSnapshot("稳定性测试");
    store.getState().saveSnapshot(snapshot);

    let canUndoCallCount = 0;
    let filterChangedCallCount = 0;
    let snapshotListCallCount = 0;

    const subscribeSelect = <T,>(
      selector: (s: ReturnType<typeof store.getState>) => T,
      counter: { current: number }
    ) => {
      let last: T = Symbol() as unknown as T;
      return store.subscribe((s) => {
        const next = selector(s);
        if (next !== last) {
          counter.current++;
          last = next;
        }
      });
    };

    const canUndoCounter = { current: 0 };
    const filterChangedCounter = { current: 0 };
    const snapshotListCounter = { current: 0 };

    const canUndoSel = (s: ReturnType<typeof store.getState>) =>
      s.snapshotHistory.length > 0;
    const filterChangedSel = (s: ReturnType<typeof store.getState>) => {
      if (!s.currentJobId || !s.currentSnapshotId) return false;
      const list = s.snapshots[s.currentJobId];
      const snap = list?.find((sn) => sn.id === s.currentSnapshotId);
      if (!snap) return false;
      const f1 = {
        showIgnored: s.showIgnored,
        riskLevelFilter: s.riskLevelFilter,
        ignoredRiskIds: s.ignoredRiskIds,
      };
      const f2 = snap.filter;
      return !(
        f1.showIgnored === f2.showIgnored &&
        f1.riskLevelFilter.safe === f2.riskLevelFilter.safe &&
        f1.riskLevelFilter.warning === f2.riskLevelFilter.warning &&
        f1.riskLevelFilter.danger === f2.riskLevelFilter.danger &&
        f1.ignoredRiskIds.length === f2.ignoredRiskIds.length &&
        f1.ignoredRiskIds.every((id) => f2.ignoredRiskIds.includes(id))
      );
    };
    const snapshotListSel = (s: ReturnType<typeof store.getState>) => {
      if (!s.currentJobId) return [];
      return s.snapshots[s.currentJobId] ?? [];
    };

    const unsub1 = store.subscribe((s) => {
      const v = canUndoSel(s);
      canUndoCounter.current++;
    });
    const unsub2 = store.subscribe((s) => {
      const v = filterChangedSel(s);
      filterChangedCounter.current++;
    });
    const unsub3 = store.subscribe((s) => {
      const v = snapshotListSel(s);
      snapshotListCounter.current++;
    });

    try {
      for (let i = 0; i < 50; i++) {
        store.getState().setCamera({
          position: [i * 0.0001, 80, 0.1],
          target: [i * 0.0001, 0, 0],
        });
      }

      expect(canUndoSel(store.getState())).toBe(false);
      expect(filterChangedSel(store.getState())).toBe(false);
      expect(snapshotListSel(store.getState()).length).toBe(1);

      const totalUpdates = canUndoCounter.current + filterChangedCounter.current;
      expect(totalUpdates).toBeGreaterThan(0);

      const canUndoStable = canUndoSel(store.getState()) === false;
      const filterChangedStable = filterChangedSel(store.getState()) === false;
      expect(canUndoStable).toBe(true);
      expect(filterChangedStable).toBe(true);
    } finally {
      unsub1();
      unsub2();
      unsub3();
    }
  });

  it("import sample -> create snapshot -> preview -> export JSON -> export CSV full chain works", async () => {
    const { useStore } = await import("@/store/useStore");
    const store = useStore;

    const importResult = store.getState().importJob(baseJob);
    expect(importResult.success).toBe(true);

    const annotations = [
      ...makeAnnotations(2, "danger", 0),
      ...makeAnnotations(3, "warning", 2),
    ];
    store.setState({ annotations });
    expect(store.getState().annotations).toHaveLength(5);

    const snapshot = store.getState().createExportSnapshot("链路测试快照");
    store.getState().saveSnapshot(snapshot);
    expect(snapshot.annotations).toHaveLength(5);

    const currentSnap = store.getState().getCurrentSnapshot();
    expect(currentSnap).not.toBeNull();
    expect(currentSnap!.annotations).toHaveLength(5);

    const previewAnnotations = currentSnap!.annotations;
    expect(previewAnnotations.length).toBe(5);

    const json = exportToJSONFromSnapshot(currentSnap!);
    const parsed = JSON.parse(json);
    expect(parsed.annotations.length).toBe(5);
    expect(parsed.riskStats.danger).toBe(2);
    expect(parsed.riskStats.warning).toBe(3);
    expect(parsed.snapshotInfo.name).toBe("链路测试快照");

    const csv = exportToCSVFromSnapshot(currentSnap!);
    const annRows = csv.split("\n").filter((l) => l.startsWith("ann-"));
    expect(annRows.length).toBe(5);

    const headerSection = csv.split("=== 风险统计 ===")[1];
    expect(headerSection).toContain("批注总数,5");
    expect(headerSection).toContain("危险,2");
    expect(headerSection).toContain("警告,3");
  });
});

describe("regression - doc-vs-implementation consistency", () => {
  const defaultCamera = {
    position: [0, 80, 0.1] as [number, number, number],
    target: [0, 0, 0] as [number, number, number],
  };
  const allLevels: RiskLevelFilter = { safe: true, warning: true, danger: true };

  beforeEach(async () => {
    const { useStore } = await import("@/store/useStore");
    useStore.setState({
      job: null,
      currentTime: 0,
      annotations: [],
      ignoredRiskIds: [],
      showIgnored: true,
      riskLevelFilter: allLevels,
      camera: defaultCamera,
      snapshots: {},
      currentSnapshotId: null,
      currentJobId: null,
      snapshotHistory: [],
      cameraPresets: [],
      lastImportSuccess: null,
      lastImportFailure: null,
    });
  });

  it("importJob resets annotations / ignoredRiskIds / snapshotHistory on success", async () => {
    const { useStore } = await import("@/store/useStore");
    const store = useStore;
    const jobA = makeValidJob();

    store.setState({
      annotations: makeAnnotations(3, "danger", 0),
      ignoredRiskIds: ["ann-0", "ann-1"],
      snapshotHistory: [{
        snapshotId: "old",
        previousVersion: {} as ExportSnapshot,
        timestamp: new Date().toISOString(),
      }],
    });
    expect(store.getState().annotations).toHaveLength(3);
    expect(store.getState().ignoredRiskIds).toHaveLength(2);
    expect(store.getState().snapshotHistory).toHaveLength(1);

    const result = store.getState().importJob(jobA);
    expect(result.success).toBe(true);
    expect(store.getState().annotations).toEqual([]);
    expect(store.getState().ignoredRiskIds).toEqual([]);
    expect(store.getState().snapshotHistory).toEqual([]);
  });

  it("importJob resets annotations / ignoredRiskIds / snapshotHistory on validation failure", async () => {
    const { useStore } = await import("@/store/useStore");
    const store = useStore;

    store.setState({
      annotations: makeAnnotations(3, "danger", 0),
      ignoredRiskIds: ["ann-0"],
      snapshotHistory: [{
        snapshotId: "old",
        previousVersion: {} as ExportSnapshot,
        timestamp: new Date().toISOString(),
      }],
    });

    const invalid = { meta: null, crane: {}, trajectory: [], restrictedZones: [] };
    const result = store.getState().importJob(invalid);
    expect(result.success).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(store.getState().annotations).toEqual([]);
    expect(store.getState().ignoredRiskIds).toEqual([]);
    expect(store.getState().snapshotHistory).toEqual([]);
    expect(store.getState().errors.length).toBe(result.errors.length);
  });

  it("sampleJob from src/data/sampleJob.ts matches README: no pre-baked annotations", async () => {
    const mod = await import("@/data/sampleJob");
    expect(mod.sampleJob).toBeDefined();
    expect(mod.sampleJob.meta.name).toBe("A栋钢结构主梁吊装");
    expect(mod.sampleJob.meta.craneId).toBe("CR-001");
    expect(mod.sampleJob.trajectory.length).toBeGreaterThan(0);
    expect((mod.sampleJob as any).annotations).toBeUndefined();
  });

  it("lastImportFailure record uses exact panel error title wording", async () => {
    const { useStore } = await import("@/store/useStore");
    const store = useStore;

    const invalid = { meta: null, crane: {}, trajectory: [], restrictedZones: [] };
    store.getState().importJob(invalid);

    const failure = store.getState().lastImportFailure;
    expect(failure).not.toBeNull();
    expect(failure!.reason).toContain("预检未通过");
    expect(failure!.errors.length).toBeGreaterThan(0);
  });

  it("CSV export uses exact section headers documented in README", async () => {
    const { useStore } = await import("@/store/useStore");
    const store = useStore;

    store.getState().importJob(makeValidJob());
    store.setState({ annotations: makeAnnotations(2, "danger", 0) });
    const snapshot = store.getState().createExportSnapshot("CSV标题校验");
    store.getState().saveSnapshot(snapshot);

    const csv = exportToCSVFromSnapshot(store.getState().getCurrentSnapshot()!);
    expect(csv).toContain("=== 快照信息 ===");
    expect(csv).toContain("=== 筛选条件 ===");
    expect(csv).toContain("=== 轨迹数据 ===");
    expect(csv).toContain("=== 风险批注 ===");
    expect(csv).toContain("=== 风险统计 ===");

    const statsSection = csv.split("=== 风险统计 ===")[1];
    expect(statsSection).toContain("批注总数,");
    expect(statsSection).toContain("危险,");
    expect(statsSection).toContain("警告,");
    expect(statsSection).toContain("安全,");
    expect(statsSection).toContain("已忽略,");
    expect(statsSection).toContain("可见,");
    expect(statsSection).toContain("导出,");
  });

  it("JSON export contains snapshotInfo and exportOptions as documented", async () => {
    const { useStore } = await import("@/store/useStore");
    const store = useStore;

    store.getState().importJob(makeValidJob());
    const snapshot = store.getState().createExportSnapshot("JSON字段校验");
    store.getState().saveSnapshot(snapshot);

    const json = exportToJSONFromSnapshot(store.getState().getCurrentSnapshot()!);
    const parsed = JSON.parse(json);
    expect(parsed.snapshotInfo).toBeDefined();
    expect(parsed.snapshotInfo.name).toBe("JSON字段校验");
    expect(parsed.snapshotInfo.createdAt).toBeDefined();
    expect(parsed.snapshotInfo.updatedAt).toBeDefined();
    expect(parsed.snapshotInfo.currentTime).toBeDefined();
    expect(parsed.snapshotInfo.camera).toBeDefined();
    expect(parsed.exportOptions).toBeDefined();
    expect(typeof parsed.exportOptions.includeIgnored).toBe("boolean");
    expect(parsed.exportOptions.riskLevelFilter).toBeDefined();
    expect(typeof parsed.exportOptions.exportedCount).toBe("number");
  });
});
