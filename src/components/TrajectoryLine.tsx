import { useMemo } from "react";
import { Line } from "@react-three/drei";
import { useStore } from "@/store/useStore";

export default function TrajectoryLine() {
  const job = useStore((s) => s.job);
  const currentTime = useStore((s) => s.currentTime);

  const points = useMemo(() => {
    if (!job?.trajectory.length) return [];
    return job.trajectory.map(
      (pt) => pt.hookPosition as [number, number, number]
    );
  }, [job]);

  const colors = useMemo(() => {
    if (!job?.trajectory.length) return [];
    return job.trajectory.map((pt) => {
      const riskLevel = pt.riskLevel || "safe";
      if (riskLevel === "danger") return "#E53E3E";
      if (riskLevel === "warning") return "#FF6B35";
      return "#38A169";
    });
  }, [job]);

  const currentPointIndex = useMemo(() => {
    if (!job?.trajectory.length) return -1;
    const traj = job.trajectory;
    for (let i = traj.length - 1; i >= 0; i--) {
      if (traj[i].timestamp <= currentTime) return i;
    }
    return 0;
  }, [job, currentTime]);

  if (points.length < 2) return null;

  return (
    <group>
      {/* 已走过的轨迹 */}
      {currentPointIndex > 0 && (
        <Line
          points={points.slice(0, currentPointIndex + 1)}
          color="#38A169"
          lineWidth={3}
          dashed={false}
        />
      )}

      {/* 完整轨迹（虚线） */}
      <Line
        points={points}
        color="#4A5568"
        lineWidth={1}
        dashed
        dashSize={0.5}
        gapSize={0.3}
      />

      {/* 风险点标记 */}
      {job?.trajectory.map((pt, i) => {
        if (pt.riskLevel === "danger" || pt.riskLevel === "warning") {
          return (
            <mesh key={i} position={pt.hookPosition as [number, number, number]}>
              <sphereGeometry
                args={[pt.riskLevel === "danger" ? 0.6 : 0.4, 12, 12]}
              />
              <meshStandardMaterial
                color={pt.riskLevel === "danger" ? "#E53E3E" : "#FF6B35"}
                emissive={pt.riskLevel === "danger" ? "#E53E3E" : "#FF6B35"}
                emissiveIntensity={0.6}
                transparent
                opacity={0.8}
              />
            </mesh>
          );
        }
        return null;
      })}

      {/* 当前位置标记 */}
      {currentPointIndex >= 0 && currentPointIndex < points.length && (
        <mesh position={points[currentPointIndex]}>
          <sphereGeometry args={[0.5, 16, 16]} />
          <meshStandardMaterial
            color="#FFD700"
            emissive="#FFD700"
            emissiveIntensity={0.8}
          />
        </mesh>
      )}
    </group>
  );
}
