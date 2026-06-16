import { useMemo } from "react";
import { Edges } from "@react-three/drei";
import type { RestrictedZone } from "@/types";
import { useStore } from "@/store/useStore";

function BoxZone({ zone }: { zone: RestrictedZone }) {
  const w = zone.size.width ?? 4;
  const h = zone.size.height ?? 4;
  const d = zone.size.depth ?? 4;
  const color = zone.color ?? "#ff4444";

  return (
    <group position={zone.position as [number, number, number]}>
      <mesh>
        <boxGeometry args={[w, h, d]} />
        <meshStandardMaterial
          color={color}
          transparent
          opacity={0.15}
          side={2}
          depthWrite={false}
        />
      </mesh>
      <mesh>
        <boxGeometry args={[w, h, d]} />
        <meshStandardMaterial
          color={color}
          transparent
          opacity={0.3}
          wireframe
        />
      </mesh>
      <mesh>
        <boxGeometry args={[w, h, d]} />
        <Edges color={color} lineWidth={2} threshold={15} />
      </mesh>
    </group>
  );
}

function CylinderZone({ zone }: { zone: RestrictedZone }) {
  const r = zone.size.radius ?? 3;
  const h = zone.size.height ?? 4;
  const color = zone.color ?? "#ff8800";

  return (
    <group position={zone.position as [number, number, number]}>
      <mesh>
        <cylinderGeometry args={[r, r, h, 24]} />
        <meshStandardMaterial
          color={color}
          transparent
          opacity={0.15}
          side={2}
          depthWrite={false}
        />
      </mesh>
      <mesh>
        <cylinderGeometry args={[r, r, h, 24]} />
        <meshStandardMaterial
          color={color}
          transparent
          opacity={0.3}
          wireframe
        />
      </mesh>
      <mesh position={[0, h / 2 + 0.3, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[r - 0.2, r, 32]} />
        <meshStandardMaterial
          color={color}
          transparent
          opacity={0.5}
          side={2}
        />
      </mesh>
    </group>
  );
}

export default function RestrictedZones() {
  const job = useStore((s) => s.job);

  const zones = useMemo(() => {
    return job?.restrictedZones ?? [];
  }, [job]);

  return (
    <group>
      {zones.map((zone) =>
        zone.type === "box" ? (
          <BoxZone key={zone.id} zone={zone} />
        ) : (
          <CylinderZone key={zone.id} zone={zone} />
        )
      )}
    </group>
  );
}
