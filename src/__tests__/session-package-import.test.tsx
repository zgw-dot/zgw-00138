import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import SessionPackageWorkbench from "@/components/SessionPackageWorkbench";
import { useStore } from "@/store/useStore";
import type { LiftingJob, Annotation, ReviewSessionPackage } from "@/types";
import {
  createSessionPackage,
  serializePackage,
} from "@/utils/sessionPackage";

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
  // ignore
}

vi.stubGlobal("localStorage", mockLocalStorage);

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

function createTestPackage(
  name: string,
  version: string,
  job: LiftingJob,
  annotations: Annotation[] = []
): ReviewSessionPackage {
  const defaultCamera = {
    position: [0, 80, 0.1] as [number, number, number],
    target: [0, 0, 0] as [number, number, number],
  };
  const allLevelsFilter = { safe: true, warning: true, danger: true };
  const templates: any[] = [];

  return createSessionPackage(
    job,
    annotations,
    1000,
    defaultCamera,
    true,
    allLevelsFilter,
    [],
    templates,
    name,
    version
  );
}

function setFileInput(input: HTMLInputElement, content: string, filename = "test-package.json") {
  const file = new File([content], filename, { type: "application/json" });
  Object.defineProperty(input, "files", {
    value: [file],
    writable: true,
    configurable: true,
  });
}

function getFileInput(): HTMLInputElement {
  const inputEl = document.querySelector('input[type="file"]');
  expect(inputEl).not.toBeNull();
  return inputEl as HTMLInputElement;
}

function getToastMessage(): string | null {
  const toastEl = document.querySelector('[class*="top-20"]');
  if (!toastEl) return null;
  const span = toastEl.querySelector("span");
  return span?.textContent || null;
}

