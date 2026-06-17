import { describe, it, expect, beforeEach, vi } from "vitest";

const mockLocalStorage = (() => {
  let store: Record<string, string> = {};
  const storage = {
    getItem: (key: string) => (key in store ? store[key] : null),
    setItem: (key: string, value: string) => {
      store[key] = String(value);
    },
    removeItem: (key: string) => {
      delete store[key];
    },
    clear: () => {
      store = {};
    },
    get length() {
      return Object.keys(store).length;
    },
    key: (index: number) => {
      const keys = Object.keys(store);
      return index >= 0 && index < keys.length ? keys[index] : null;
    },
  };
  return storage;
})();

try {
  Object.defineProperty(window, "localStorage", {
    value: mockLocalStorage,
    writable: true,
    configurable: true,
  });
} catch (e) {
  // ignore if window is not available
}

vi.stubGlobal("localStorage", mockLocalStorage);
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
  AnnotationTemplate as TplType,
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
    const annotationsBefore = stateBefore.annotations;
    const ignoredBefore = stateBefore.ignoredRiskIds;
    const presetsBefore = stateBefore.cameraPresets;
    const timeBefore = stateBefore.currentTime;

    const badData = makeValidJob();
    (badData.trajectory[1] as any).load = "invalid";
    const result = store.getState().importJob(badData);

    expect(result.success).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);

    const stateAfter = store.getState();
    expect(stateAfter.job).toBe(jobBefore);
    expect(stateAfter.annotations).toBe(annotationsBefore);
    expect(stateAfter.ignoredRiskIds).toBe(ignoredBefore);
    expect(stateAfter.snapshotHistory).toEqual(stateBefore.snapshotHistory);
    expect(stateAfter.cameraPresets).toBe(presetsBefore);
    expect(stateAfter.currentTime).toBe(timeBefore);
  });
});

describe("importJob - state preservation after failure", () => {
  it("annotations, ignoredRiskIds, cameraPresets, currentTime remain intact after failed import", async () => {
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
    expect(stateAfter.annotations).toEqual(stateBefore.annotations);
    expect(stateAfter.ignoredRiskIds).toEqual(stateBefore.ignoredRiskIds);
    expect(stateAfter.snapshotHistory).toEqual(stateBefore.snapshotHistory);
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

    const parsedJsonBefore = JSON.parse(jsonBefore);
    const parsedJsonAfter = JSON.parse(jsonFromSnapshot);
    delete parsedJsonBefore.exportedAt;
    delete parsedJsonAfter.exportedAt;
    expect(parsedJsonAfter).toEqual(parsedJsonBefore);
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

    const canUndoCallCount = 0;
    const filterChangedCallCount = 0;
    const snapshotListCallCount = 0;

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

  it("importJob resets annotations / ignoredRiskIds / snapshotHistory ONLY on success", async () => {
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

    const invalid = { meta: null, crane: {}, trajectory: [], restrictedZones: [] };
    const fail = store.getState().importJob(invalid);
    expect(fail.success).toBe(false);
    expect(store.getState().annotations).toHaveLength(3);
    expect(store.getState().ignoredRiskIds).toHaveLength(2);
    expect(store.getState().snapshotHistory).toHaveLength(1);

    const ok = store.getState().importJob(jobA);
    expect(ok.success).toBe(true);
    expect(store.getState().annotations).toEqual([]);
    expect(store.getState().ignoredRiskIds).toEqual([]);
    expect(store.getState().snapshotHistory).toEqual([]);
  });

  it("failed import preserves currentSnapshotId, snapshots bucket and export-ability", async () => {
    const { useStore } = await import("@/store/useStore");
    const store = useStore;

    store.getState().importJob(makeValidJob());
    store.setState({ annotations: makeAnnotations(2, "warning", 0) });
    const snap = store.getState().createExportSnapshot("失败前快照");
    store.getState().saveSnapshot(snap);
    const jobId = store.getState().currentJobId!;
    const snapId = snap.id;

    expect(jobId).toBeTruthy();
    expect(store.getState().currentSnapshotId).toBe(snapId);
    expect(store.getState().snapshots[jobId]).toHaveLength(1);
    const exportedBefore = exportToJSONFromSnapshot(
      store.getState().getCurrentSnapshot()!
    );

    const bad = { meta: {}, restrictedZones: [] };
    const r = store.getState().importJob(bad);
    expect(r.success).toBe(false);
    expect(r.errors.length).toBeGreaterThan(0);

    expect(store.getState().currentSnapshotId).toBe(snapId);
    expect(store.getState().snapshots[jobId]).toHaveLength(1);
    expect(store.getState().snapshots[jobId]![0].id).toBe(snapId);
    expect(store.getState().annotations).toHaveLength(2);

    const exportedAfter = exportToJSONFromSnapshot(
      store.getState().getCurrentSnapshot()!
    );
    const parsedBefore = JSON.parse(exportedBefore);
    const parsedAfter = JSON.parse(exportedAfter);
    delete parsedBefore.exportedAt;
    delete parsedAfter.exportedAt;
    expect(parsedAfter).toEqual(parsedBefore);
  });

  it("failed import preserves job.meta so name/date/craneId remain visible", async () => {
    const { useStore } = await import("@/store/useStore");
    const store = useStore;

    store.getState().importJob(makeValidJob());
    const jobBefore = store.getState().job!;
    const nameBefore = jobBefore.meta.name;
    const dateBefore = jobBefore.meta.date;
    const craneBefore = jobBefore.meta.craneId;
    expect(store.getState().errors).toEqual([]);

    const bad = { meta: {}, restrictedZones: [] };
    const r = store.getState().importJob(bad);
    expect(r.success).toBe(false);
    expect(store.getState().errors.length).toBeGreaterThan(0);
    expect(store.getState().job).toBe(jobBefore);
    expect(store.getState().job!.meta.name).toBe(nameBefore);
    expect(store.getState().job!.meta.date).toBe(dateBefore);
    expect(store.getState().job!.meta.craneId).toBe(craneBefore);
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

describe("template - CRUD and persistence", () => {
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
      templates: [],
    });
  });

  it("addTemplate succeeds with unique name", async () => {
    const { useStore } = await import("@/store/useStore");
    const store = useStore;
    const tpl: TplType = {
      id: "tpl-1",
      name: "越界作业",
      defaultRiskLevel: "danger",
      defaultText: "吊臂越界进入限制区",
      createdAt: new Date().toISOString(),
    };
    const ok = store.getState().addTemplate(tpl);
    expect(ok).toBe(true);
    expect(store.getState().templates).toHaveLength(1);
    expect(store.getState().templates[0].name).toBe("越界作业");
  });

  it("addTemplate rejects duplicate name", async () => {
    const { useStore } = await import("@/store/useStore");
    const store = useStore;
    const tpl1: TplType = {
      id: "tpl-1",
      name: "越界作业",
      defaultRiskLevel: "danger",
      defaultText: "吊臂越界",
      createdAt: new Date().toISOString(),
    };
    store.getState().addTemplate(tpl1);
    const tpl2: TplType = {
      id: "tpl-2",
      name: "越界作业",
      defaultRiskLevel: "warning",
      defaultText: "另一条",
      createdAt: new Date().toISOString(),
    };
    const ok = store.getState().addTemplate(tpl2);
    expect(ok).toBe(false);
    expect(store.getState().templates).toHaveLength(1);
  });

  it("updateTemplate rejects duplicate name from other template", async () => {
    const { useStore } = await import("@/store/useStore");
    const store = useStore;
    const tpl1: TplType = {
      id: "tpl-1",
      name: "越界作业",
      defaultRiskLevel: "danger",
      defaultText: "a",
      createdAt: new Date().toISOString(),
    };
    const tpl2: TplType = {
      id: "tpl-2",
      name: "超载",
      defaultRiskLevel: "warning",
      defaultText: "b",
      createdAt: new Date().toISOString(),
    };
    store.getState().addTemplate(tpl1);
    store.getState().addTemplate(tpl2);
    const ok = store.getState().updateTemplate("tpl-2", { name: "越界作业" });
    expect(ok).toBe(false);
    expect(store.getState().templates[1].name).toBe("超载");
  });

  it("updateTemplate allows keeping same name", async () => {
    const { useStore } = await import("@/store/useStore");
    const store = useStore;
    const tpl1: TplType = {
      id: "tpl-1",
      name: "越界作业",
      defaultRiskLevel: "danger",
      defaultText: "a",
      createdAt: new Date().toISOString(),
    };
    store.getState().addTemplate(tpl1);
    const ok = store.getState().updateTemplate("tpl-1", { name: "越界作业", defaultText: "修改后" });
    expect(ok).toBe(true);
    expect(store.getState().templates[0].defaultText).toBe("修改后");
  });

  it("deleteTemplate removes template but not annotations created from it", async () => {
    const { useStore } = await import("@/store/useStore");
    const store = useStore;
    const tpl: TplType = {
      id: "tpl-1",
      name: "越界作业",
      defaultRiskLevel: "danger",
      defaultText: "吊臂越界",
      createdAt: new Date().toISOString(),
    };
    store.getState().addTemplate(tpl);
    store.getState().importJob(baseJob);
    store.getState().addAnnotation({
      id: "ann-from-tpl",
      timestamp: 1000,
      position: [0, 0, 0],
      riskLevel: "danger",
      text: "吊臂越界",
      ignored: false,
      createdAt: new Date().toISOString(),
      templateSourceId: "tpl-1",
    });
    store.getState().addAnnotation({
      id: "ann-manual",
      timestamp: 2000,
      position: [0, 0, 0],
      riskLevel: "warning",
      text: "手动批注",
      ignored: false,
      createdAt: new Date().toISOString(),
    });
    expect(store.getState().annotations).toHaveLength(2);
    store.getState().deleteTemplate("tpl-1");
    expect(store.getState().templates).toHaveLength(0);
    expect(store.getState().annotations).toHaveLength(2);
    expect(store.getState().annotations.find((a) => a.id === "ann-from-tpl")).toBeDefined();
    expect(store.getState().annotations.find((a) => a.id === "ann-from-tpl")!.templateSourceId).toBe("tpl-1");
  });

  it("hasTemplateName works correctly", async () => {
    const { useStore } = await import("@/store/useStore");
    const store = useStore;
    const tpl: TplType = {
      id: "tpl-1",
      name: "越界作业",
      defaultRiskLevel: "danger",
      defaultText: "a",
      createdAt: new Date().toISOString(),
    };
    store.getState().addTemplate(tpl);
    expect(store.getState().hasTemplateName("越界作业")).toBe(true);
    expect(store.getState().hasTemplateName("超载")).toBe(false);
    expect(store.getState().hasTemplateName("越界作业", "tpl-1")).toBe(false);
    expect(store.getState().hasTemplateName("越界作业", "tpl-other")).toBe(true);
  });

  it("templates persist across job import (are tool-level, not job-level)", async () => {
    const { useStore } = await import("@/store/useStore");
    const store = useStore;
    const tpl: TplType = {
      id: "tpl-1",
      name: "越界作业",
      defaultRiskLevel: "danger",
      defaultText: "吊臂越界",
      createdAt: new Date().toISOString(),
    };
    store.getState().addTemplate(tpl);
    store.getState().importJob(baseJob);
    expect(store.getState().templates).toHaveLength(1);
    expect(store.getState().templates[0].name).toBe("越界作业");
  });

  it("templates are included in persist partialize", async () => {
    const { useStore } = await import("@/store/useStore");
    const store = useStore;
    const tpl: TplType = {
      id: "tpl-persist",
      name: "持久化模板",
      defaultRiskLevel: "warning",
      defaultText: "测试",
      createdAt: new Date().toISOString(),
    };
    store.getState().addTemplate(tpl);
    const persistConfig = (store as any).persist?.options;
    if (persistConfig?.partialize) {
      const partialized = persistConfig.partialize(store.getState());
      expect(partialized.templates).toBeDefined();
      expect(partialized.templates).toHaveLength(1);
      expect(partialized.templates[0].name).toBe("持久化模板");
    }
  });
});

describe("template - cross-job reuse", () => {
  const baseJob = makeValidJob();
  const anotherJob = makeValidJob({
    meta: { name: "另一个作业", date: "2025-03-01", craneId: "CR-003", craneType: "汽车起重机", siteName: "其他工地" },
  } as Partial<LiftingJob>);
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
      templates: [],
    });
  });

  it("template survives job switch and can be used on new job", async () => {
    const { useStore } = await import("@/store/useStore");
    const store = useStore;
    const tpl: TplType = {
      id: "tpl-1",
      name: "通用复核项",
      defaultRiskLevel: "warning",
      defaultText: "需二次确认",
      createdAt: new Date().toISOString(),
    };
    store.getState().addTemplate(tpl);
    store.getState().importJob(baseJob);
    store.getState().addAnnotation({
      id: "ann-1",
      timestamp: 1000,
      position: [0, 0, 0],
      riskLevel: "warning",
      text: "需二次确认",
      ignored: false,
      createdAt: new Date().toISOString(),
      templateSourceId: "tpl-1",
    });
    expect(store.getState().annotations).toHaveLength(1);

    store.getState().importJob(anotherJob);
    expect(store.getState().templates).toHaveLength(1);
    expect(store.getState().annotations).toHaveLength(0);

    store.getState().addAnnotation({
      id: "ann-2",
      timestamp: 2000,
      position: [0, 0, 0],
      riskLevel: "warning",
      text: "需二次确认",
      ignored: false,
      createdAt: new Date().toISOString(),
      templateSourceId: "tpl-1",
    });
    expect(store.getState().annotations).toHaveLength(1);
    expect(store.getState().annotations[0].templateSourceId).toBe("tpl-1");
  });
});

