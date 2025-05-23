import { Link, createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/how-it-works")({
  component: RouteComponent,
});

function RouteComponent() {
  return (
    <div className="p-2 [view-transition-name:main-content]">
      <h3>This example demonstrates a variety of custom page transitions.</h3>
      <div className="flex justify-center gap-10 mt-4">
        <Link
          to={"/"}
          // see styles.css for 'slide-right' transition
          viewTransition={{ types: ["slide-right"] }}
          className="font-bold"
        >
          &lt;- Previous Page
        </Link>
      </div>
    </div>
  );
}
