import { useState, useCallback } from "react";
import { Camera, Save, Trash2, Eye } from "lucide-react";
import { useStore } from "@/store/useStore";
import type { CameraPreset } from "@/types";

function dispatchCameraGoto(position: [number, number, number], target: [number, number, number]) {
  window.dispatchEvent(new CustomEvent("camera-goto", { detail: { position, target } }));
}

function requestCurrentCamera(): Promise<{ position: [number, number, number]; target: [number, number, number] } | null> {
  return new Promise((resolve) => {
    const handler = (e: Event) => {
      window.removeEventListener("camera-state-response", handler);
      const detail = (e as CustomEvent).detail;
      resolve(detail ?? null);
    };
    window.addEventListener("camera-state-response", handler);
    window.dispatchEvent(new CustomEvent("camera-state-request"));
    setTimeout(() => {
      window.removeEventListener("camera-state-response", handler);
      resolve(null);
    }, 500);
  });
}

export default function CameraPanel() {
  const cameraPresets = useStore((s) => s.cameraPresets);
  const addCameraPreset = useStore((s) => s.addCameraPreset);
  const removeCameraPreset = useStore((s) => s.removeCameraPreset);
  const [presetName, setPresetName] = useState("");
  const [collapsed, setCollapsed] = useState(false);

  const handlePresetClick = (preset: CameraPreset) => {
    dispatchCameraGoto(preset.position, preset.target);
  };

  const handleSave = useCallback(async () => {
    const trimmed = presetName.trim();
    if (!trimmed) return;
    const camState = await requestCurrentCamera();
    addCameraPreset({
      id: `custom-${Date.now()}`,
      name: trimmed,
      position: camState?.position ?? [0, 30, 40],
      target: camState?.target ?? [0, 10, 0],
    });
    setPresetName("");
  }, [presetName, addCameraPreset]);

  const isDefaultPreset = (id: string) => id.startsWith("preset-");

  return (
    <div className="fixed top-4 right-4 z-50 flex flex-col gap-2 w-56">
      <button
        onClick={() => setCollapsed(!collapsed)}
        className="flex items-center gap-2 px-3 py-2 rounded-lg bg-[#0F1B2D]/90 backdrop-blur text-[#8BA4C7] hover:text-white hover:bg-[#162844] transition-colors text-sm font-medium border border-[#1E3A5F]/60"
      >
        <Camera size={16} />
        <span>摄像机预置</span>
        <span className="ml-auto text-xs text-[#5A7A9E]">
          {collapsed ? "▸" : "▾"}
        </span>
      </button>

      {!collapsed && (
        <div className="bg-[#0F1B2D]/90 backdrop-blur rounded-lg border border-[#1E3A5F]/60 overflow-hidden">
          <div className="max-h-72 overflow-y-auto">
            {cameraPresets.map((preset) => (
              <div
                key={preset.id}
                className="flex items-center gap-2 px-3 py-2 hover:bg-[#162844] transition-colors group"
              >
                <button
                  onClick={() => handlePresetClick(preset)}
                  className="flex items-center gap-2 flex-1 text-sm text-[#8BA4C7] hover:text-white transition-colors min-w-0"
                >
                  <Eye size={14} className="shrink-0" />
                  <span className="truncate">{preset.name}</span>
                </button>
                {!isDefaultPreset(preset.id) && (
                  <button
                    onClick={() => removeCameraPreset(preset.id)}
                    className="opacity-0 group-hover:opacity-100 text-[#5A7A9E] hover:text-red-400 transition-all shrink-0"
                  >
                    <Trash2 size={13} />
                  </button>
                )}
              </div>
            ))}
          </div>

          <div className="border-t border-[#1E3A5F]/60 p-2 flex gap-2">
            <input
              type="text"
              value={presetName}
              onChange={(e) => setPresetName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleSave()}
              placeholder="自定义名称"
              className="flex-1 min-w-0 bg-[#0A1628] border border-[#1E3A5F]/60 rounded px-2 py-1.5 text-xs text-[#8BA4C7] placeholder-[#3D5A7A] outline-none focus:border-[#3B82F6] transition-colors"
            />
            <button
              onClick={handleSave}
              disabled={!presetName.trim()}
              className="flex items-center justify-center px-2 py-1.5 rounded bg-[#162844] text-[#5A7A9E] hover:text-white hover:bg-[#1E3A5F] disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
            >
              <Save size={14} />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