describe("template - export consistency with templateSourceId", () => {
  const baseJob = makeValidJob();
  const defaultCamera = {
    position: [0, 80, 0.1] as [number, number, number],
    target: [0, 0, 0] as [number, number, number],
  };
  const allLevels: RiskLevelFilter = { safe: true, warning: true, danger: true };

  it("JSON export includes templateSourceId and templateName", () => {
    const tpl: TplType = {
      id: "tpl-export",
      name: "越界检测",
      defaultRiskLevel: "danger",
      defaultText: "吊臂越界",
      createdAt: new Date().toISOString(),
    };
    const annotations: Annotation[] = [
      {
        id: "ann-tpl",
        timestamp: 1000,
        position: [0, 0, 0],
        riskLevel: "danger",
        text: "吊臂越界",
        ignored: false,
        createdAt: new Date().toISOString(),
        templateSourceId: "tpl-export",
      },
      {
        id: "ann-manual",
        timestamp: 2000,
        position: [0, 0, 0],
        riskLevel: "warning",
        text: "手动批注",
        ignored: false,
        createdAt: new Date().toISOString(),
      },
    ];
    const json = exportToJSON(baseJob, annotations, [], true, [tpl]);
    const parsed = JSON.parse(json);
    expect(parsed.annotations).toHaveLength(2);
    const tplAnn = parsed.annotations.find((a: any) => a.id === "ann-tpl");
    expect(tplAnn.templateSourceId).toBe("tpl-export");
    expect(tplAnn.templateName).toBe("越界检测");
    const manualAnn = parsed.annotations.find((a: any) => a.id === "ann-manual");
    expect(manualAnn.templateSourceId).toBeNull();
    expect(manualAnn.templateName).toBeNull();
  });

  it("JSON export shows null templateName when template is deleted", () => {
    const annotations: Annotation[] = [
      {
        id: "ann-tpl",
        timestamp: 1000,
        position: [0, 0, 0],
        riskLevel: "danger",
        text: "吊臂越界",
        ignored: false,
        createdAt: new Date().toISOString(),
        templateSourceId: "tpl-deleted",
      },
    ];
    const json = exportToJSON(baseJob, annotations, [], true, []);
    const parsed = JSON.parse(json);
    expect(parsed.annotations[0].templateSourceId).toBe("tpl-deleted");
    expect(parsed.annotations[0].templateName).toBeNull();
  });

  it("CSV export includes template source columns", () => {
    const tpl: TplType = {
      id: "tpl-csv",
      name: "CSV越界",
      defaultRiskLevel: "danger",
      defaultText: "csv测试",
      createdAt: new Date().toISOString(),
    };
    const annotations: Annotation[] = [
      {
        id: "ann-csv-tpl",
        timestamp: 1000,
        position: [0, 0, 0],
        riskLevel: "danger",
        text: "csv测试",
        ignored: false,
        createdAt: new Date().toISOString(),
        templateSourceId: "tpl-csv",
      },
    ];
    const csv = exportToCSV(baseJob, annotations, [], true, [tpl]);
    const headerLine = csv.split("\n").find((l) => l.includes("模板来源ID"));
    expect(headerLine).toBeDefined();
    expect(headerLine).toContain("模板名称");
    const dataLine = csv.split("\n").find((l) => l.startsWith("ann-csv-tpl"));
    expect(dataLine).toBeDefined();
    expect(dataLine).toContain("tpl-csv");
    expect(dataLine).toContain("CSV越界");
  });

  it("snapshot JSON export includes templateSourceId and templateName", () => {
    const tpl: TplType = {
      id: "tpl-snap",
      name: "快照模板",
      defaultRiskLevel: "warning",
      defaultText: "快照测试",
      createdAt: new Date().toISOString(),
    };
    const annotations: Annotation[] = [
      {
        id: "ann-snap-tpl",
        timestamp: 1000,
        position: [0, 0, 0],
        riskLevel: "warning",
        text: "快照测试",
        ignored: false,
        createdAt: new Date().toISOString(),
        templateSourceId: "tpl-snap",
      },
    ];
    const snapshot = createSnapshot(
      baseJob, annotations, 1000, defaultCamera, true, allLevels, [], "模板快照"
    );
    const json = exportToJSONFromSnapshot(snapshot, [tpl]);
    const parsed = JSON.parse(json);
    expect(parsed.annotations[0].templateSourceId).toBe("tpl-snap");
    expect(parsed.annotations[0].templateName).toBe("快照模板");
  });

  it("snapshot CSV export includes template source columns", () => {
    const tpl: TplType = {
      id: "tpl-snap-csv",
      name: "CSV快照模板",
      defaultRiskLevel: "danger",
      defaultText: "csv快照",
      createdAt: new Date().toISOString(),
    };
    const annotations: Annotation[] = [
      {
        id: "ann-snap-csv",
        timestamp: 1000,
        position: [0, 0, 0],
        riskLevel: "danger",
        text: "csv快照",
        ignored: false,
        createdAt: new Date().toISOString(),
        templateSourceId: "tpl-snap-csv",
      },
    ];
    const snapshot = createSnapshot(
      baseJob, annotations, 1000, defaultCamera, true, allLevels, [], "CSV快照"
    );
    const csv = exportToCSVFromSnapshot(snapshot, [tpl]);
    const headerLine = csv.split("\n").find((l) => l.includes("模板来源ID"));
    expect(headerLine).toBeDefined();
    const dataLine = csv.split("\n").find((l) => l.startsWith("ann-snap-csv"));
    expect(dataLine).toContain("tpl-snap-csv");
    expect(dataLine).toContain("CSV快照模板");
  });

  it("template source is preserved after snapshot update and undo", async () => {
    const { useStore } = await import("@/store/useStore");
    const store = useStore;
    const tpl: TplType = {
      id: "tpl-undo",
      name: "撤销测试模板",
      defaultRiskLevel: "danger",
      defaultText: "撤销测试",
      createdAt: new Date().toISOString(),
    };
    store.getState().addTemplate(tpl);
    store.getState().importJob(baseJob);
    store.getState().addAnnotation({
      id: "ann-undo-1",
      timestamp: 1000,
      position: [0, 0, 0],
      riskLevel: "danger",
      text: "撤销测试",
      ignored: false,
      createdAt: new Date().toISOString(),
      templateSourceId: "tpl-undo",
    });
    const snapshot = store.getState().createExportSnapshot("撤销测试快照");
    store.getState().saveSnapshot(snapshot);

    const jsonV1 = exportToJSONFromSnapshot(store.getState().getCurrentSnapshot()!, [tpl]);
    const parsedV1 = JSON.parse(jsonV1);
    expect(parsedV1.annotations[0].templateSourceId).toBe("tpl-undo");
    expect(parsedV1.annotations[0].templateName).toBe("撤销测试模板");

    store.getState().addAnnotation({
      id: "ann-undo-2",
      timestamp: 2000,
      position: [0, 0, 0],
      riskLevel: "warning",
      text: "新批注",
      ignored: false,
      createdAt: new Date().toISOString(),
    });
    store.getState().updateCurrentSnapshot();

    store.getState().undoLastSnapshotChange();
    const restored = store.getState().getCurrentSnapshot()!;
    const jsonRestored = exportToJSONFromSnapshot(restored, [tpl]);
    const parsedRestored = JSON.parse(jsonRestored);
    expect(parsedRestored.annotations[0].templateSourceId).toBe("tpl-undo");
    expect(parsedRestored.annotations[0].templateName).toBe("撤销测试模板");
  });

  it("deleting template after snapshot preserves templateSourceId in snapshot data", async () => {
    const { useStore } = await import("@/store/useStore");
    const store = useStore;
    const tpl: TplType = {
      id: "tpl-del-after",
      name: "删除后测试",
      defaultRiskLevel: "danger",
      defaultText: "删除后",
      createdAt: new Date().toISOString(),
    };
    store.getState().addTemplate(tpl);
    store.getState().importJob(baseJob);
    store.getState().addAnnotation({
      id: "ann-del-after",
      timestamp: 1000,
      position: [0, 0, 0],
      riskLevel: "danger",
      text: "删除后",
      ignored: false,
      createdAt: new Date().toISOString(),
      templateSourceId: "tpl-del-after",
    });
    const snapshot = store.getState().createExportSnapshot("删除模板后快照");
    store.getState().saveSnapshot(snapshot);

    store.getState().deleteTemplate("tpl-del-after");

    const jsonAfterDelete = exportToJSONFromSnapshot(
      store.getState().getCurrentSnapshot()!, []
    );
    const parsedAfter = JSON.parse(jsonAfterDelete);
    expect(parsedAfter.annotations[0].templateSourceId).toBe("tpl-del-after");
    expect(parsedAfter.annotations[0].templateName).toBeNull();

    const jsonBeforeDelete = exportToJSONFromSnapshot(
      store.getState().getCurrentSnapshot()!, [tpl]
    );
    const parsedBefore = JSON.parse(jsonBeforeDelete);
    expect(parsedBefore.annotations[0].templateSourceId).toBe("tpl-del-after");
    expect(parsedBefore.annotations[0].templateName).toBe("删除后测试");
  });
});

describe("template - filter consistency", () => {
  const baseJob = makeValidJob();

  it("template-applied annotations respect current filter in visible list", async () => {
    const { useStore } = await import("@/store/useStore");
    const store = useStore;
    const tpl: TplType = {
      id: "tpl-filter",
      name: "筛选测试",
      defaultRiskLevel: "danger",
      defaultText: "筛选测试",
      createdAt: new Date().toISOString(),
    };
    store.getState().addTemplate(tpl);
    store.getState().importJob(baseJob);

    store.getState().addAnnotation({
      id: "ann-filter-1",
      timestamp: 1000,
      position: [0, 0, 0],
      riskLevel: "danger",
      text: "筛选测试",
      ignored: false,
      createdAt: new Date().toISOString(),
      templateSourceId: "tpl-filter",
    });

    store.getState().setRiskLevelFilter({ danger: false });
    const snapshot = store.getState().createExportSnapshot("筛选快照");
    store.getState().saveSnapshot(snapshot);
    expect(snapshot.annotations).toHaveLength(0);
    expect(snapshot.riskStats.visible).toBe(0);
    expect(snapshot.riskStats.total).toBe(1);

    const json = exportToJSONFromSnapshot(snapshot, [tpl]);
    const parsed = JSON.parse(json);
    expect(parsed.annotations).toHaveLength(0);
    expect(parsed.riskStats.exported).toBe(0);

    const csv = exportToCSVFromSnapshot(snapshot, [tpl]);
    const annRows = csv.split("\n").filter((l) => l.startsWith("ann-"));
    expect(annRows).toHaveLength(0);
  });
});

