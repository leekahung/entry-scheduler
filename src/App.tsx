import {
  Component,
  lazy,
  type ReactNode,
  Suspense,
  useEffect,
  useState,
} from "react";
import UserPage from "./pages/UserPage";

// Lazy: visitors never need the console, so a phone checking in skips it.
const AdminPage = lazy(() => import("./pages/AdminPage"));

/**
 * Catches a console chunk that a deploy has removed from under an open tab.
 * Offers a reload instead of a blank page. A class: React has no hook for it.
 */
class ConsoleBoundary extends Component<
  { children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <main
        data-scale="kiosk"
        className="mx-auto flex max-w-[24rem] flex-col gap-5 pt-8 page-inset kiosk:max-w-kiosk"
      >
        <div className="flex flex-col gap-2 rounded-xl border border-border bg-surface p-5">
          <h1 className="mx-0 mt-0 mb-1 text-lead kiosk:text-title-kiosk">
            The console could not be loaded
          </h1>
          <p className="mt-1 mb-0 text-muted">
            This page has been open since before the last update. Reloading
            fetches the current one.
          </p>
          <button type="button" onClick={() => window.location.reload()}>
            Reload
          </button>
        </div>
      </main>
    );
  }
}

/** Hash routing keeps the admin screen on its own URL without a router dependency. */
export default function App() {
  const [hash, setHash] = useState(window.location.hash);

  useEffect(() => {
    const onHashChange = () => setHash(window.location.hash);
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

  const isAdmin = hash.startsWith("#/admin");

  // Both views share one document, so the title has to follow the route.
  useEffect(() => {
    document.title = isAdmin
      ? "Queue admin · Entry Scheduler"
      : "Check in · Entry Scheduler";
  }, [isAdmin]);

  if (!isAdmin) return <UserPage />;
  // No fallback: the console's own sign-in screen appears the moment it
  // arrives, and a flash of "Loading" before it says nothing worth reading.
  return (
    <ConsoleBoundary>
      <Suspense fallback={null}>
        <AdminPage />
      </Suspense>
    </ConsoleBoundary>
  );
}
