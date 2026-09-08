import { useEffect, useState } from "react";

// A fixed distance, not a screenful: measured against the viewport, a tall
// desktop window set a threshold its own page could never scroll past, so the
// button only ever appeared on short screens.
const SHOW_AFTER_PX = 300;

/**
 * A shortcut back to the top, shown once the page has scrolled a little way.
 * Bottom right, since the toasts hold the other corner.
 */
export default function ScrollToTop() {
  const [shown, setShown] = useState(false);

  useEffect(() => {
    const check = () => setShown(window.scrollY > SHOW_AFTER_PX);
    check();
    window.addEventListener("scroll", check, { passive: true });
    return () => window.removeEventListener("scroll", check);
  }, []);

  if (!shown) return null;

  return (
    <button
      type="button"
      className="btn-secondary scroll-top"
      // Always animated, including where the system asks for reduced motion:
      // seeing the page travel is what tells you where you have been put.
      onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
    >
      <svg
        aria-hidden="true"
        viewBox="0 0 24 24"
        width="16"
        height="16"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M12 19V5" />
        <path d="M5 12l7-7 7 7" />
      </svg>
      Top
    </button>
  );
}