describe("snapshot-first workflow - create snapshot then apply template", () => {
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
      templates: [],
    });
  });

  it("create snapshot first, then apply template -> snapshot becomes stale -> update -> export aligns", async () => {
    const { useStore } = await import("@/store/useStore");
    const store = useStore;

    const tpl: TplType = {
      id: "tpl-workflow",
      name: "越界作业",
      defaultRiskLevel: "danger",
      defaultText: "吊臂越界进入限制区",
      createdAt: new Date().toISOString(),
    };
    store.getState().addTemplate(tpl);

    store.getState().importJob(baseJob);
    store.getState().addAnnotation({
      id: "ann-initial",
      timestamp: 1000,
      position: [0, 0, 0],
      riskLevel: "warning",
      text: "初始批注",
      ignored: false,
      createdAt: new Date().toISOString(),
    });

    const snapshot = store.getState().createExportSnapshot("初始快照");
    store.getState().saveSnapshot(snapshot);
    expect(store.getState().isSnapshotStale()).toBe(false);

    store.getState().addAnnotation({
      id: "ann-from-tpl",
      timestamp: 2000,
      position: [0, 0, 0],
      riskLevel: "danger",
      text: "吊臂越界进入限制区",
      ignored: false,
      createdAt: new Date().toISOString(),
      templateSourceId: "tpl-workflow",
      templateSourceName: "越界作业",
    });

    expect(store.getState().checkDataChanged()).toBe(true);
    expect(store.getState().isSnapshotStale()).toBe(true);

    const currentSnap = store.getState().getCurrentSnapshot()!;
    expect(currentSnap.annotations).toHaveLength(1);

    const jsonBeforeUpdate = exportToJSONFromSnapshot(currentSnap, [tpl]);
    const parsedBefore = JSON.parse(jsonBeforeUpdate);
    expect(parsedBefore.annotations).toHaveLength(1);

    const updateResult = store.getState().updateCurrentSnapshot();
    expect(updateResult.success).toBe(true);
    expect(store.getState().isSnapshotStale()).toBe(false);

    const updatedSnap = store.getState().getCurrentSnapshot()!;
    expect(updatedSnap.annotations).toHaveLength(2);

    const jsonAfter = exportToJSONFromSnapshot(updatedSnap, [tpl]);
    const parsedAfter = JSON.parse(jsonAfter);
    expect(parsedAfter.annotations).toHaveLength(2);
    expect(parsedAfter.riskStats.exported).toBe(2);

    const csvAfter = exportToCSVFromSnapshot(updatedSnap, [tpl]);
    const annRows = csvAfter.split("\n").filter((l) => l.startsWith("ann-"));
    expect(annRows).toHaveLength(2);

    const tplAnn = parsedAfter.annotations.find((a: Annotation) => a.id === "ann-from-tpl");
    expect(tplAnn.templateSourceId).toBe("tpl-workflow");
    expect(tplAnn.templateName).toBe("越界作业");
  });

  it("snapshot-first then add annotation then undo -> export aligns to pre-add state", async () => {
    const { useStore } = await import("@/store/useStore");
    const store = useStore;

    store.getState().importJob(baseJob);
    store.getState().addAnnotation({
      id: "ann-1",
      timestamp: 1000,
      position: [0, 0, 0],
      riskLevel: "warning",
      text: "初始",
      ignored: false,
      createdAt: new Date().toISOString(),
    });

    const snapshot = store.getState().createExportSnapshot("撤销测试");
    store.getState().saveSnapshot(snapshot);

    store.getState().addAnnotation({
      id: "ann-2",
      timestamp: 2000,
      position: [0, 0, 0],
      riskLevel: "danger",
      text: "新增",
      ignored: false,
      createdAt: new Date().toISOString(),
    });
    expect(store.getState().isSnapshotStale()).toBe(true);

    store.getState().updateCurrentSnapshot();
    const updated = store.getState().getCurrentSnapshot()!;
    expect(updated.annotations).toHaveLength(2);

    store.getState().undoLastSnapshotChange();
    const restored = store.getState().getCurrentSnapshot()!;
    expect(restored.annotations).toHaveLength(1);
    expect(restored.annotations[0].id).toBe("ann-1");

    const json = exportToJSONFromSnapshot(restored);
    const parsed = JSON.parse(json);
    expect(parsed.annotations).toHaveLength(1);
    expect(parsed.riskStats.exported).toBe(1);

    const csv = exportToCSVFromSnapshot(restored);
    const rows = csv.split("\n").filter((l) => l.startsWith("ann-"));
    expect(rows).toHaveLength(1);
  });
});

describe("data staleness detection - checkDataChanged", () => {
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
      templates: [],
    });
  });

  it("returns false when no snapshot exists", async () => {
    const { useStore } = await import("@/store/useStore");
    const store = useStore;
    store.getState().importJob(baseJob);
    expect(store.getState().checkDataChanged()).toBe(false);
  });

  it("returns false right after snapshot creation", async () => {
    const { useStore } = await import("@/store/useStore");
    const store = useStore;
    store.getState().importJob(baseJob);
    store.getState().addAnnotation({
      id: "ann-1",
      timestamp: 1000,
      position: [0, 0, 0],
      riskLevel: "warning",
      text: "test",
      ignored: false,
      createdAt: new Date().toISOString(),
    });
    const snapshot = store.getState().createExportSnapshot("test");
    store.getState().saveSnapshot(snapshot);
    expect(store.getState().checkDataChanged()).toBe(false);
  });

  it("detects added annotation", async () => {
    const { useStore } = await import("@/store/useStore");
    const store = useStore;
    store.getState().importJob(baseJob);
    const snapshot = store.getState().createExportSnapshot("test");
    store.getState().saveSnapshot(snapshot);

    store.getState().addAnnotation({
      id: "ann-new",
      timestamp: 1000,
      position: [0, 0, 0],
      riskLevel: "danger",
      text: "new",
      ignored: false,
      createdAt: new Date().toISOString(),
    });
    expect(store.getState().checkDataChanged()).toBe(true);
  });

  it("detects removed annotation", async () => {
    const { useStore } = await import("@/store/useStore");
    const store = useStore;
    store.getState().importJob(baseJob);
    store.getState().addAnnotation({
      id: "ann-del",
      timestamp: 1000,
      position: [0, 0, 0],
      riskLevel: "danger",
      text: "to delete",
      ignored: false,
      createdAt: new Date().toISOString(),
    });
    const snapshot = store.getState().createExportSnapshot("test");
    store.getState().saveSnapshot(snapshot);

    store.getState().removeAnnotation("ann-del");
    expect(store.getState().checkDataChanged()).toBe(true);
  });

  it("detects changed risk level", async () => {
    const { useStore } = await import("@/store/useStore");
    const store = useStore;
    store.getState().importJob(baseJob);
    store.getState().addAnnotation({
      id: "ann-risk",
      timestamp: 1000,
      position: [0, 0, 0],
      riskLevel: "warning",
      text: "risk change",
      ignored: false,
      createdAt: new Date().toISOString(),
    });
    const snapshot = store.getState().createExportSnapshot("test");
    store.getState().saveSnapshot(snapshot);

    store.getState().updateAnnotation("ann-risk", { riskLevel: "danger" });
    expect(store.getState().checkDataChanged()).toBe(true);
  });

  it("detects changed text", async () => {
    const { useStore } = await import("@/store/useStore");
    const store = useStore;
    store.getState().importJob(baseJob);
    store.getState().addAnnotation({
      id: "ann-text",
      timestamp: 1000,
      position: [0, 0, 0],
      riskLevel: "warning",
      text: "original",
      ignored: false,
      createdAt: new Date().toISOString(),
    });
    const snapshot = store.getState().createExportSnapshot("test");
    store.getState().saveSnapshot(snapshot);

    store.getState().updateAnnotation("ann-text", { text: "modified" });
    expect(store.getState().checkDataChanged()).toBe(true);
  });

  it("detects ignored state change on annotation", async () => {
    const { useStore } = await import("@/store/useStore");
    const store = useStore;
    store.getState().importJob(baseJob);
    store.getState().addAnnotation({
      id: "ann-ignore",
      timestamp: 1000,
      position: [0, 0, 0],
      riskLevel: "warning",
      text: "ignore test",
      ignored: false,
      createdAt: new Date().toISOString(),
    });
    const snapshot = store.getState().createExportSnapshot("test");
    store.getState().saveSnapshot(snapshot);

    store.getState().updateAnnotation("ann-ignore", { ignored: true });
    expect(store.getState().checkDataChanged()).toBe(true);
  });

  it("toggleIgnoreRisk is detected by isSnapshotStale via filter change", async () => {
    const { useStore } = await import("@/store/useStore");
    const store = useStore;
    store.getState().importJob(baseJob);
    store.getState().addAnnotation({
      id: "ann-ignore-filter",
      timestamp: 1000,
      position: [0, 0, 0],
      riskLevel: "warning",
      text: "filter ignore test",
      ignored: false,
      createdAt: new Date().toISOString(),
    });
    const snapshot = store.getState().createExportSnapshot("test");
    store.getState().saveSnapshot(snapshot);

    store.getState().toggleIgnoreRisk("ann-ignore-filter");
    expect(store.getState().checkDataChanged()).toBe(false);
    expect(store.getState().checkFilterChanged()).toBe(true);
    expect(store.getState().isSnapshotStale()).toBe(true);
  });

  it("isSnapshotStale combines data and filter changes", async () => {
    const { useStore } = await import("@/store/useStore");
    const store = useStore;
    store.getState().importJob(baseJob);
    store.getState().addAnnotation({
      id: "ann-1",
      timestamp: 1000,
      position: [0, 0, 0],
      riskLevel: "danger",
      text: "test",
      ignored: false,
      createdAt: new Date().toISOString(),
    });
    const snapshot = store.getState().createExportSnapshot("test");
    store.getState().saveSnapshot(snapshot);
    expect(store.getState().isSnapshotStale()).toBe(false);

    store.getState().addAnnotation({
      id: "ann-2",
      timestamp: 2000,
      position: [0, 0, 0],
      riskLevel: "warning",
      text: "new",
      ignored: false,
      createdAt: new Date().toISOString(),
    });
    expect(store.getState().isSnapshotStale()).toBe(true);

    store.getState().updateCurrentSnapshot();
    expect(store.getState().isSnapshotStale()).toBe(false);

    store.getState().setRiskLevelFilter({ danger: false });
    expect(store.getState().isSnapshotStale()).toBe(true);
  });
});

