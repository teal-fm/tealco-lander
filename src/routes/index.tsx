import * as React from "react";
import { Link, createFileRoute } from "@tanstack/react-router";
import MeshArtBackground from "../components/mesh-art-background";

export const Route = createFileRoute("/")({
  component: Home,
});

function Home() {
  return (
    <div className="min-h-screen [view-transition-name:main-content]">
      <MeshArtBackground />
    </div>
  );
}
