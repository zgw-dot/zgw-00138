import { Grid, GizmoHelper, GizmoViewport } from "@react-three/drei";
import { useStore } from "@/store/useStore";

export default function GroundGrid() {
  const job = useStore((s) => s.job);

  return (
    <group>
      <Grid
        args={[100, 100]}
        cellSize={1}
        cellThickness={0.5}
        cellColor="#2D3748"
        sectionSize={5}
        sectionThickness={1}
        sectionColor="#4A5568"
        fadeDistance={80}
        fadeStrength={1}
        followCamera={false}
        infiniteGrid
      />

      {/* 地面 */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.01, 0]} receiveShadow>
        <planeGeometry args={[200, 200]} />
        <meshStandardMaterial
          color="#0A1628"
          transparent
          opacity={0.95}
        />
      </mesh>

      {/* 中心标记 */}
      <mesh position={[0, 0.02, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[0.8, 1, 32]} />
        <meshStandardMaterial color="#FF6B35" side={2} />
      </mesh>

      {/* 坐标轴标记线 X */}
      <line>
        <bufferGeometry>
          <bufferAttribute
            attach="attributes-position"
            count={2}
            array={new Float32Array([0, 0.05, 0, 50, 0.05, 0])}
            itemSize={3}
          />
        </bufferGeometry>
        <lineBasicMaterial color="#E53E3E" transparent opacity={0.4} />
      </line>

      {/* 坐标轴标记线 Z */}
      <line>
        <bufferGeometry>
          <bufferAttribute
            attach="attributes-position"
            count={2}
            array={new Float32Array([0, 0.05, 0, 0, 0.05, 50])}
            itemSize={3}
          />
        </bufferGeometry>
        <lineBasicMaterial color="#4A90D9" transparent opacity={0.4} />
      </line>

      {/* Y轴 */}
      <line>
        <bufferGeometry>
          <bufferAttribute
            attach="attributes-position"
            count={2}
            array={new Float32Array([0, 0, 0, 0, 40, 0])}
            itemSize={3}
          />
        </bufferGeometry>
        <lineBasicMaterial color="#38A169" transparent opacity={0.4} />
      </line>

      <GizmoHelper alignment="bottom-left" margin={[80, 80]}>
        <GizmoViewport labelColor="white" axisHeadScale={1} />
      </GizmoHelper>
    </group>
  );
}
