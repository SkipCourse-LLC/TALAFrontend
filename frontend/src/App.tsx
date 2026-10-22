import { lazy, Suspense } from "react";

const ServerApplication = lazy(() =>
  import("./product/ServerApplication").then((module) => ({
    default: module.ServerApplication,
  })),
);
// Only demo builds include the demo screens and their sample data.
const DemoApplication =
  import.meta.env.VITE_BACKEND_MODE === "demo"
    ? lazy(() =>
        import("./DemoApplication").then((module) => ({
          default: module.DemoApplication,
        })),
      )
    : null;

export default function App() {
  const mode = import.meta.env.VITE_BACKEND_MODE || "api";
  if (mode === "demo" && DemoApplication)
    return (
      <Suspense fallback={null}>
        <DemoApplication />
      </Suspense>
    );
  if (mode !== "api")
    return (
      <section className="container state-panel" role="alert">
        <h1>Backend configuration unavailable</h1>
        <p>Set VITE_BACKEND_MODE to api or demo.</p>
      </section>
    );
  return (
    <Suspense
      fallback={
        <div className="container state-panel" role="status">
          Connecting to your TALA server…
        </div>
      }
    >
      <ServerApplication />
    </Suspense>
  );
}
