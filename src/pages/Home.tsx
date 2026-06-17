import Scene3D from "@/components/Scene3D";
import ImportPanel from "@/components/ImportPanel";
import TimelineControl from "@/components/TimelineControl";
import CameraPanel from "@/components/CameraPanel";
import AnnotationPanel from "@/components/AnnotationPanel";
import ExportPanel from "@/components/ExportPanel";
import SessionPackageWorkbench from "@/components/SessionPackageWorkbench";

export default function Home() {
  return (
    <div className="w-screen h-screen overflow-hidden bg-[#0A1628] relative">
      <div className="absolute inset-0 bottom-16">
        <Scene3D />
      </div>

      <div className="fixed top-4 left-1/2 -translate-x-1/2 z-50 flex items-center gap-3">
        <ExportPanel />
        <SessionPackageWorkbench />
      </div>

      <ImportPanel />
      <CameraPanel />
      <AnnotationPanel />
      <TimelineControl />
    </div>
  );
}