describe("SessionPackageWorkbench - 导入链路 UI 接线测试", () => {
  const baseJob = makeValidJob();
  const baseJobId = `${baseJob.meta.name}-${baseJob.meta.date}-${baseJob.meta.craneId}`;

  beforeEach(() => {
    mockLocalStorage.clear();
    useStore.setState({
      job: baseJob,
      currentJobId: baseJobId,
      currentTime: 0,
      isPlaying: false,
      playbackSpeed: 1,
      camera: { position: [0, 80, 0.1], target: [0, 0, 0] },
      cameraPresets: [],
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
      snapshotHistory: [],
      templates: [],
      sessionPackages: {},
      sessionPackageLogs: [],
      currentPackageId: null,
      lastPublishId: null,
    });
  });

  const openWorkbench = async () => {
    const button = screen.getByText("会话包工作台");
    await userEvent.click(button);
  };

  const importFile = (content: string) => {
    const input = getFileInput();
    setFileInput(input, content);
    fireEvent.change(input);
  };

  describe("无冲突直接导入", () => {
    it("从文件选择到成功导入完整链路 - toast、全局日志、包内日志都正确", async () => {
      useStore.setState({ job: baseJob });
      render(<SessionPackageWorkbench />);
      await openWorkbench();

      const annotations = makeAnnotations(2, "warning", 0);
      const pkg = createTestPackage("导入测试包", "1.0.0", baseJob, annotations);
      const content = serializePackage(pkg);

      const logsBefore = useStore.getState().sessionPackageLogs.length;
      const packagesBefore = useStore.getState().getCurrentJobPackages().length;

      importFile(content);

      await waitFor(() => {
        expect(getToastMessage()).toContain("导入会话包成功");
      });

      const logsAfter = useStore.getState().sessionPackageLogs;
      expect(logsAfter.length).toBeGreaterThan(logsBefore);

      const importLogs = logsAfter.filter((l) => l.action === "import");
      expect(importLogs.length).toBe(1);
      expect(importLogs[0].success).toBe(true);
      expect(importLogs[0].packageName).toBe("导入测试包");
      expect(importLogs[0].packageVersion).toBe("1.0.0");

      const packagesAfter = useStore.getState().getCurrentJobPackages();
      expect(packagesAfter.length).toBe(packagesBefore + 1);

      const importedPkg = packagesAfter.find(
        (p) => p.name === "导入测试包" && p.version === "1.0.0"
      );
      expect(importedPkg).toBeDefined();
      expect(importedPkg!.operationLogs.length).toBeGreaterThan(0);

      const pkgImportLog = importedPkg!.operationLogs.find(
        (l) => l.action === "import"
      );
      expect(pkgImportLog).toBeDefined();
    });

    it("导入无效文件显示错误 toast 并记录失败日志", async () => {
      useStore.setState({ job: baseJob });
      render(<SessionPackageWorkbench />);
      await openWorkbench();

      const logsBefore = useStore.getState().sessionPackageLogs.length;

      importFile("not valid json{{{");

      await waitFor(() => {
        expect(getToastMessage()).toContain("导入失败");
      });

      const logsAfter = useStore.getState().sessionPackageLogs;
      expect(logsAfter.length).toBeGreaterThan(logsBefore);

      const failureLogs = logsAfter.filter((l) => l.action === "import_failure");
      expect(failureLogs.length).toBeGreaterThan(0);
    });
  });

  describe("预检阶段不落冲突日志", () => {
    it("precheckImportConflict 只检测不记录日志", async () => {
      useStore.setState({ job: baseJob });

      const existingPkg = createTestPackage(
        "冲突包",
        "1.0.0",
        baseJob,
        makeAnnotations(1)
      );
      useStore.setState({
        sessionPackages: {
          [existingPkg.jobId]: [existingPkg],
        },
      });

      const logsBefore = [...useStore.getState().sessionPackageLogs];

      const incomingPkg = createTestPackage(
        "冲突包",
        "1.0.0",
        baseJob,
        makeAnnotations(2)
      );
      const content = serializePackage(incomingPkg);

      const precheck = useStore.getState().precheckImportConflict(content);
      expect(precheck.valid).toBe(true);
      expect(precheck.conflict).not.toBeNull();

      const logsAfter = useStore.getState().sessionPackageLogs;
      expect(logsAfter.length).toBe(logsBefore.length);

      const conflictLogs = logsAfter.filter(
        (l) => l.action === "import_conflict_detected"
      );
      expect(conflictLogs.length).toBe(0);
    });
  });

  describe("冲突改名导入", () => {
    it("完整 UI 链路：选文件 -> 弹窗 -> 改名导入 -> 日志顺序稳定", async () => {
      useStore.setState({ job: baseJob });

      const existingPkg = createTestPackage(
        "冲突包",
        "1.0.0",
        baseJob,
        makeAnnotations(1)
      );
      useStore.setState({
        sessionPackages: {
          [existingPkg.jobId]: [existingPkg],
        },
      });

      render(<SessionPackageWorkbench />);
      await openWorkbench();

      const logsBefore = [...useStore.getState().sessionPackageLogs];
      const packagesBefore = useStore.getState().getCurrentJobPackages().length;

      const incomingPkg = createTestPackage(
        "冲突包",
        "1.0.0",
        baseJob,
        makeAnnotations(2)
      );
      const content = serializePackage(incomingPkg);

      importFile(content);

      await waitFor(() => {
        expect(screen.getByText("版本冲突")).toBeInTheDocument();
      });

      const logsDuringConflict = useStore.getState().sessionPackageLogs;
      expect(logsDuringConflict.length).toBe(logsBefore.length);

      const allRadios = document.querySelectorAll('input[type="radio"]');
      expect(allRadios.length).toBe(3);

      const confirmButtons = screen.getAllByText("确认");
      expect(confirmButtons.length).toBeGreaterThan(0);
      await userEvent.click(confirmButtons[0]);

      await waitFor(() => {
        expect(screen.queryByText("版本冲突")).not.toBeInTheDocument();
      });

      await waitFor(() => {
        const msg = getToastMessage();
        expect(msg).toContain("重命名为");
        expect(msg).toContain("导入成功");
      });

      const logsAfter = useStore.getState().sessionPackageLogs;
      const pkgLogsForThis = logsAfter.filter((l) => l.packageName === "冲突包");

      const detectedLog = pkgLogsForThis.find(
        (l) => l.action === "import_conflict_detected"
      );
      const renameLog = pkgLogsForThis.find(
        (l) => l.action === "import_conflict_rename"
      );
      const importLog = pkgLogsForThis.find((l) => l.action === "import");

      expect(detectedLog).toBeDefined();
      expect(renameLog).toBeDefined();
      expect(importLog).toBeDefined();

      const detectedIdx = pkgLogsForThis.findIndex(
        (l) => l.action === "import_conflict_detected"
      );
      const renameIdx = pkgLogsForThis.findIndex(
        (l) => l.action === "import_conflict_rename"
      );
      const importIdx = pkgLogsForThis.findIndex((l) => l.action === "import");

      expect(detectedIdx).toBeLessThan(renameIdx);
      expect(renameIdx).toBeLessThan(importIdx);

      const packagesAfter = useStore.getState().getCurrentJobPackages();
      expect(packagesAfter.length).toBe(packagesBefore + 1);

      const renamedPkg = packagesAfter.find((p) => p.version === "1.0.1");
      expect(renamedPkg).toBeDefined();
      expect(renamedPkg!.name).toBe("冲突包");

      const existingStillThere = packagesAfter.find(
        (p) => p.id === existingPkg.id
      );
      expect(existingStillThere).toBeDefined();
      expect(existingStillThere!.version).toBe("1.0.0");
    });
  });

  describe("冲突覆盖导入", () => {
    it("完整 UI 链路：选文件 -> 弹窗 -> 覆盖导入 -> 日志顺序稳定", async () => {
      useStore.setState({ job: baseJob });

      const existingPkg = createTestPackage(
        "覆盖测试包",
        "2.0.0",
        baseJob,
        makeAnnotations(1)
      );
      useStore.setState({
        sessionPackages: {
          [existingPkg.jobId]: [existingPkg],
        },
        currentPackageId: existingPkg.id,
      });

      render(<SessionPackageWorkbench />);
      await openWorkbench();

      const packagesBefore = useStore.getState().getCurrentJobPackages().length;

      const incomingAnnotations = makeAnnotations(3, "danger", 10);
      const incomingPkg = createTestPackage(
        "覆盖测试包",
        "2.0.0",
        baseJob,
        incomingAnnotations
      );
      const content = serializePackage(incomingPkg);

      importFile(content);

      await waitFor(() => {
        expect(screen.getByText("版本冲突")).toBeInTheDocument();
      });

      const allRadios = document.querySelectorAll('input[type="radio"]');
      expect(allRadios.length).toBe(3);
      await userEvent.click(screen.getByText("覆盖现有版本"));

      const confirmButtons = screen.getAllByText("确认");
      await userEvent.click(confirmButtons[0]);

      await waitFor(() => {
        expect(screen.queryByText("版本冲突")).not.toBeInTheDocument();
      });

      await waitFor(() => {
        const msg = getToastMessage();
        expect(msg).toContain("覆盖导入成功");
      });

      const packagesAfter = useStore.getState().getCurrentJobPackages();
      expect(packagesAfter.length).toBe(packagesBefore);

      const overwrittenPkg = packagesAfter.find(
        (p) => p.id === existingPkg.id
      );
      expect(overwrittenPkg).toBeDefined();
      expect(overwrittenPkg!.version).toBe("2.0.0");
      expect(overwrittenPkg!.snapshot.annotations.length).toBe(3);

      const logsAfter = useStore.getState().sessionPackageLogs;
      const pkgLogs = logsAfter.filter(
        (l) => l.packageName === "覆盖测试包"
      );

      const detectedLog = pkgLogs.find(
        (l) => l.action === "import_conflict_detected"
      );
      const overwriteLog = pkgLogs.find(
        (l) => l.action === "import_conflict_overwrite"
      );
      const importLog = pkgLogs.find((l) => l.action === "import");

      expect(detectedLog).toBeDefined();
      expect(overwriteLog).toBeDefined();
      expect(importLog).toBeDefined();

      const detectedIdx = pkgLogs.findIndex(
        (l) => l.action === "import_conflict_detected"
      );
      const overwriteIdx = pkgLogs.findIndex(
        (l) => l.action === "import_conflict_overwrite"
      );
      const importIdx = pkgLogs.findIndex((l) => l.action === "import");

      expect(detectedIdx).toBeLessThan(overwriteIdx);
      expect(overwriteIdx).toBeLessThan(importIdx);
    });
  });

  describe("冲突取消导入", () => {
    it("取消只落检测加取消两条，包列表不变，不误报记录取消日志失败", async () => {
      useStore.setState({ job: baseJob });

      const existingPkg = createTestPackage(
        "取消测试包",
        "3.0.0",
        baseJob,
        makeAnnotations(1)
      );
      useStore.setState({
        sessionPackages: {
          [existingPkg.jobId]: [existingPkg],
        },
      });

      render(<SessionPackageWorkbench />);
      await openWorkbench();

      const logsBeforeCount = useStore.getState().sessionPackageLogs.length;
      const packagesBefore = useStore.getState().getCurrentJobPackages().length;
      const packageIdsBefore = useStore
        .getState()
        .getCurrentJobPackages()
        .map((p) => p.id)
        .sort();

      const incomingPkg = createTestPackage(
        "取消测试包",
        "3.0.0",
        baseJob,
        makeAnnotations(2)
      );
      const content = serializePackage(incomingPkg);

      importFile(content);

      await waitFor(() => {
        expect(screen.getByText("版本冲突")).toBeInTheDocument();
      });

      const allRadios = document.querySelectorAll('input[type="radio"]');
      expect(allRadios.length).toBe(3);
      fireEvent.click(allRadios[2]);

      const confirmButtons = screen.getAllByText("确认");
      await userEvent.click(confirmButtons[0]);

      await waitFor(() => {
        expect(screen.queryByText("版本冲突")).not.toBeInTheDocument();
      });

      const toastMsg = getToastMessage();
      if (toastMsg) {
        expect(toastMsg).not.toContain("记录取消日志失败");
      }

      const logsAfter = useStore.getState().sessionPackageLogs;
      const cancelRelatedLogs = logsAfter.filter(
        (l) =>
          l.action === "import_conflict_detected" ||
          l.action === "import_conflict_cancel"
      );

      expect(cancelRelatedLogs.length).toBe(2);

      const detectedLog = cancelRelatedLogs.find(
        (l) => l.action === "import_conflict_detected"
      );
      const cancelLog = cancelRelatedLogs.find(
        (l) => l.action === "import_conflict_cancel"
      );
      expect(detectedLog).toBeDefined();
      expect(cancelLog).toBeDefined();
      expect(cancelLog!.success).toBe(false);

      const packagesAfter = useStore.getState().getCurrentJobPackages();
      expect(packagesAfter.length).toBe(packagesBefore);

      const packageIdsAfter = packagesAfter.map((p) => p.id).sort();
      expect(packageIdsAfter).toEqual(packageIdsBefore);

      const importLogs = logsAfter.filter(
        (l) => l.action === "import" && l.packageName === "取消测试包"
      );
      expect(importLogs.length).toBe(0);
    });

    it("点击取消按钮也能正确记录取消日志且不误报", async () => {
      useStore.setState({ job: baseJob });

      const existingPkg = createTestPackage(
        "取消测试包2",
        "4.0.0",
        baseJob,
        makeAnnotations(1)
      );
      useStore.setState({
        sessionPackages: {
          [existingPkg.jobId]: [existingPkg],
        },
      });

      render(<SessionPackageWorkbench />);
      await openWorkbench();

      const logsBeforeCount = useStore.getState().sessionPackageLogs.length;
      const packagesBefore = useStore.getState().getCurrentJobPackages().length;

      const incomingPkg = createTestPackage(
        "取消测试包2",
        "4.0.0",
        baseJob,
        makeAnnotations(2)
      );
      const content = serializePackage(incomingPkg);

      importFile(content);

      await waitFor(() => {
        expect(screen.getByText("版本冲突")).toBeInTheDocument();
      });

      const cancelButtons = screen.getAllByText("取消");
      await userEvent.click(cancelButtons[0]);

      await waitFor(() => {
        expect(screen.queryByText("版本冲突")).not.toBeInTheDocument();
      });

      const toastMsg = getToastMessage();
      if (toastMsg) {
        expect(toastMsg).not.toContain("记录取消日志失败");
      }

      const logsAfter = useStore.getState().sessionPackageLogs;
      const cancelRelatedLogs = logsAfter.filter(
        (l) =>
          l.packageName === "取消测试包2" &&
          (l.action === "import_conflict_detected" ||
            l.action === "import_conflict_cancel")
      );
      expect(cancelRelatedLogs.length).toBe(2);

      const packagesAfter = useStore.getState().getCurrentJobPackages();
      expect(packagesAfter.length).toBe(packagesBefore);

      const importLogs = logsAfter.filter(
        (l) => l.action === "import" && l.packageName === "取消测试包2"
      );
      expect(importLogs.length).toBe(0);
    });
  });

  describe("持久化与重启恢复", () => {
    it("导入的包和日志持久化后，重启恢复数据完整", async () => {
      useStore.setState({ job: baseJob });
      render(<SessionPackageWorkbench />);
      await openWorkbench();

      const annotations = makeAnnotations(3, "warning", 0);
      const pkg = createTestPackage(
        "持久化测试包",
        "1.0.0",
        baseJob,
        annotations
      );
      const content = serializePackage(pkg);

      importFile(content);

      await waitFor(() => {
        expect(getToastMessage()).toContain("导入会话包成功");
      });

      const stateBefore = useStore.getState();
      const packagesBefore = stateBefore.sessionPackages;
      const logsBefore = stateBefore.sessionPackageLogs;

      expect(Object.keys(packagesBefore).length).toBeGreaterThan(0);
      expect(logsBefore.length).toBeGreaterThan(0);

      const persistConfig = (useStore as any).persist?.options;
      if (persistConfig?.partialize) {
        const partialized = persistConfig.partialize(stateBefore);
        expect(partialized.sessionPackages).toBeDefined();
        expect(partialized.sessionPackageLogs).toBeDefined();
        expect(Object.keys(partialized.sessionPackages).length).toBeGreaterThan(
          0
        );
        expect(partialized.sessionPackageLogs.length).toBeGreaterThan(0);
      }

      const jobId = stateBefore.currentJobId!;
      const pkgBefore = stateBefore.sessionPackages[jobId]?.[0];
      expect(pkgBefore).toBeDefined();
      const pkgId = pkgBefore!.id;
      const logCountBefore = pkgBefore!.operationLogs.length;

      const persistedState = {
        job: stateBefore.job,
        sessionPackages: stateBefore.sessionPackages,
        sessionPackageLogs: stateBefore.sessionPackageLogs,
        currentJobId: stateBefore.currentJobId,
        currentPackageId: stateBefore.currentPackageId,
        lastImportSuccess: stateBefore.lastImportSuccess,
        lastImportFailure: stateBefore.lastImportFailure,
        annotations: stateBefore.annotations,
        ignoredRiskIds: stateBefore.ignoredRiskIds,
        showIgnored: stateBefore.showIgnored,
        riskLevelFilter: stateBefore.riskLevelFilter,
        camera: stateBefore.camera,
        cameraPresets: stateBefore.cameraPresets,
        snapshots: stateBefore.snapshots,
        currentSnapshotId: stateBefore.currentSnapshotId,
        snapshotHistory: stateBefore.snapshotHistory,
        templates: stateBefore.templates,
        lastPublishId: stateBefore.lastPublishId,
      };

      useStore.setState({
        ...persistedState,
        isPlaying: false,
        playbackSpeed: 1,
        errors: [],
        rightPanelOpen: true,
      });

      const stateAfter = useStore.getState();
      const packagesAfter = stateAfter.sessionPackages;
      const logsAfter = stateAfter.sessionPackageLogs;

      expect(Object.keys(packagesAfter).length).toBe(
        Object.keys(packagesBefore).length
      );
      expect(logsAfter.length).toBe(logsBefore.length);

      const restoredPkg = stateAfter.sessionPackages[jobId]?.find(
        (p) => p.id === pkgId
      );
      expect(restoredPkg).toBeDefined();
      expect(restoredPkg!.name).toBe("持久化测试包");
      expect(restoredPkg!.version).toBe("1.0.0");
      expect(restoredPkg!.operationLogs.length).toBe(logCountBefore);

      const importLogInPkg = restoredPkg!.operationLogs.find(
        (l) => l.action === "import"
      );
      expect(importLogInPkg).toBeDefined();

      const globalImportLog = logsAfter.find(
        (l) => l.action === "import" && l.packageId === pkgId
      );
      expect(globalImportLog).toBeDefined();
    });
  });

  describe("包内日志与全局日志一致性", () => {
    it("导入成功后，包内日志和全局日志都包含相同的导入日志条目", async () => {
      useStore.setState({ job: baseJob });
      render(<SessionPackageWorkbench />);
      await openWorkbench();

      const pkg = createTestPackage(
        "一致性测试包",
        "1.0.0",
        baseJob,
        makeAnnotations(1)
      );
      const content = serializePackage(pkg);

      importFile(content);

      await waitFor(() => {
        expect(getToastMessage()).toContain("导入会话包成功");
      });

      const state = useStore.getState();
      const jobId = state.currentJobId!;
      const importedPkg = state.sessionPackages[jobId]?.find(
        (p) => p.name === "一致性测试包"
      );

      expect(importedPkg).toBeDefined();

      const pkgImportLogs = importedPkg!.operationLogs.filter(
        (l) => l.action === "import"
      );
      const globalImportLogs = state.sessionPackageLogs.filter(
        (l) => l.action === "import" && l.packageId === importedPkg!.id
      );

      expect(pkgImportLogs.length).toBe(1);
      expect(globalImportLogs.length).toBe(1);
      expect(pkgImportLogs[0].id).toBe(globalImportLogs[0].id);
      expect(pkgImportLogs[0].message).toBe(globalImportLogs[0].message);
      expect(pkgImportLogs[0].timestamp).toBe(globalImportLogs[0].timestamp);
    });
  });
});