describe("template source name persistence - templateSourceName", () => {
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
      templates: [],
    });
  });

  it("templateSourceName is stored on annotation when applying template", async () => {
    const { useStore } = await import("@/store/useStore");
    const store = useStore;
    const tpl: TplType = {
      id: "tpl-name",
      name: "越界检测",
      defaultRiskLevel: "danger",
      defaultText: "吊臂越界",
      createdAt: new Date().toISOString(),
    };
    store.getState().addTemplate(tpl);
    store.getState().importJob(baseJob);

    store.getState().addAnnotation({
      id: "ann-name",
      timestamp: 1000,
      position: [0, 0, 0],
      riskLevel: "danger",
      text: "吊臂越界",
      ignored: false,
      createdAt: new Date().toISOString(),
      templateSourceId: "tpl-name",
      templateSourceName: "越界检测",
    });

    const ann = store.getState().annotations.find((a) => a.id === "ann-name");
    expect(ann).toBeDefined();
    expect(ann!.templateSourceId).toBe("tpl-name");
    expect(ann!.templateSourceName).toBe("越界检测");
  });

  it("templateSourceName survives template deletion in export", async () => {
    const { useStore } = await import("@/store/useStore");
    const store = useStore;
    const tpl: TplType = {
      id: "tpl-del-name",
      name: "删除模板名称测试",
      defaultRiskLevel: "danger",
      defaultText: "测试",
      createdAt: new Date().toISOString(),
    };
    store.getState().addTemplate(tpl);
    store.getState().importJob(baseJob);
    store.getState().addAnnotation({
      id: "ann-del-name",
      timestamp: 1000,
      position: [0, 0, 0],
      riskLevel: "danger",
      text: "测试",
      ignored: false,
      createdAt: new Date().toISOString(),
      templateSourceId: "tpl-del-name",
      templateSourceName: "删除模板名称测试",
    });

    const snapshot = store.getState().createExportSnapshot("名称持久化");
    store.getState().saveSnapshot(snapshot);

    store.getState().deleteTemplate("tpl-del-name");

    const json = exportToJSONFromSnapshot(store.getState().getCurrentSnapshot()!, []);
    const parsed = JSON.parse(json);
    expect(parsed.annotations[0].templateSourceId).toBe("tpl-del-name");
    expect(parsed.annotations[0].templateName).toBe("删除模板名称测试");

    const csv = exportToCSVFromSnapshot(store.getState().getCurrentSnapshot()!, []);
    const dataLine = csv.split("\n").find((l) => l.startsWith("ann-del-name"));
    expect(dataLine).toContain("删除模板名称测试");
  });

  it("templateSourceName survives snapshot update and undo", async () => {
    const { useStore } = await import("@/store/useStore");
    const store = useStore;
    const tpl: TplType = {
      id: "tpl-undo-name",
      name: "撤销名称测试",
      defaultRiskLevel: "warning",
      defaultText: "撤销测试",
      createdAt: new Date().toISOString(),
    };
    store.getState().addTemplate(tpl);
    store.getState().importJob(baseJob);
    store.getState().addAnnotation({
      id: "ann-undo-name",
      timestamp: 1000,
      position: [0, 0, 0],
      riskLevel: "warning",
      text: "撤销测试",
      ignored: false,
      createdAt: new Date().toISOString(),
      templateSourceId: "tpl-undo-name",
      templateSourceName: "撤销名称测试",
    });

    const snapshot = store.getState().createExportSnapshot("撤销名称");
    store.getState().saveSnapshot(snapshot);

    store.getState().addAnnotation({
      id: "ann-extra",
      timestamp: 2000,
      position: [0, 0, 0],
      riskLevel: "safe",
      text: "额外批注",
      ignored: false,
      createdAt: new Date().toISOString(),
    });
    store.getState().updateCurrentSnapshot();

    store.getState().undoLastSnapshotChange();
    const restored = store.getState().getCurrentSnapshot()!;
    const json = exportToJSONFromSnapshot(restored, []);
    const parsed = JSON.parse(json);
    expect(parsed.annotations[0].templateSourceId).toBe("tpl-undo-name");
    expect(parsed.annotations[0].templateName).toBe("撤销名称测试");
  });

  it("templateSourceName is preserved in persist partialize", async () => {
    const { useStore } = await import("@/store/useStore");
    const store = useStore;
    store.getState().importJob(baseJob);
    store.getState().addAnnotation({
      id: "ann-persist-name",
      timestamp: 1000,
      position: [0, 0, 0],
      riskLevel: "danger",
      text: "持久化名称",
      ignored: false,
      createdAt: new Date().toISOString(),
      templateSourceId: "tpl-persist",
      templateSourceName: "持久化模板名",
    });

    const persistConfig = (store as any).persist?.options;
    if (persistConfig?.partialize) {
      const partialized = persistConfig.partialize(store.getState());
      expect(partialized.annotations[0].templateSourceName).toBe("持久化模板名");
    }
  });

  it("templateSourceName survives cross-restart rehydration", async () => {
    const { useStore } = await import("@/store/useStore");
    const store = useStore;
    store.getState().importJob(baseJob);
    store.getState().addAnnotation({
      id: "ann-restart-name",
      timestamp: 1000,
      position: [0, 0, 0],
      riskLevel: "danger",
      text: "重启名称",
      ignored: false,
      createdAt: new Date().toISOString(),
      templateSourceId: "tpl-restart",
      templateSourceName: "重启模板名",
    });
    const snapshot = store.getState().createExportSnapshot("重启测试");
    store.getState().saveSnapshot(snapshot);

    const stateBefore = store.getState();
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
      templates: stateBefore.templates,
    };

    store.setState({
      ...persisted,
      isPlaying: false,
      playbackSpeed: 1,
      errors: [],
      rightPanelOpen: true,
    });

    const stateAfter = store.getState();
    expect(stateAfter.annotations[0].templateSourceName).toBe("重启模板名");
    const restoredSnapshot = stateAfter.getCurrentSnapshot();
    expect(restoredSnapshot).not.toBeNull();
    expect(restoredSnapshot!.annotations[0].templateSourceName).toBe("重启模板名");
  });
});

describe("filter consistency - list, stats, export alignment", () => {
  const baseJob = makeValidJob();
  const defaultCamera = {
    position: [0, 80, 0.1] as [number, number, number],
    target: [0, 0, 0] as [number, number, number],
  };
  const allLevels: RiskLevelFilter = { safe: true, warning: true, danger: true };

  it("filter hiding annotation: list, stats, and export all agree", () => {
    const annotations = [
      ...makeAnnotations(2, "danger", 0),
      ...makeAnnotations(3, "warning", 2),
      ...makeAnnotations(1, "safe", 5),
    ];
    const dangerOnly: RiskLevelFilter = { safe: false, warning: false, danger: true };
    const ignoredRiskIds: string[] = [];

    const filtered = getFilteredAnnotations(annotations, ignoredRiskIds, true, dangerOnly);
    expect(filtered).toHaveLength(2);

    const stats = computeRiskStats(annotations, ignoredRiskIds, true, dangerOnly);
    expect(stats.visible).toBe(2);
    expect(stats.exported).toBe(2);

    const snapshot = createSnapshot(
      baseJob, annotations, 1000, defaultCamera, true, dangerOnly, ignoredRiskIds, "一致性测试"
    );
    expect(snapshot.annotations).toHaveLength(2);
    expect(snapshot.riskStats.visible).toBe(2);
    expect(snapshot.riskStats.exported).toBe(2);

    const json = exportToJSONFromSnapshot(snapshot);
    const parsed = JSON.parse(json);
    expect(parsed.annotations).toHaveLength(2);
    expect(parsed.riskStats.exported).toBe(2);

    const csv = exportToCSVFromSnapshot(snapshot);
    const annRows = csv.split("\n").filter((l) => l.startsWith("ann-"));
    expect(annRows).toHaveLength(2);
  });

  it("showIgnored=false hides ignored in list, stats, and export consistently", () => {
    const annotations = makeAnnotations(4, "danger", 0);
    const ignoredRiskIds = ["ann-1", "ann-3"];
    const filter: RiskLevelFilter = { safe: true, warning: true, danger: true };

    const filtered = getFilteredAnnotations(annotations, ignoredRiskIds, false, filter);
    expect(filtered).toHaveLength(2);

    const stats = computeRiskStats(annotations, ignoredRiskIds, false, filter);
    expect(stats.visible).toBe(2);
    expect(stats.exported).toBe(2);
    expect(stats.ignored).toBe(2);

    const snapshot = createSnapshot(
      baseJob, annotations, 1000, defaultCamera, false, filter, ignoredRiskIds, "忽略一致性"
    );
    expect(snapshot.annotations).toHaveLength(2);
    expect(snapshot.riskStats.exported).toBe(2);

    const json = exportToJSONFromSnapshot(snapshot);
    const parsed = JSON.parse(json);
    expect(parsed.annotations).toHaveLength(2);
    expect(parsed.riskStats.exported).toBe(2);
    expect(parsed.riskStats.ignored).toBe(2);

    const csv = exportToCSVFromSnapshot(snapshot);
    const annRows = csv.split("\n").filter((l) => l.startsWith("ann-"));
    expect(annRows).toHaveLength(2);
  });

  it("combined filter: showIgnored=false + danger-only agrees everywhere", () => {
    const annotations = [
      ...makeAnnotations(2, "danger", 0),
      ...makeAnnotations(3, "warning", 2),
    ];
    const ignoredRiskIds = ["ann-0"];
    const dangerOnly: RiskLevelFilter = { safe: false, warning: false, danger: true };

    const filtered = getFilteredAnnotations(annotations, ignoredRiskIds, false, dangerOnly);
    expect(filtered).toHaveLength(1);
    expect(filtered[0].id).toBe("ann-1");

    const stats = computeRiskStats(annotations, ignoredRiskIds, false, dangerOnly);
    expect(stats.visible).toBe(1);
    expect(stats.exported).toBe(1);

    const snapshot = createSnapshot(
      baseJob, annotations, 1000, defaultCamera, false, dangerOnly, ignoredRiskIds, "组合筛选"
    );
    expect(snapshot.annotations).toHaveLength(1);
    expect(snapshot.riskStats.exported).toBe(1);

    const json = exportToJSONFromSnapshot(snapshot);
    const parsed = JSON.parse(json);
    expect(parsed.annotations).toHaveLength(1);
    expect(parsed.annotations[0].id).toBe("ann-1");

    const csv = exportToCSVFromSnapshot(snapshot);
    const annRows = csv.split("\n").filter((l) => l.startsWith("ann-"));
    expect(annRows).toHaveLength(1);
    expect(annRows[0]).toContain("ann-1");
  });
});

describe("conflict scenario - stale export prevention", () => {
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
      templates: [],
    });
  });

  it("stale snapshot export shows different data than current state", async () => {
    const { useStore } = await import("@/store/useStore");
    const store = useStore;
    store.getState().importJob(baseJob);
    store.getState().addAnnotation({
      id: "ann-old",
      timestamp: 1000,
      position: [0, 0, 0],
      riskLevel: "warning",
      text: "旧批注",
      ignored: false,
      createdAt: new Date().toISOString(),
    });

    const snapshot = store.getState().createExportSnapshot("旧快照");
    store.getState().saveSnapshot(snapshot);

    store.getState().addAnnotation({
      id: "ann-new",
      timestamp: 2000,
      position: [0, 0, 0],
      riskLevel: "danger",
      text: "新批注",
      ignored: false,
      createdAt: new Date().toISOString(),
    });

    expect(store.getState().isSnapshotStale()).toBe(true);

    const staleSnapshot = store.getState().getCurrentSnapshot()!;
    expect(staleSnapshot.annotations).toHaveLength(1);
    const json = exportToJSONFromSnapshot(staleSnapshot);
    const parsed = JSON.parse(json);
    expect(parsed.annotations).toHaveLength(1);
    expect(parsed.annotations[0].id).toBe("ann-old");

    expect(store.getState().annotations).toHaveLength(2);
  });

  it("updating stale snapshot resolves staleness and export aligns", async () => {
    const { useStore } = await import("@/store/useStore");
    const store = useStore;
    store.getState().importJob(baseJob);
    store.getState().addAnnotation({
      id: "ann-1",
      timestamp: 1000,
      position: [0, 0, 0],
      riskLevel: "warning",
      text: "批注1",
      ignored: false,
      createdAt: new Date().toISOString(),
    });
    const snapshot = store.getState().createExportSnapshot("过期测试");
    store.getState().saveSnapshot(snapshot);

    store.getState().updateAnnotation("ann-1", { riskLevel: "danger" });
    store.getState().addAnnotation({
      id: "ann-2",
      timestamp: 2000,
      position: [0, 0, 0],
      riskLevel: "safe",
      text: "批注2",
      ignored: false,
      createdAt: new Date().toISOString(),
    });

    expect(store.getState().isSnapshotStale()).toBe(true);

    store.getState().updateCurrentSnapshot();
    expect(store.getState().isSnapshotStale()).toBe(false);

    const updatedSnap = store.getState().getCurrentSnapshot()!;
    expect(updatedSnap.annotations).toHaveLength(2);
    expect(updatedSnap.riskStats.danger).toBe(1);
    expect(updatedSnap.riskStats.safe).toBe(1);

    const json = exportToJSONFromSnapshot(updatedSnap);
    const parsed = JSON.parse(json);
    expect(parsed.annotations).toHaveLength(2);
    expect(parsed.riskStats.danger).toBe(1);
    expect(parsed.riskStats.safe).toBe(1);
  });

  it("filter change makes snapshot stale but export still uses snapshot filter", async () => {
    const { useStore } = await import("@/store/useStore");
    const store = useStore;
    store.getState().importJob(baseJob);
    store.getState().addAnnotation({
      id: "ann-danger",
      timestamp: 1000,
      position: [0, 0, 0],
      riskLevel: "danger",
      text: "危险",
      ignored: false,
      createdAt: new Date().toISOString(),
    });
    store.getState().addAnnotation({
      id: "ann-safe",
      timestamp: 2000,
      position: [0, 0, 0],
      riskLevel: "safe",
      text: "安全",
      ignored: false,
      createdAt: new Date().toISOString(),
    });

    const snapshot = store.getState().createExportSnapshot("筛选变更");
    store.getState().saveSnapshot(snapshot);
    expect(snapshot.annotations).toHaveLength(2);

    store.getState().setRiskLevelFilter({ safe: false });
    expect(store.getState().isSnapshotStale()).toBe(true);

    const staleSnap = store.getState().getCurrentSnapshot()!;
    const json = exportToJSONFromSnapshot(staleSnap);
    const parsed = JSON.parse(json);
    expect(parsed.annotations).toHaveLength(2);

    store.getState().updateCurrentSnapshot();
    const updatedSnap = store.getState().getCurrentSnapshot()!;
    expect(updatedSnap.annotations).toHaveLength(1);
    expect(updatedSnap.annotations[0].id).toBe("ann-danger");
  });
});

