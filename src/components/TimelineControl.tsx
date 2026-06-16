import { useEffect, useRef, useCallback, useState } from "react";
import { Play, Pause } from "lucide-react";
import { useStore } from "@/store/useStore";

const SPEEDS = [0.5, 1, 2, 4];

function formatTime(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  const millis = Math.floor((ms % 1000) / 10);
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}.${String(millis).padStart(2, "0")}`;
}

function getRiskColor(level: "safe" | "warning" | "danger" | undefined) {
  if (level === "danger") return "text-red-500";
  if (level === "warning") return "text-orange-400";
  return "text-green-400";
}

function getRiskBg(level: "safe" | "warning" | "danger" | undefined) {
  if (level === "danger") return "bg-red-500/20 border-red-500/40";
  if (level === "warning") return "bg-orange-400/20 border-orange-400/40";
  return "bg-green-400/20 border-green-400/40";
}

function getRiskLabel(level: "safe" | "warning" | "danger" | undefined) {
  if (level === "danger") return "危险";
  if (level === "warning") return "警告";
  return "安全";
}

function interpolateTrajectoryPoint(
  trajectory: { timestamp: number; load: number; radius: number; riskLevel?: "safe" | "warning" | "danger" }[],
  currentTime: number
) {
  if (trajectory.length === 0) return { load: 0, radius: 0, riskLevel: undefined as "safe" | "warning" | "danger" | undefined };
  if (currentTime <= trajectory[0].timestamp) return { load: trajectory[0].load, radius: trajectory[0].radius, riskLevel: trajectory[0].riskLevel };
  const last = trajectory[trajectory.length - 1];
  if (currentTime >= last.timestamp) return { load: last.load, radius: last.radius, riskLevel: last.riskLevel };

  for (let i = 0; i < trajectory.length - 1; i++) {
    const a = trajectory[i];
    const b = trajectory[i + 1];
    if (currentTime >= a.timestamp && currentTime <= b.timestamp) {
      const t = (currentTime - a.timestamp) / (b.timestamp - a.timestamp);
      return {
        load: a.load + (b.load - a.load) * t,
        radius: a.radius + (b.radius - a.radius) * t,
        riskLevel: currentTime - a.timestamp < b.timestamp - currentTime ? a.riskLevel : b.riskLevel,
      };
    }
  }
  return { load: last.load, radius: last.radius, riskLevel: last.riskLevel };
}

export default function TimelineControl() {
  const currentTime = useStore((s) => s.currentTime);
  const isPlaying = useStore((s) => s.isPlaying);
  const playbackSpeed = useStore((s) => s.playbackSpeed);
  const job = useStore((s) => s.job);
  const setCurrentTime = useStore((s) => s.setCurrentTime);
  const setIsPlaying = useStore((s) => s.setIsPlaying);
  const setPlaybackSpeed = useStore((s) => s.setPlaybackSpeed);

  const rafRef = useRef<number>(0);
  const prevTimestampRef = useRef<number>(0);
  const barRef = useRef<HTMLDivElement>(null);
  const [isDragging, setIsDragging] = useState(false);

  const totalDuration = job?.trajectory
    ? job.trajectory[job.trajectory.length - 1]?.timestamp ?? 0
    : 0;

  const currentData = job?.trajectory
    ? interpolateTrajectoryPoint(job.trajectory, currentTime)
    : { load: 0, radius: 0, riskLevel: undefined as "safe" | "warning" | "danger" | undefined };

  useEffect(() => {
    if (!isPlaying || totalDuration === 0) {
      prevTimestampRef.current = 0;
      return;
    }

    const tick = (timestamp: number) => {
      if (prevTimestampRef.current === 0) {
        prevTimestampRef.current = timestamp;
      }
      const delta = timestamp - prevTimestampRef.current;
      prevTimestampRef.current = timestamp;

      setCurrentTime(currentTime + delta * playbackSpeed);

      const latestTime = useStore.getState().currentTime;
      if (latestTime >= totalDuration) {
        setIsPlaying(false);
        setCurrentTime(totalDuration);
        return;
      }

      rafRef.current = requestAnimationFrame(tick);
    };

    rafRef.current = requestAnimationFrame(tick);

    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [isPlaying, playbackSpeed, totalDuration]);

  useEffect(() => {
    if (isDragging) {
      setIsPlaying(false);
    }
  }, [isDragging]);

  const handleBarMouseDown = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (!barRef.current || totalDuration === 0) return;
      setIsDragging(true);

      const handleMove = (moveEvent: MouseEvent) => {
        const rect = barRef.current!.getBoundingClientRect();
        const x = Math.max(0, Math.min(moveEvent.clientX - rect.left, rect.width));
        const ratio = x / rect.width;
        setCurrentTime(ratio * totalDuration);
      };

      const handleUp = () => {
        setIsDragging(false);
        window.removeEventListener("mousemove", handleMove);
        window.removeEventListener("mouseup", handleUp);
      };

      const rect = barRef.current.getBoundingClientRect();
      const x = Math.max(0, Math.min(e.clientX - rect.left, rect.width));
      const ratio = x / rect.width;
      setCurrentTime(ratio * totalDuration);

      window.addEventListener("mousemove", handleMove);
      window.addEventListener("mouseup", handleUp);
    },
    [totalDuration]
  );

  const progress = totalDuration > 0 ? (currentTime / totalDuration) * 100 : 0;

  return (
    <div className="fixed bottom-0 left-0 w-full h-16 bg-[#0F1B2D] border-t border-white/10 flex items-center px-4 gap-4 z-50 select-none">
      <button
        onClick={() => setIsPlaying(!isPlaying)}
        className="w-9 h-9 flex items-center justify-center rounded-md bg-white/10 hover:bg-white/20 transition-colors text-white shrink-0"
      >
        {isPlaying ? <Pause size={18} /> : <Play size={18} />}
      </button>

      <span className="text-xs font-mono text-slate-400 w-[80px] text-right shrink-0">
        {formatTime(currentTime)}
      </span>

      <div
        ref={barRef}
        className="flex-1 h-2 bg-white/10 rounded-full cursor-pointer relative group"
        onMouseDown={handleBarMouseDown}
      >
        <div
          className="h-full bg-cyan-500 rounded-full transition-[width] duration-75"
          style={{ width: `${progress}%` }}
        />
        <div
          className="absolute top-1/2 -translate-y-1/2 w-3.5 h-3.5 bg-cyan-400 rounded-full shadow-lg shadow-cyan-500/40 opacity-0 group-hover:opacity-100 transition-opacity"
          style={{ left: `calc(${progress}% - 7px)` }}
        />
      </div>

      <span className="text-xs font-mono text-slate-500 w-[80px] shrink-0">
        {formatTime(totalDuration)}
      </span>

      <div className="flex items-center gap-1 shrink-0">
        {SPEEDS.map((speed) => (
          <button
            key={speed}
            onClick={() => setPlaybackSpeed(speed)}
            className={`px-2 py-0.5 text-xs font-mono rounded transition-colors ${
              playbackSpeed === speed
                ? "bg-cyan-500/30 text-cyan-300 border border-cyan-500/50"
                : "bg-white/5 text-slate-400 border border-transparent hover:bg-white/10"
            }`}
          >
            {speed}x
          </button>
        ))}
      </div>

      <div className="h-8 w-px bg-white/10 shrink-0" />

      <div className="flex items-center gap-3 shrink-0">
        <div className={`px-2 py-1 rounded border text-xs font-mono ${getRiskBg(currentData.riskLevel)}`}>
          <span className="text-slate-400 mr-1">载重</span>
          <span className={getRiskColor(currentData.riskLevel)}>{currentData.load.toFixed(1)}t</span>
        </div>
        <div className={`px-2 py-1 rounded border text-xs font-mono ${getRiskBg(currentData.riskLevel)}`}>
          <span className="text-slate-400 mr-1">作业半径</span>
          <span className={getRiskColor(currentData.riskLevel)}>{currentData.radius.toFixed(1)}m</span>
        </div>
        <div className={`px-2 py-1 rounded border text-xs font-mono ${getRiskBg(currentData.riskLevel)}`}>
          <span className="text-slate-400 mr-1">风险等级</span>
          <span className={getRiskColor(currentData.riskLevel)}>{getRiskLabel(currentData.riskLevel)}</span>
        </div>
      </div>
    </div>
  );
}
