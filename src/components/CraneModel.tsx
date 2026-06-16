import { useRef, useMemo } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { useStore } from "@/store/useStore";

export default function CraneModel() {
  const groupRef = useRef<THREE.Group>(null);
  const job = useStore((s) => s.job);
  const currentTime = useStore((s) => s.currentTime);

  const craneConfig = job?.crane;

  const interpolatedBoomAngle = useMemo(() => {
    if (!job || !job.trajectory.length) return craneConfig?.boomAngle ?? 60;
    const traj = job.trajectory;
    if (currentTime <= traj[0].timestamp) return traj[0].boomAngle;
    if (currentTime >= traj[traj.length - 1].timestamp)
      return traj[traj.length - 1].boomAngle;
    for (let i = 0; i < traj.length - 1; i++) {
      if (currentTime >= traj[i].timestamp && currentTime <= traj[i + 1].timestamp) {
        const t =
          (currentTime - traj[i].timestamp) /
          (traj[i + 1].timestamp - traj[i].timestamp);
        return traj[i].boomAngle + t * (traj[i + 1].boomAngle - traj[i].boomAngle);
      }
    }
    return craneConfig?.boomAngle ?? 60;
  }, [job, currentTime, craneConfig]);

  const hookPos = useMemo((): [number, number, number] => {
    if (!job || !job.trajectory.length) return [0, 25, 0];
    const traj = job.trajectory;
    if (currentTime <= traj[0].timestamp) return traj[0].hookPosition;
    if (currentTime >= traj[traj.length - 1].timestamp)
      return traj[traj.length - 1].hookPosition;
    for (let i = 0; i < traj.length - 1; i++) {
      if (currentTime >= traj[i].timestamp && currentTime <= traj[i + 1].timestamp) {
        const t =
          (currentTime - traj[i].timestamp) /
          (traj[i + 1].timestamp - traj[i].timestamp);
        return [
          traj[i].hookPosition[0] +
            t * (traj[i + 1].hookPosition[0] - traj[i].hookPosition[0]),
          traj[i].hookPosition[1] +
            t * (traj[i + 1].hookPosition[1] - traj[i].hookPosition[1]),
          traj[i].hookPosition[2] +
            t * (traj[i + 1].hookPosition[2] - traj[i].hookPosition[2]),
        ];
      }
    }
    return [0, 25, 0];
  }, [job, currentTime]);

  const towerHeight = 30;
  const boomLen = craneConfig?.boomLength ?? 30;

  useFrame(() => {
    if (!groupRef.current) return;
  });

  if (!craneConfig) return null;

  return (
    <group ref={groupRef} position={craneConfig.position as unknown as THREE.Vector3}>
      {/* 塔身 */}
      <mesh position={[0, towerHeight / 2, 0]}>
        <boxGeometry args={[2, towerHeight, 2]} />
        <meshStandardMaterial color="#FF6B35" metalness={0.6} roughness={0.4} />
      </mesh>

      {/* 塔身交叉支撑 */}
      {[5, 10, 15, 20, 25].map((h) => (
        <group key={h} position={[0, h, 0]}>
          <mesh rotation={[0, 0, Math.PI / 4]}>
            <boxGeometry args={[2.5, 0.15, 0.15]} />
            <meshStandardMaterial color="#CC5522" metalness={0.5} roughness={0.5} />
          </mesh>
          <mesh rotation={[0, 0, -Math.PI / 4]}>
            <boxGeometry args={[2.5, 0.15, 0.15]} />
            <meshStandardMaterial color="#CC5522" metalness={0.5} roughness={0.5} />
          </mesh>
        </group>
      ))}

      {/* 驾驶室 */}
      <mesh position={[0, towerHeight - 2, 1.5]}>
        <boxGeometry args={[2.5, 2, 2]} />
        <meshStandardMaterial color="#4A90D9" metalness={0.3} roughness={0.5} />
      </mesh>

      {/* 吊臂 */}
      <group
        position={[0, towerHeight, 0]}
        rotation={[0, 0, ((interpolatedBoomAngle - 90) * Math.PI) / 180]}
      >
        <mesh position={[boomLen / 2, 0, 0]}>
          <boxGeometry args={[boomLen, 1, 0.6]} />
          <meshStandardMaterial color="#FF6B35" metalness={0.6} roughness={0.4} />
        </mesh>

        {/* 吊臂桁架 */}
        {[boomLen * 0.25, boomLen * 0.5, boomLen * 0.75].map((x) => (
          <mesh key={x} position={[x, -0.5, 0]}>
            <boxGeometry args={[0.1, 1.5, 0.1]} />
            <meshStandardMaterial color="#CC5522" metalness={0.5} roughness={0.5} />
          </mesh>
        ))}

        {/* 平衡臂 */}
        <mesh position={[-8, 0, 0]}>
          <boxGeometry args={[10, 0.8, 0.6]} />
          <meshStandardMaterial color="#888888" metalness={0.5} roughness={0.5} />
        </mesh>

        {/* 配重 */}
        <mesh position={[-12, -0.5, 0]}>
          <boxGeometry args={[3, 1.5, 1.5]} />
          <meshStandardMaterial color="#555555" metalness={0.7} roughness={0.3} />
        </mesh>
      </group>

      {/* 吊钩绳索与吊钩 */}
      {(() => {
        const craneBase = craneConfig.position;
        const ropeStart: [number, number, number] = [
          craneBase[0] + hookPos[0] * 0.3,
          towerHeight,
          craneBase[2] + hookPos[2] * 0.3,
        ];
        return (
          <group>
            {/* 绳索 */}
            <line>
              <bufferGeometry>
                <bufferAttribute
                  attach="attributes-position"
                  count={2}
                  array={new Float32Array([
                    ropeStart[0], ropeStart[1], ropeStart[2],
                    craneBase[0] + hookPos[0], hookPos[1], craneBase[2] + hookPos[2],
                  ])}
                  itemSize={3}
                />
              </bufferGeometry>
              <lineBasicMaterial color="#AAAAAA" linewidth={2} />
            </line>

            {/* 吊钩 */}
            <mesh
              position={[
                craneBase[0] + hookPos[0],
                hookPos[1],
                craneBase[2] + hookPos[2],
              ]}
            >
              <cylinderGeometry args={[0.3, 0.5, 1, 8]} />
              <meshStandardMaterial
                color="#FFD700"
                metalness={0.8}
                roughness={0.2}
                emissive="#FFD700"
                emissiveIntensity={0.3}
              />
            </mesh>

            {/* 吊钩指示球 */}
            <mesh
              position={[
                craneBase[0] + hookPos[0],
                hookPos[1] - 0.8,
                craneBase[2] + hookPos[2],
              ]}
            >
              <sphereGeometry args={[0.4, 16, 16]} />
              <meshStandardMaterial
                color="#FFD700"
                emissive="#FFD700"
                emissiveIntensity={0.5}
              />
            </mesh>
          </group>
        );
      })()}
    </group>
  );
}