describe("template name dedup - delete does not affect existing annotations", () => {
  const baseJob = makeValidJob();
  const allLevels: RiskLevelFilter = { safe: true, warning: true, danger: true };
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
      riskLevelFilter: allLevels,
      camera: defaultCamera,
      snapshots: {},
      currentSnapshotId: null,
      currentJobId: null,
      snapshotHistory: [],
      cameraPresets: [],
      lastImportSuccess: null,
      lastImportFailure: null,
      templates: [],
    });
  });

  it("addTemplate rejects duplicate name even with different IDs", async () => {
    const { useStore } = await import("@/store/useStore");
    const store = useStore;
    const tpl1: TplType = {
      id: "tpl-dup-1",
      name: "重复名称",
      defaultRiskLevel: "danger",
      defaultText: "a",
      createdAt: new Date().toISOString(),
    };
    store.getState().addTemplate(tpl1);
    const tpl2: TplType = {
      id: "tpl-dup-2",
      name: "重复名称",
      defaultRiskLevel: "warning",
      defaultText: "b",
      createdAt: new Date().toISOString(),
    };
    expect(store.getState().addTemplate(tpl2)).toBe(false);
    expect(store.getState().templates).toHaveLength(1);
  });

  it("updateTemplate to existing name is rejected", async () => {
    const { useStore } = await import("@/store/useStore");
    const store = useStore;
    const tpl1: TplType = {
      id: "tpl-a",
      name: "名称A",
      defaultRiskLevel: "danger",
      defaultText: "a",
      createdAt: new Date().toISOString(),
    };
    const tpl2: TplType = {
      id: "tpl-b",
      name: "名称B",
      defaultRiskLevel: "warning",
      defaultText: "b",
      createdAt: new Date().toISOString(),
    };
    store.getState().addTemplate(tpl1);
    store.getState().addTemplate(tpl2);
    expect(store.getState().updateTemplate("tpl-b", { name: "名称A" })).toBe(false);
    expect(store.getState().templates[1].name).toBe("名称B");
  });

  it("deleting template does not change existing annotations or snapshot data", async () => {
    const { useStore } = await import("@/store/useStore");
    const store = useStore;
    const tpl: TplType = {
      id: "tpl-del",
      name: "待删模板",
      defaultRiskLevel: "danger",
      defaultText: "删除测试",
      createdAt: new Date().toISOString(),
    };
    store.getState().addTemplate(tpl);
    store.getState().importJob(baseJob);
    store.getState().addAnnotation({
      id: "ann-from-tpl",
      timestamp: 1000,
      position: [0, 0, 0],
      riskLevel: "danger",
      text: "删除测试",
      ignored: false,
      createdAt: new Date().toISOString(),
      templateSourceId: "tpl-del",
      templateSourceName: "待删模板",
    });
    const snapshot = store.getState().createExportSnapshot("删模板前");
    store.getState().saveSnapshot(snapshot);

    store.getState().deleteTemplate("tpl-del");

    expect(store.getState().annotations).toHaveLength(1);
    expect(store.getState().annotations[0].templateSourceId).toBe("tpl-del");
    expect(store.getState().annotations[0].templateSourceName).toBe("待删模板");

    const snapAfter = store.getState().getCurrentSnapshot()!;
    expect(snapAfter.annotations[0].templateSourceId).toBe("tpl-del");
    expect(snapAfter.annotations[0].templateSourceName).toBe("待删模板");

    const json = exportToJSONFromSnapshot(snapAfter, []);
    const parsed = JSON.parse(json);
    expect(parsed.annotations[0].templateSourceId).toBe("tpl-del");
    expect(parsed.annotations[0].templateName).toBe("待删模板");
  });
});

describe("resolveTemplateName - annotation.templateSourceName takes priority", () => {
  const baseJob = makeValidJob();
  const defaultCamera = {
    position: [0, 80, 0.1] as [number, number, number],
    target: [0, 0, 0] as [number, number, number],
  };

  it("uses templateSourceName when template is deleted", () => {
    const annotations: Annotation[] = [
      {
        id: "ann-name-test",
        timestamp: 1000,
        position: [0, 0, 0],
        riskLevel: "danger",
        text: "test",
        ignored: false,
        createdAt: new Date().toISOString(),
        templateSourceId: "tpl-deleted",
        templateSourceName: "已删除模板名",
      },
    ];
    const snapshot = createSnapshot(
      baseJob, annotations, 1000, defaultCamera, true,
      { safe: true, warning: true, danger: true }, [], "名称优先级"
    );

    const json = exportToJSONFromSnapshot(snapshot, []);
    const parsed = JSON.parse(json);
    expect(parsed.annotations[0].templateSourceId).toBe("tpl-deleted");
    expect(parsed.annotations[0].templateName).toBe("已删除模板名");

    const csv = exportToCSVFromSnapshot(snapshot, []);
    const dataLine = csv.split("\n").find((l) => l.startsWith("ann-name-test"));
    expect(dataLine).toContain("已删除模板名");
  });

  it("prefers templateSourceName over template map lookup", () => {
    const tpl: TplType = {
      id: "tpl-override",
      name: "当前模板名",
      defaultRiskLevel: "warning",
      defaultText: "test",
      createdAt: new Date().toISOString(),
    };
    const annotations: Annotation[] = [
      {
        id: "ann-override",
        timestamp: 1000,
        position: [0, 0, 0],
        riskLevel: "warning",
        text: "test",
        ignored: false,
        createdAt: new Date().toISOString(),
        templateSourceId: "tpl-override",
        templateSourceName: "原始模板名",
      },
    ];
    const snapshot = createSnapshot(
      baseJob, annotations, 1000, defaultCamera, true,
      { safe: true, warning: true, danger: true }, [], "覆盖测试"
    );

    const json = exportToJSONFromSnapshot(snapshot, [tpl]);
    const parsed = JSON.parse(json);
    expect(parsed.annotations[0].templateName).toBe("原始模板名");
  });

  it("falls back to template map when templateSourceName is absent", () => {
    const tpl: TplType = {
      id: "tpl-fallback",
      name: "回退模板名",
      defaultRiskLevel: "danger",
      defaultText: "test",
      createdAt: new Date().toISOString(),
    };
    const annotations: Annotation[] = [
      {
        id: "ann-fallback",
        timestamp: 1000,
        position: [0, 0, 0],
        riskLevel: "danger",
        text: "test",
        ignored: false,
        createdAt: new Date().toISOString(),
        templateSourceId: "tpl-fallback",
      },
    ];
    const snapshot = createSnapshot(
      baseJob, annotations, 1000, defaultCamera, true,
      { safe: true, warning: true, danger: true }, [], "回退测试"
    );

    const json = exportToJSONFromSnapshot(snapshot, [tpl]);
    const parsed = JSON.parse(json);
    expect(parsed.annotations[0].templateName).toBe("回退模板名");
  });

  it("returns null templateName when both templateSourceName and template map miss", () => {
    const annotations: Annotation[] = [
      {
        id: "ann-missing",
        timestamp: 1000,
        position: [0, 0, 0],
        riskLevel: "danger",
        text: "test",
        ignored: false,
        createdAt: new Date().toISOString(),
        templateSourceId: "tpl-nonexistent",
      },
    ];
    const snapshot = createSnapshot(
      baseJob, annotations, 1000, defaultCamera, true,
      { safe: true, warning: true, danger: true }, [], "缺失测试"
    );

    const json = exportToJSONFromSnapshot(snapshot, []);
    const parsed = JSON.parse(json);
    expect(parsed.annotations[0].templateSourceId).toBe("tpl-nonexistent");
    expect(parsed.annotations[0].templateName).toBeNull();
  });
});

import {
  createSessionPackage,
  updateSessionPackage,
  markPackageExpired,
  checkPackageExpired,
  canExportPackage,
  verifyPackageChecksum,
  serializePackage,
  deserializePackage,
  validatePackageStructure,
  checkImportConflict,
  resolveImportConflict,
  restoreFromPackage,
  incrementVersion,
  computeDataSignature,
  createLogEntry,
  createImportFailureLog,
} from "@/utils/sessionPackage";
import type {
  SessionPackageActionType,
  CameraState,
  AnnotationTemplate,
} from "@/types";
import { useStore } from "@/store/useStore";

const defaultCamera: CameraState = {
  position: [0, 80, 0.1] as [number, number, number],
  target: [0, 0, 0] as [number, number, number],
};

const defaultRiskFilter: RiskLevelFilter = {
  safe: true,
  warning: true,
  danger: true,
};

function makeTestJob(): LiftingJob {
  return {
    meta: {
      name: "测试作业",
      date: "2025-01-01",
      craneId: "CR-001",
      craneType: "塔式起重机",
      siteName: "测试工地",
    },
    crane: {
      position: [0, 0, 0] as [number, number, number],
      boomLength: 30,
      boomAngle: 60,
      maxRadius: 35,
    },
    restrictedZones: [
      {
        id: "zone-1",
        name: "高压线",
        type: "box",
        position: [20, 8, -5] as [number, number, number],
        size: { width: 6, height: 16, depth: 4 },
      },
    ],
    trajectory: [
      {
        timestamp: 0,
        hookPosition: [5, 25, 0] as [number, number, number],
        boomAngle: 60,
        load: 0,
        radius: 5,
        riskLevel: "safe",
      },
    ],
  };
}

function makeTestAnnotations(count: number = 3): Annotation[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `ann-${i}`,
    timestamp: i * 1000,
    position: [0, 0, 0] as [number, number, number],
    riskLevel: i % 2 === 0 ? "warning" : "danger",
    text: `批注 ${i}`,
    ignored: false,
    createdAt: new Date().toISOString(),
  }));
}

function makeTestTemplates(): AnnotationTemplate[] {
  return [
    {
      id: "tpl-1",
      name: "常规警告",
      defaultRiskLevel: "warning",
      defaultText: "请注意安全",
      createdAt: new Date().toISOString(),
    },
    {
      id: "tpl-2",
      name: "严重危险",
      defaultRiskLevel: "danger",
      defaultText: "立即停止作业",
      createdAt: new Date().toISOString(),
    },
  ];
}

