import { describe, it, expect, beforeEach, vi } from "vitest";
import { precheckJob, sanitizeJob } from "@/utils/validation";
import {
  exportToJSON,
  exportToCSV,
  computeRiskStats,
  getVisibleAnnotations,
} from "@/utils/export";
import type {
  LiftingJob,
  Annotation,
  ValidationError,
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
    });

    const stateBefore = store.getState();

    const badData = { meta: {}, trajectory: [] };
    store.getState().importJob(badData);

    const stateAfter = store.getState();
    expect(stateAfter.job).toBe(stateBefore.job);
    expect(stateAfter.annotations).toEqual(stateBefore.annotations);
    expect(stateAfter.ignoredRiskIds).toEqual(stateBefore.ignoredRiskIds);
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
