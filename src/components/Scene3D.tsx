import { useRef, useEffect, useCallback, useMemo } from "react";
import { Canvas, useThree, useFrame } from "@react-three/fiber";
import { OrbitControls, Html } from "@react-three/drei";
import * as THREE from "three";
import CraneModel from "./CraneModel";
import TrajectoryLine from "./TrajectoryLine";
import RestrictedZones from "./RestrictedZones";
import WorkingRadius from "./WorkingRadius";
import GroundGrid from "./GroundGrid";
import { useStore } from "@/store/useStore";

function CameraController() {
  const { camera } = useThree();
  const controlsRef = useRef<any>(null);

  const goToPreset = useCallback(
    (position: [number, number, number], target: [number, number, number]) => {
      const cam = camera as THREE.PerspectiveCamera;
      cam.position.set(...position);
      cam.lookAt(...target);
      cam.updateProjectionMatrix();
      if (controlsRef.current) {
        controlsRef.current.target.set(...target);
        controlsRef.current.update();
      }
    },
    [camera]
  );

  useEffect(() => {
    const gotoHandler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail?.position && detail?.target) {
        goToPreset(
          detail.position as [number, number, number],
          detail.target as [number, number, number]
        );
      }
    };

    const stateRequestHandler = () => {
      const pos = camera.position;
      const target = controlsRef.current?.target;
      if (target) {
        window.dispatchEvent(
          new CustomEvent("camera-state-response", {
            detail: {
              position: [pos.x, pos.y, pos.z] as [number, number, number],
              target: [target.x, target.y, target.z] as [number, number, number],
            },
          })
        );
      }
    };

    window.addEventListener("camera-goto", gotoHandler);
    window.addEventListener("camera-state-request", stateRequestHandler);
    return () => {
      window.removeEventListener("camera-goto", gotoHandler);
      window.removeEventListener("camera-state-request", stateRequestHandler);
    };
  }, [goToPreset, camera]);

  useFrame(() => {
    if (controlsRef.current) {
      controlsRef.current.update();
    }
  });

  return (
    <OrbitControls
      ref={controlsRef}
      enableDamping
      dampingFactor={0.05}
      minDistance={5}
      maxDistance={150}
      maxPolarAngle={Math.PI / 2.05}
    />
  );
}

function AnnotationMarkers() {
  const annotations = useStore((s) => s.annotations);
  const ignoredRiskIds = useStore((s) => s.ignoredRiskIds);
  const showIgnored = useStore((s) => s.showIgnored);

  const visibleAnnotations = useMemo(() => {
    if (showIgnored) return annotations;
    return annotations.filter((a) => !ignoredRiskIds.includes(a.id));
  }, [annotations, ignoredRiskIds, showIgnored]);

  return (
    <group>
      {visibleAnnotations.map((a) => (
        <group key={a.id} position={a.position as [number, number, number]}>
          <mesh>
            <sphereGeometry args={[0.6, 12, 12]} />
            <meshStandardMaterial
              color={
                a.riskLevel === "danger"
                  ? "#E53E3E"
                  : a.riskLevel === "warning"
                    ? "#FF6B35"
                    : "#38A169"
              }
              emissive={
                a.riskLevel === "danger"
                  ? "#E53E3E"
                  : a.riskLevel === "warning"
                    ? "#FF6B35"
                    : "#38A169"
              }
              emissiveIntensity={0.5}
            />
          </mesh>
          <Html
            position={[0, 1.2, 0]}
            center
            style={{
              pointerEvents: "none",
              whiteSpace: "nowrap",
            }}
          >
            <div
              style={{
                background: "rgba(10,22,40,0.9)",
                border: `1px solid ${
                  a.riskLevel === "danger"
                    ? "#E53E3E"
                    : a.riskLevel === "warning"
                      ? "#FF6B35"
                      : "#38A169"
                }`,
                borderRadius: 4,
                padding: "2px 8px",
                color: "#fff",
                fontSize: 11,
                fontFamily: "JetBrains Mono, monospace",
              }}
            >
              {a.text.slice(0, 20)}
              {a.text.length > 20 ? "..." : ""}
            </div>
          </Html>
        </group>
      ))}
    </group>
  );
}

function ZoneLabels() {
  const job = useStore((s) => s.job);

  if (!job?.restrictedZones) return null;

  return (
    <group>
      {job.restrictedZones.map((zone) => {
        const h = zone.size.height ?? 4;
        const yPos = zone.position[1] + h / 2 + 1;
        return (
          <Html
            key={zone.id}
            position={[zone.position[0], yPos, zone.position[2]]}
            center
            style={{ pointerEvents: "none", whiteSpace: "nowrap" }}
          >
            <div
              style={{
                background: "rgba(229,62,62,0.85)",
                borderRadius: 4,
                padding: "3px 10px",
                color: "#fff",
                fontSize: 12,
                fontWeight: 600,
                fontFamily: "Noto Sans SC, sans-serif",
                border: "1px solid rgba(255,255,255,0.3)",
              }}
            >
              ⚠ {zone.name}
            </div>
          </Html>
        );
      })}
    </group>
  );
}

function SceneLighting() {
  return (
    <>
      <ambientLight intensity={0.4} />
      <directionalLight
        position={[30, 50, 20]}
        intensity={0.8}
        castShadow
        shadow-mapSize={[2048, 2048]}
      />
      <pointLight position={[-20, 30, -10]} intensity={0.4} color="#6BA3FF" />
      <pointLight position={[20, 25, 15]} intensity={0.3} color="#FFA500" />
      <fog attach="fog" args={["#0A1628", 60, 120]} />
    </>
  );
}

export default function Scene3D() {
  const job = useStore((s) => s.job);

  return (
    <Canvas
      camera={{
        position: [40, 30, 40],
        fov: 50,
        near: 0.1,
        far: 500,
      }}
      style={{ background: "#0A1628" }}
      gl={{ antialias: true, alpha: false }}
      onCreated={({ gl }) => {
        gl.setClearColor("#0A1628");
      }}
    >
      <SceneLighting />
      <CameraController />
      <GroundGrid />
      {job && (
        <>
          <CraneModel />
          <TrajectoryLine />
          <RestrictedZones />
          <WorkingRadius />
          <ZoneLabels />
        </>
      )}
      <AnnotationMarkers />
    </Canvas>
  );
}
