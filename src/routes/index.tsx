import { createFileRoute } from "@tanstack/react-router";
import MeshArtBackground from "../components/mesh-art-background";

export const Route = createFileRoute("/")({
  component: Home,
});

function Home() {
  return (
    <div className="flex min-h-screen [view-transition-name:main-content]">
      <MeshArtBackground />
      <div className="flex flex-col justify-center items-center flex-1 gap-3 relative">
        <div className="relative">
          <div className="absolute flex justify-center items-center -rotate-2 -z-10 w-full h-full">
            <div className="bg-teal-800 absolute w-12/10 h-11/10 md:w-9/10 md:h-8/10 -z-10" />
          </div>
          <h1 className="font-display text-6xl md:text-7xl font-thin w-min md:w-max h-min">
            Teal Computing Co.
          </h1>
        </div>
        <h3 className="text-md md:text-2xl font-normal w-max h-min">
          interesting solutions for interesting problems
        </h3>
      </div>
    </div>
  );
}