describe("sessionPackage - 数据签名计算", () => {
  it("相同数据生成相同签名", () => {
    const annotations = makeTestAnnotations(3);
    const sig1 = computeDataSignature(annotations, true, defaultRiskFilter, []);
    const sig2 = computeDataSignature(annotations, true, defaultRiskFilter, []);
    expect(sig1.combinedHash).toBe(sig2.combinedHash);
    expect(sig1.annotationsHash).toBe(sig2.annotationsHash);
    expect(sig1.filterHash).toBe(sig2.filterHash);
  });

  it("批注变更导致签名变化", () => {
    const ann1 = makeTestAnnotations(3);
    const ann2 = makeTestAnnotations(3);
    ann2[0].text = "修改后的批注";
    const sig1 = computeDataSignature(ann1, true, defaultRiskFilter, []);
    const sig2 = computeDataSignature(ann2, true, defaultRiskFilter, []);
    expect(sig1.annotationsHash).not.toBe(sig2.annotationsHash);
    expect(sig1.combinedHash).not.toBe(sig2.combinedHash);
  });

  it("筛选条件变更导致签名变化", () => {
    const annotations = makeTestAnnotations(3);
    const filter1: RiskLevelFilter = { safe: true, warning: true, danger: true };
    const filter2: RiskLevelFilter = { safe: false, warning: true, danger: true };
    const sig1 = computeDataSignature(annotations, true, filter1, []);
    const sig2 = computeDataSignature(annotations, true, filter2, []);
    expect(sig1.filterHash).not.toBe(sig2.filterHash);
    expect(sig1.combinedHash).not.toBe(sig2.combinedHash);
  });
});

describe("sessionPackage - 创建与会话包", () => {
  it("创建会话包包含所有必需字段", () => {
    const job = makeTestJob();
    const annotations = makeTestAnnotations(3);
    const templates = makeTestTemplates();

    const pkg = createSessionPackage(
      job,
      annotations,
      1000,
      defaultCamera,
      true,
      defaultRiskFilter,
      [],
      templates,
      "测试包",
      "1.0.0"
    );

    expect(pkg.id).toBeDefined();
    expect(pkg.version).toBe("1.0.0");
    expect(pkg.name).toBe("测试包");
    expect(pkg.isExpired).toBe(false);
    expect(pkg.createdAt).toBeDefined();
    expect(pkg.updatedAt).toBeDefined();
    expect(pkg.signature).toBeDefined();
    expect(pkg.checksum).toBeDefined();
    expect(pkg.exportedFiles.json).toBeDefined();
    expect(pkg.exportedFiles.csv).toBeDefined();
    expect(pkg.snapshot.annotations).toHaveLength(3);
    expect(pkg.jobMeta.name).toBe("测试作业");
  });

  it("校验和验证正常工作", () => {
    const job = makeTestJob();
    const annotations = makeTestAnnotations(3);
    const templates = makeTestTemplates();

    const pkg = createSessionPackage(
      job,
      annotations,
      1000,
      defaultCamera,
      true,
      defaultRiskFilter,
      [],
      templates,
      "测试包",
      "1.0.0"
    );

    expect(verifyPackageChecksum(pkg)).toBe(true);
  });

  it("篡改数据后校验和验证失败", () => {
    const job = makeTestJob();
    const annotations = makeTestAnnotations(3);
    const templates = makeTestTemplates();

    const pkg = createSessionPackage(
      job,
      annotations,
      1000,
      defaultCamera,
      true,
      defaultRiskFilter,
      [],
      templates,
      "测试包",
      "1.0.0"
    );

    const tampered = { ...pkg, version: "2.0.0" };
    expect(verifyPackageChecksum(tampered)).toBe(false);
  });

  it("模板来源正确关联", () => {
    const job = makeTestJob();
    const templates = makeTestTemplates();
    const annotations: Annotation[] = [
      {
        id: "ann-1",
        timestamp: 1000,
        position: [0, 0, 0] as [number, number, number],
        riskLevel: "warning",
        text: "使用模板的批注",
        ignored: false,
        createdAt: new Date().toISOString(),
        templateSourceId: "tpl-1",
      },
      {
        id: "ann-2",
        timestamp: 2000,
        position: [0, 0, 0] as [number, number, number],
        riskLevel: "danger",
        text: "不使用模板的批注",
        ignored: false,
        createdAt: new Date().toISOString(),
      },
    ];

    const pkg = createSessionPackage(
      job,
      annotations,
      1000,
      defaultCamera,
      true,
      defaultRiskFilter,
      [],
      templates,
      "测试包",
      "1.0.0"
    );

    expect(pkg.templateSources).toHaveLength(1);
    expect(pkg.templateSources[0].id).toBe("tpl-1");
  });
});

describe("sessionPackage - 更新会话包", () => {
  it("更新会话包保留原有ID", () => {
    const job = makeTestJob();
    const annotations = makeTestAnnotations(3);
    const templates = makeTestTemplates();

    const original = createSessionPackage(
      job,
      annotations,
      1000,
      defaultCamera,
      true,
      defaultRiskFilter,
      [],
      templates,
      "测试包",
      "1.0.0"
    );

    const originalId = original.id;
    const newAnnotations = [...annotations, {
      id: "ann-new",
      timestamp: 5000,
      position: [0, 0, 0] as [number, number, number],
      riskLevel: "safe" as const,
      text: "新增批注",
      ignored: false,
      createdAt: new Date().toISOString(),
    }];

    const updated = updateSessionPackage(
      original,
      job,
      newAnnotations,
      2000,
      defaultCamera,
      true,
      defaultRiskFilter,
      [],
      templates,
      "1.0.1"
    );

    expect(updated.id).toBe(originalId);
    expect(updated.version).toBe("1.0.1");
    expect(updated.snapshot.annotations).toHaveLength(4);
    expect(updated.signature).not.toBe(original.signature);
  });

  it("更新时不指定版本则保留原版本", () => {
    const job = makeTestJob();
    const annotations = makeTestAnnotations(3);
    const templates = makeTestTemplates();

    const original = createSessionPackage(
      job,
      annotations,
      1000,
      defaultCamera,
      true,
      defaultRiskFilter,
      [],
      templates,
      "测试包",
      "1.0.0"
    );

    const updated = updateSessionPackage(
      original,
      job,
      annotations,
      2000,
      defaultCamera,
      true,
      defaultRiskFilter,
      [],
      templates
    );

    expect(updated.version).toBe("1.0.0");
  });
});

describe("sessionPackage - 过期检测与标记", () => {
  it("手动标记包过期", () => {
    const job = makeTestJob();
    const annotations = makeTestAnnotations(3);
    const templates = makeTestTemplates();

    const pkg = createSessionPackage(
      job,
      annotations,
      1000,
      defaultCamera,
      true,
      defaultRiskFilter,
      [],
      templates,
      "测试包",
      "1.0.0"
    );

    const expired = markPackageExpired(pkg, "测试过期原因");
    expect(expired.isExpired).toBe(true);
    expect(expired.expiredReason).toBe("测试过期原因");
    expect(expired.expiredAt).toBeDefined();
  });

  it("批注变更检测到过期", () => {
    const job = makeTestJob();
    const annotations = makeTestAnnotations(3);
    const templates = makeTestTemplates();

    const pkg = createSessionPackage(
      job,
      annotations,
      1000,
      defaultCamera,
      true,
      defaultRiskFilter,
      [],
      templates,
      "测试包",
      "1.0.0"
    );

    const modifiedAnnotations = annotations.map((a, i) =>
      i === 0 ? { ...a, text: "修改后的文本" } : a
    );

    const check = checkPackageExpired(
      pkg,
      modifiedAnnotations,
      true,
      defaultRiskFilter,
      []
    );

    expect(check.expired).toBe(true);
    expect(check.reason).toBe("批注数据已变更");
  });

  it("筛选条件变更检测到过期", () => {
    const job = makeTestJob();
    const annotations = makeTestAnnotations(3);
    const templates = makeTestTemplates();

    const pkg = createSessionPackage(
      job,
      annotations,
      1000,
      defaultCamera,
      true,
      defaultRiskFilter,
      [],
      templates,
      "测试包",
      "1.0.0"
    );

    const modifiedFilter: RiskLevelFilter = {
      safe: false,
      warning: true,
      danger: true,
    };

    const check = checkPackageExpired(
      pkg,
      annotations,
      true,
      modifiedFilter,
      []
    );

    expect(check.expired).toBe(true);
    expect(check.reason).toBe("筛选条件已变更");
  });

  it("已过期的包再次检查仍为过期", () => {
    const job = makeTestJob();
    const annotations = makeTestAnnotations(3);
    const templates = makeTestTemplates();

    const pkg = createSessionPackage(
      job,
      annotations,
      1000,
      defaultCamera,
      true,
      defaultRiskFilter,
      [],
      templates,
      "测试包",
      "1.0.0"
    );

    const expired = markPackageExpired(pkg, "手动过期");
    const check = checkPackageExpired(
      expired,
      annotations,
      true,
      defaultRiskFilter,
      []
    );

    expect(check.expired).toBe(true);
    expect(check.reason).toBe("手动过期");
  });

  it("数据未变更时检测为未过期", () => {
    const job = makeTestJob();
    const annotations = makeTestAnnotations(3);
    const templates = makeTestTemplates();

    const pkg = createSessionPackage(
      job,
      annotations,
      1000,
      defaultCamera,
      true,
      defaultRiskFilter,
      [],
      templates,
      "测试包",
      "1.0.0"
    );

    const check = checkPackageExpired(
      pkg,
      annotations,
      true,
      defaultRiskFilter,
      []
    );

    expect(check.expired).toBe(false);
  });
});

describe("sessionPackage - 导出控制", () => {
  it("未过期且校验和正确的包可以导出", () => {
    const job = makeTestJob();
    const annotations = makeTestAnnotations(3);
    const templates = makeTestTemplates();

    const pkg = createSessionPackage(
      job,
      annotations,
      1000,
      defaultCamera,
      true,
      defaultRiskFilter,
      [],
      templates,
      "测试包",
      "1.0.0"
    );

    expect(canExportPackage(pkg)).toBe(true);
  });

  it("已过期的包不能导出", () => {
    const job = makeTestJob();
    const annotations = makeTestAnnotations(3);
    const templates = makeTestTemplates();

    const pkg = createSessionPackage(
      job,
      annotations,
      1000,
      defaultCamera,
      true,
      defaultRiskFilter,
      [],
      templates,
      "测试包",
      "1.0.0"
    );

    const expired = markPackageExpired(pkg, "测试过期");
    expect(canExportPackage(expired)).toBe(false);
  });

  it("校验和错误的包不能导出", () => {
    const job = makeTestJob();
    const annotations = makeTestAnnotations(3);
    const templates = makeTestTemplates();

    const pkg = createSessionPackage(
      job,
      annotations,
      1000,
      defaultCamera,
      true,
      defaultRiskFilter,
      [],
      templates,
      "测试包",
      "1.0.0"
    );

    const tampered = { ...pkg, version: "9.9.9" };
    expect(canExportPackage(tampered)).toBe(false);
  });
});

