import { useMemo } from "react";
import { useStore } from "@/store/useStore";

export default function WorkingRadius() {
  const job = useStore((s) => s.job);
  const currentTime = useStore((s) => s.currentTime);

  const currentRadius = useMemo(() => {
    if (!job?.trajectory.length) return 0;
    const traj = job.trajectory;
    if (currentTime <= traj[0].timestamp) return traj[0].radius;
    if (currentTime >= traj[traj.length - 1].timestamp)
      return traj[traj.length - 1].radius;
    for (let i = 0; i < traj.length - 1; i++) {
      if (currentTime >= traj[i].timestamp && currentTime <= traj[i + 1].timestamp) {
        const t =
          (currentTime - traj[i].timestamp) /
          (traj[i + 1].timestamp - traj[i].timestamp);
        return traj[i].radius + t * (traj[i + 1].radius - traj[i].radius);
      }
    }
    return 0;
  }, [job, currentTime]);

  const maxRadius = job?.crane.maxRadius ?? 35;

  if (!job || currentRadius <= 0) return null;

  return (
    <group position={[job.crane.position[0], 0.05, job.crane.position[2]]}>
      {/* 最大作业半径圆 */}
      <mesh rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[maxRadius - 0.15, maxRadius, 64]} />
        <meshStandardMaterial
          color="#4A90D9"
          transparent
          opacity={0.3}
          side={2}
        />
      </mesh>

      {/* 当前作业半径扇面 */}
      <mesh rotation={[-Math.PI / 2, 0, 0]}>
        <circleGeometry args={[currentRadius, 64]} />
        <meshStandardMaterial
          color="#38A169"
          transparent
          opacity={0.08}
          side={2}
        />
      </mesh>

      {/* 当前作业半径圈 */}
      <mesh rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[currentRadius - 0.1, currentRadius, 64]} />
        <meshStandardMaterial
          color="#38A169"
          transparent
          opacity={0.5}
          side={2}
        />
      </mesh>

      {/* 半径线 */}
      <line>
        <bufferGeometry>
          <bufferAttribute
            attach="attributes-position"
            count={2}
            array={new Float32Array([0, 0.1, 0, currentRadius, 0.1, 0])}
            itemSize={3}
          />
        </bufferGeometry>
        <lineBasicMaterial color="#38A169" transparent opacity={0.4} />
      </line>
    </group>
  );
}
