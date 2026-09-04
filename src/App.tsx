import { useEffect, useState } from "react";
import AdminPage from "./pages/AdminPage";
import UserPage from "./pages/UserPage";

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

  return isAdmin ? <AdminPage /> : <UserPage />;
}