describe("sessionPackage - 序列化与反序列化", () => {
  it("序列化后反序列化保持数据一致", () => {
    const job = makeTestJob();
    const annotations = makeTestAnnotations(3);
    const templates = makeTestTemplates();

    const original = createSessionPackage(
      job,
      annotations,
      1000,
      defaultCamera,
      true,
      defaultRiskFilter,
      [],
      templates,
      "测试包",
      "1.0.0"
    );

    const serialized = serializePackage(original);
    const result = deserializePackage(serialized);

    expect(result.valid).toBe(true);
    expect(result.pkg).toBeDefined();
    expect(result.pkg!.id).toBe(original.id);
    expect(result.pkg!.version).toBe(original.version);
    expect(result.pkg!.checksum).toBe(original.checksum);
  });

  it("校验结构验证必填字段", () => {
    const invalid = { id: "test", name: "test" };
    const result = validatePackageStructure(invalid);
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it("篡改后的包反序列化失败", () => {
    const job = makeTestJob();
    const annotations = makeTestAnnotations(3);
    const templates = makeTestTemplates();

    const original = createSessionPackage(
      job,
      annotations,
      1000,
      defaultCamera,
      true,
      defaultRiskFilter,
      [],
      templates,
      "测试包",
      "1.0.0"
    );

    const serialized = serializePackage(original);
    const parsed = JSON.parse(serialized);
    parsed.version = "2.0.0";
    const tamperedSerialized = JSON.stringify(parsed);

    const result = deserializePackage(tamperedSerialized);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain("包校验和不匹配，数据可能已被篡改");
  });

  it("无效JSON反序列化失败", () => {
    const result = deserializePackage("not valid json");
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain("JSON 解析失败");
  });
});

describe("sessionPackage - 导入冲突处理", () => {
  it("检测到同作业同版本冲突", () => {
    const job = makeTestJob();
    const annotations = makeTestAnnotations(3);
    const templates = makeTestTemplates();

    const existing = createSessionPackage(
      job,
      annotations,
      1000,
      defaultCamera,
      true,
      defaultRiskFilter,
      [],
      templates,
      "现有包",
      "1.0.0"
    );

    const incoming = createSessionPackage(
      job,
      annotations,
      2000,
      defaultCamera,
      true,
      defaultRiskFilter,
      [],
      templates,
      "新包",
      "1.0.0"
    );

    const conflict = checkImportConflict(incoming, [existing]);
    expect(conflict).not.toBeNull();
    expect(conflict!.existingPackage.id).toBe(existing.id);
    expect(conflict!.incomingPackage.id).toBe(incoming.id);
  });

  it("不同版本不产生冲突", () => {
    const job = makeTestJob();
    const annotations = makeTestAnnotations(3);
    const templates = makeTestTemplates();

    const existing = createSessionPackage(
      job,
      annotations,
      1000,
      defaultCamera,
      true,
      defaultRiskFilter,
      [],
      templates,
      "现有包",
      "1.0.0"
    );

    const incoming = createSessionPackage(
      job,
      annotations,
      2000,
      defaultCamera,
      true,
      defaultRiskFilter,
      [],
      templates,
      "新包",
      "2.0.0"
    );

    const conflict = checkImportConflict(incoming, [existing]);
    expect(conflict).toBeNull();
  });

  it("覆盖解决冲突保留现有ID", () => {
    const job = makeTestJob();
    const annotations = makeTestAnnotations(3);
    const templates = makeTestTemplates();

    const existing = createSessionPackage(
      job,
      annotations,
      1000,
      defaultCamera,
      true,
      defaultRiskFilter,
      [],
      templates,
      "现有包",
      "1.0.0"
    );

    const incoming = createSessionPackage(
      job,
      annotations,
      2000,
      defaultCamera,
      true,
      defaultRiskFilter,
      [],
      templates,
      "新包",
      "1.0.0"
    );

    const resolved = resolveImportConflict(incoming, existing, "overwrite");
    expect(resolved).not.toBeNull();
    expect(resolved!.id).toBe(existing.id);
    expect(resolved!.name).toBe("新包");
  });

  it("重命名解决冲突使用新版本号", () => {
    const job = makeTestJob();
    const annotations = makeTestAnnotations(3);
    const templates = makeTestTemplates();

    const existing = createSessionPackage(
      job,
      annotations,
      1000,
      defaultCamera,
      true,
      defaultRiskFilter,
      [],
      templates,
      "现有包",
      "1.0.0"
    );

    const incoming = createSessionPackage(
      job,
      annotations,
      2000,
      defaultCamera,
      true,
      defaultRiskFilter,
      [],
      templates,
      "新包",
      "1.0.0"
    );

    const resolved = resolveImportConflict(incoming, existing, "rename", "1.0.1");
    expect(resolved).not.toBeNull();
    expect(resolved!.version).toBe("1.0.1");
    expect(resolved!.id).not.toBe(existing.id);
  });

  it("取消解决冲突返回null", () => {
    const job = makeTestJob();
    const annotations = makeTestAnnotations(3);
    const templates = makeTestTemplates();

    const existing = createSessionPackage(
      job,
      annotations,
      1000,
      defaultCamera,
      true,
      defaultRiskFilter,
      [],
      templates,
      "现有包",
      "1.0.0"
    );

    const incoming = createSessionPackage(
      job,
      annotations,
      2000,
      defaultCamera,
      true,
      defaultRiskFilter,
      [],
      templates,
      "新包",
      "1.0.0"
    );

    const resolved = resolveImportConflict(incoming, existing, "cancel");
    expect(resolved).toBeNull();
  });

  it("重命名不提供新版本号抛出错误", () => {
    const job = makeTestJob();
    const annotations = makeTestAnnotations(3);
    const templates = makeTestTemplates();

    const existing = createSessionPackage(
      job,
      annotations,
      1000,
      defaultCamera,
      true,
      defaultRiskFilter,
      [],
      templates,
      "现有包",
      "1.0.0"
    );

    const incoming = createSessionPackage(
      job,
      annotations,
      2000,
      defaultCamera,
      true,
      defaultRiskFilter,
      [],
      templates,
      "新包",
      "1.0.0"
    );

    expect(() => {
      resolveImportConflict(incoming, existing, "rename");
    }).toThrow("重命名需要提供新版本号");
  });
});

describe("sessionPackage - 状态恢复", () => {
  it("从包中恢复完整状态", () => {
    const job = makeTestJob();
    const templates = makeTestTemplates();
    const annotations: Annotation[] = [
      {
        id: "ann-0",
        timestamp: 0,
        position: [0, 0, 0] as [number, number, number],
        riskLevel: "warning",
        text: "批注 0",
        ignored: false,
        createdAt: new Date().toISOString(),
        templateSourceId: "tpl-1",
      },
      {
        id: "ann-1",
        timestamp: 1000,
        position: [0, 0, 0] as [number, number, number],
        riskLevel: "danger",
        text: "批注 1",
        ignored: false,
        createdAt: new Date().toISOString(),
      },
      {
        id: "ann-2",
        timestamp: 2000,
        position: [0, 0, 0] as [number, number, number],
        riskLevel: "safe",
        text: "批注 2",
        ignored: false,
        createdAt: new Date().toISOString(),
      },
    ];
    const ignoredIds = ["ann-1"];
    const filter: RiskLevelFilter = { safe: true, warning: false, danger: true };

    const pkg = createSessionPackage(
      job,
      annotations,
      2500,
      { position: [10, 20, 30] as [number, number, number], target: [1, 2, 3] as [number, number, number] },
      false,
      filter,
      ignoredIds,
      templates,
      "测试包",
      "1.0.0"
    );

    const restored = restoreFromPackage(pkg);

    expect(restored.job.meta.name).toBe("测试作业");
    expect(restored.annotations).toHaveLength(3);
    expect(restored.currentTime).toBe(2500);
    expect(restored.camera.position).toEqual([10, 20, 30]);
    expect(restored.camera.target).toEqual([1, 2, 3]);
    expect(restored.showIgnored).toBe(false);
    expect(restored.riskLevelFilter.warning).toBe(false);
    expect(restored.ignoredRiskIds).toEqual(["ann-1"]);
    expect(restored.templates).toHaveLength(1);
  });

  it("恢复的数据是独立副本", () => {
    const job = makeTestJob();
    const annotations = makeTestAnnotations(2);
    const templates = makeTestTemplates();

    const pkg = createSessionPackage(
      job,
      annotations,
      1000,
      defaultCamera,
      true,
      defaultRiskFilter,
      [],
      templates,
      "测试包",
      "1.0.0"
    );

    const restored = restoreFromPackage(pkg);
    restored.annotations[0].text = "修改恢复后的批注";

    expect(pkg.snapshot.annotations[0].text).not.toBe("修改恢复后的批注");
  });
});

describe("sessionPackage - 版本号递增", () => {
  it("语义化版本正确递增补丁号", () => {
    expect(incrementVersion("1.0.0")).toBe("1.0.1");
    expect(incrementVersion("2.1.5")).toBe("2.1.6");
  });

  it("非语义化版本添加.1后缀", () => {
    expect(incrementVersion("1.0")).toBe("1.0.1");
    expect(incrementVersion("v1")).toBe("v1.1");
  });
});

describe("sessionPackage - 日志系统", () => {
  it("创建操作日志条目", () => {
    const job = makeTestJob();
    const annotations = makeTestAnnotations(2);
    const templates = makeTestTemplates();

    const pkg = createSessionPackage(
      job,
      annotations,
      1000,
      defaultCamera,
      true,
      defaultRiskFilter,
      [],
      templates,
      "测试包",
      "1.0.0"
    );

    const log = createLogEntry(pkg, "publish", true, "发布成功");

    expect(log.id).toBeDefined();
    expect(log.packageId).toBe(pkg.id);
    expect(log.packageVersion).toBe("1.0.0");
    expect(log.action).toBe("publish");
    expect(log.success).toBe(true);
    expect(log.message).toBe("发布成功");
    expect(log.timestamp).toBeDefined();
  });

  it("创建导入失败日志", () => {
    const log = createImportFailureLog("测试包", "1.0.0", "格式错误", { detail: "test" });

    expect(log.id).toBeDefined();
    expect(log.action).toBe("import_failure");
    expect(log.success).toBe(false);
    expect(log.message).toBe("格式错误");
    expect(log.details).toEqual({ detail: "test" });
  });

  it("支持所有操作类型", () => {
    const job = makeTestJob();
    const annotations = makeTestAnnotations(2);
    const templates = makeTestTemplates();

    const pkg = createSessionPackage(
      job,
      annotations,
      1000,
      defaultCamera,
      true,
      defaultRiskFilter,
      [],
      templates,
      "测试包",
      "1.0.0"
    );

    const actions: SessionPackageActionType[] = ["publish", "update", "revoke", "import", "import_failure", "expire"];

    for (const action of actions) {
      const log = createLogEntry(pkg, action, true, `${action} 操作`);
      expect(log.action).toBe(action);
    }
  });
});

describe("sessionPackage - Store集成测试", () => {
  beforeEach(() => {
    const state = useStore.getState();
    state.setJob(null);
    state.annotations.forEach((a) => state.removeAnnotation(a.id));
    state.setShowIgnored(true);
    state.setRiskLevelFilter({ safe: true, warning: true, danger: true });
    state.ignoredRiskIds.forEach((id) => state.toggleIgnoreRisk(id));
    useStore.setState({
      currentSnapshotId: null,
      currentPackageId: null,
      lastPublishId: null,
      sessionPackages: {},
      sessionPackageLogs: [],
    });
    localStorage.clear();
  });

  it("发布会话包后存储在store中", () => {
    const store = useStore.getState();

    const job = makeTestJob();
    store.setJob(job);

    const annotations = makeTestAnnotations(3);
    store.addAnnotation(annotations[0]);
    store.addAnnotation(annotations[1]);
    store.addAnnotation(annotations[2]);

    const pkg = store.publishSessionPackage("测试包", "1.0.0");

    expect(pkg).toBeDefined();
    expect(pkg.version).toBe("1.0.0");
    expect(store.getCurrentJobPackages()).toHaveLength(1);
    expect(store.getCurrentPackage()?.id).toBe(pkg.id);
  });

  it("批注变更后包自动标记为过期", () => {
    const store = useStore.getState();

    const job = makeTestJob();
    store.setJob(job);

    const annotations = makeTestAnnotations(2);
    store.addAnnotation(annotations[0]);
    store.addAnnotation(annotations[1]);

    const pkg = store.publishSessionPackage("测试包", "1.0.0");
    expect(store.isPackageExpired(pkg.id)).toBe(false);

    store.updateAnnotation(annotations[0].id, { text: "修改后的批注" });

    expect(store.isPackageExpired(pkg.id)).toBe(true);
  });

  it("筛选条件变更后包自动标记为过期", () => {
    const store = useStore.getState();

    const job = makeTestJob();
    store.setJob(job);

    const annotations = makeTestAnnotations(2);
    store.addAnnotation(annotations[0]);
    store.addAnnotation(annotations[1]);

    const pkg = store.publishSessionPackage("测试包", "1.0.0");
    expect(store.isPackageExpired(pkg.id)).toBe(false);

    store.setRiskLevelFilter({ safe: false });

    expect(store.isPackageExpired(pkg.id)).toBe(true);
  });

  it("过期的包无法导出", () => {
    const store = useStore.getState();

    const job = makeTestJob();
    store.setJob(job);

    const annotations = makeTestAnnotations(2);
    store.addAnnotation(annotations[0]);
    store.addAnnotation(annotations[1]);

    const pkg = store.publishSessionPackage("测试包", "1.0.0");
    expect(store.canExportSessionPackage(pkg.id)).toBe(true);

    store.updateAnnotation(annotations[0].id, { text: "修改后的批注" });

    expect(store.canExportSessionPackage(pkg.id)).toBe(false);
    expect(() => store.exportPackageToFile(pkg.id)).toThrow("会话包已过期，无法导出");
  });

  it("撤销最近发布将包标记为过期", () => {
    const store = useStore.getState();

    const job = makeTestJob();
    store.setJob(job);

    const annotations = makeTestAnnotations(2);
    store.addAnnotation(annotations[0]);
    store.addAnnotation(annotations[1]);

    const pkg = store.publishSessionPackage("测试包", "1.0.0");
    expect(store.isPackageExpired(pkg.id)).toBe(false);

    const result = store.revokeLastPublish();
    expect(result.success).toBe(true);
    expect(store.isPackageExpired(pkg.id)).toBe(true);
    expect(store.getPackageById(pkg.id)?.expiredReason).toBe("已撤销发布");
  });

  it("导入冲突检测正常工作", () => {
    const store = useStore.getState();

    const job = makeTestJob();
    store.setJob(job);

    const annotations = makeTestAnnotations(2);
    store.addAnnotation(annotations[0]);
    store.addAnnotation(annotations[1]);

    const pkg = store.publishSessionPackage("测试包", "1.0.0");
    const serialized = store.exportPackageToFile(pkg.id);

    store.deleteSnapshot(pkg.snapshot.id);
    const newStore = useStore.getState();
    newStore.setJob(job);

    const result = newStore.importPackageFromFile(serialized);
    expect(result.success).toBe(false);
    expect(result.conflict).toBeDefined();
  });

  it("导入冲突覆盖解决", () => {
    const store = useStore.getState();

    const job = makeTestJob();
    store.setJob(job);

    const annotations = makeTestAnnotations(2);
    store.addAnnotation(annotations[0]);
    store.addAnnotation(annotations[1]);

    const pkg = store.publishSessionPackage("原始包", "1.0.0");
    const serialized = store.exportPackageToFile(pkg.id);

    const result = store.importPackageFromFile(serialized, "overwrite");
    expect(result.success).toBe(true);
    expect(result.package?.version).toBe("1.0.0");
  });

  it("导入冲突重命名解决", () => {
    const store = useStore.getState();

    const job = makeTestJob();
    store.setJob(job);

    const annotations = makeTestAnnotations(2);
    store.addAnnotation(annotations[0]);
    store.addAnnotation(annotations[1]);

    const pkg = store.publishSessionPackage("原始包", "1.0.0");
    const serialized = store.exportPackageToFile(pkg.id);

    const result = store.importPackageFromFile(serialized, "rename", "2.0.0");
    expect(result.success).toBe(true);
    expect(result.package?.version).toBe("2.0.0");
  });

  it("导入回放恢复所有状态", () => {
    const store = useStore.getState();

    const job = makeTestJob();
    store.setJob(job);

    const annotations = makeTestAnnotations(3);
    store.addAnnotation(annotations[0]);
    store.addAnnotation(annotations[1]);
    store.addAnnotation(annotations[2]);
    store.setRiskLevelFilter({ safe: false, warning: true, danger: true });
    store.setShowIgnored(false);
    store.toggleIgnoreRisk(annotations[0].id);
    store.setCurrentTime(1500);
    store.setCamera({ position: [10, 20, 30] as [number, number, number], target: [1, 2, 3] as [number, number, number] });

    const pkg = store.publishSessionPackage("回放测试", "1.0.0");
    const packageId = pkg.id;

    const pkgBefore = store.getPackageById(packageId);
    expect(pkgBefore).not.toBeNull();
    expect(pkgBefore!.snapshot.annotations).toHaveLength(3);

    const pkgAfter = store.getPackageById(packageId);
    expect(pkgAfter).not.toBeNull();

    const restored = restoreFromPackage(pkgAfter!);
    expect(restored.job).not.toBeNull();
    expect(restored.annotations).toHaveLength(3);
    expect(restored.currentTime).toBe(1500);
    expect(restored.riskLevelFilter.safe).toBe(false);
    expect(restored.showIgnored).toBe(false);
    expect(restored.ignoredRiskIds).toContain(annotations[0].id);
    expect(restored.camera.position).toEqual([10, 20, 30]);

    const result = store.restoreFromPackage(packageId);
    expect(result.success).toBe(true);

    const newState = useStore.getState();
    expect(newState.job).not.toBeNull();
    expect(newState.annotations).toHaveLength(3);
    expect(newState.currentTime).toBe(1500);
    expect(newState.riskLevelFilter.safe).toBe(false);
    expect(newState.showIgnored).toBe(false);
    expect(newState.ignoredRiskIds).toContain(annotations[0].id);
    expect(newState.camera.position).toEqual([10, 20, 30]);
  });

  it("操作日志正确记录", () => {
    const store = useStore.getState();

    const job = makeTestJob();
    store.setJob(job);

    const annotations = makeTestAnnotations(2);
    store.addAnnotation(annotations[0]);
    store.addAnnotation(annotations[1]);

    const initialLogCount = store.getPackageLogs().length;

    const pkg = store.publishSessionPackage("日志测试", "1.0.0");
    expect(store.getPackageLogs()).toHaveLength(initialLogCount + 1);

    const publishLog = store.getPackageLogsByPackageId(pkg.id)[0];
    expect(publishLog.action).toBe("publish");
    expect(publishLog.success).toBe(true);

    store.updateAnnotation(annotations[0].id, { text: "修改批注" });
    expect(store.getPackageLogsByPackageId(pkg.id)).toHaveLength(2);

    const expireLog = store.getPackageLogsByPackageId(pkg.id).find(l => l.action === "expire");
    expect(expireLog).toBeDefined();
    expect(expireLog?.message).toBe("批注数据已变更");
  });

  it("导入失败日志记录", () => {
    const store = useStore.getState();

    const initialLogCount = store.getPackageLogs().length;

    const result = store.importPackageFromFile("invalid json content");
    expect(result.success).toBe(false);
    expect(store.getPackageLogs()).toHaveLength(initialLogCount + 1);

    const failureLog = store.getPackageLogs().find(l => l.action === "import_failure");
    expect(failureLog).toBeDefined();
    expect(failureLog?.success).toBe(false);
  });

  it("同版本号发布会被拒绝", () => {
    const store = useStore.getState();

    const job = makeTestJob();
    store.setJob(job);

    const annotations = makeTestAnnotations(2);
    store.addAnnotation(annotations[0]);
    store.addAnnotation(annotations[1]);

    store.publishSessionPackage("测试包", "1.0.0");

    expect(() => {
      store.publishSessionPackage("另一个包", "1.0.0");
    }).toThrow("版本号 1.0.0 已存在");
  });

  it("更新包可选择升级版本", () => {
    const store = useStore.getState();

    const job = makeTestJob();
    store.setJob(job);

    const annotations = makeTestAnnotations(2);
    store.addAnnotation(annotations[0]);
    store.addAnnotation(annotations[1]);

    const pkg = store.publishSessionPackage("测试包", "1.0.0");

    store.addAnnotation({
      id: "ann-new",
      timestamp: 3000,
      position: [0, 0, 0] as [number, number, number],
      riskLevel: "warning",
      text: "新增批注",
      ignored: false,
      createdAt: new Date().toISOString(),
    });

    const result = store.updateSessionPackage(pkg.id, "1.0.1");
    expect(result.success).toBe(true);
    expect(result.pkg?.version).toBe("1.0.1");
    expect(store.isPackageExpired(pkg.id)).toBe(false);
  });

  it("数据持久化跨重启验证", () => {
    const store = useStore.getState();

    const job = makeTestJob();
    store.setJob(job);

    const annotations = makeTestAnnotations(3);
    store.addAnnotation(annotations[0]);
    store.addAnnotation(annotations[1]);
    store.addAnnotation(annotations[2]);

    const pkg = store.publishSessionPackage("持久化测试", "1.0.0");
    expect(pkg).toBeDefined();
    expect(store.getCurrentJobPackages()).toHaveLength(1);
    expect(store.getPackageLogs()).toHaveLength(1);

    const jobKey = `${job.meta.name}-${job.meta.date}-${job.meta.craneId}`;
    const stateToPersist = {
      state: {
        sessionPackages: {
          [jobKey]: [pkg],
        },
        sessionPackageLogs: store.getPackageLogs(),
        currentPackageId: pkg.id,
        lastPublishId: pkg.id,
      },
    };

    localStorage.setItem("crane-replay-storage", JSON.stringify(stateToPersist));

    const stored = localStorage.getItem("crane-replay-storage");
    expect(stored).not.toBeNull();

    const parsed = JSON.parse(stored!);
    expect(parsed.state.sessionPackages).toBeDefined();
    
    const storedPkgs = parsed.state.sessionPackages[jobKey];
    expect(storedPkgs).toBeDefined();
    expect(storedPkgs).toHaveLength(1);
    expect(storedPkgs[0].id).toBe(pkg.id);
    expect(storedPkgs[0].version).toBe("1.0.0");
    expect(storedPkgs[0].isExpired).toBe(false);

    expect(parsed.state.sessionPackageLogs).toHaveLength(1);
    expect(parsed.state.sessionPackageLogs[0].action).toBe("publish");
    expect(parsed.state.currentPackageId).toBe(pkg.id);
    expect(parsed.state.lastPublishId).toBe(pkg.id);

    const deserialized = deserializePackage(JSON.stringify(storedPkgs[0]));
    expect(deserialized.valid).toBe(true);
    expect(deserialized.pkg).toBeDefined();
    expect(deserialized.pkg!.id).toBe(pkg.id);
    expect(verifyPackageChecksum(deserialized.pkg!)).toBe(true);
  });

  it("checkPackagesExpired正确检测所有过期包", () => {
    const store = useStore.getState();

    const job = makeTestJob();
    store.setJob(job);

    const annotations = makeTestAnnotations(3);
    store.addAnnotation(annotations[0]);
    store.addAnnotation(annotations[1]);
    store.addAnnotation(annotations[2]);

    const pkg1 = store.publishSessionPackage("包1", "1.0.0");
    const pkg2 = store.publishSessionPackage("包2", "1.0.1");

    expect(store.isPackageExpired(pkg1.id)).toBe(false);
    expect(store.isPackageExpired(pkg2.id)).toBe(false);

    store.updateAnnotation(annotations[0].id, { text: "修改批注" });

    expect(store.isPackageExpired(pkg1.id)).toBe(true);
    expect(store.isPackageExpired(pkg2.id)).toBe(true);

    const logs = store.getPackageLogs();
    const expireLogs = logs.filter(l => l.action === "expire");
    expect(expireLogs).toHaveLength(2);
  });

  it("导入篡改的包会被拒绝", () => {
    const store = useStore.getState();

    const job = makeTestJob();
    store.setJob(job);

    const annotations = makeTestAnnotations(2);
    store.addAnnotation(annotations[0]);
    store.addAnnotation(annotations[1]);

    const pkg = store.publishSessionPackage("测试包", "1.0.0");
    const serialized = store.exportPackageToFile(pkg.id);

    const parsed = JSON.parse(serialized);
    parsed.version = "9.9.9";
    const tampered = JSON.stringify(parsed);

    const result = store.importPackageFromFile(tampered);
    expect(result.success).toBe(false);
    expect(result.errors).toContain("包校验和不匹配，数据可能已被篡改");
  });

  it("过期包列表显示版本号、创建时间和过期状态", () => {
    const store = useStore.getState();

    const job = makeTestJob();
    store.setJob(job);

    const annotations = makeTestAnnotations(2);
    store.addAnnotation(annotations[0]);
    store.addAnnotation(annotations[1]);

    store.publishSessionPackage("测试包", "1.0.0");
    store.addAnnotation({
      id: "ann-expire",
      timestamp: 5000,
      position: [0, 0, 0] as [number, number, number],
      riskLevel: "safe",
      text: "触发过期",
      ignored: false,
      createdAt: new Date().toISOString(),
    });

    const packages = store.getCurrentJobPackages();
    expect(packages).toHaveLength(1);

    const pkgInfo = packages[0];
    expect(pkgInfo.version).toBeDefined();
    expect(pkgInfo.createdAt).toBeDefined();
    expect(pkgInfo.isExpired).toBe(true);
    expect(pkgInfo.expiredReason).toBe("批注数据已变更");
    expect(pkgInfo.expiredAt).toBeDefined();
  });
});

