import type { ReactNode } from "react";

/**
 * The console's line icons, drawn here rather than pulled from an icon set:
 * it needs four of them, and they inherit the colour of the button they sit in.
 */
function Glyph({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
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
      className={className}
    >
      {children}
    </svg>
  );
}

/** Circular arrow. Turns while the work it started is running. */
export function RefreshIcon({ className }: { className?: string }) {
  return (
    <Glyph className={className}>
      <path d="M20.5 12a8.5 8.5 0 1 1-2.49-6.01" />
      <path d="M20.5 4v5h-5" />
    </Glyph>
  );
}

/** An arrow leaving through a doorway. */
export function SignOutIcon() {
  return (
    <Glyph>
      <path d="M14 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4" />
      <path d="M9 17l5-5-5-5" />
      <path d="M14 12H3" />
    </Glyph>
  );
}

/** An arrow into a tray. */
export function DownloadIcon() {
  return (
    <Glyph>
      <path d="M12 3v12" />
      <path d="M7 11l5 5 5-5" />
      <path d="M5 20h14" />
    </Glyph>
  );
}

/** An arrow leaving a frame, for a link that opens elsewhere. */
export function ExternalIcon() {
  return (
    <Glyph>
      <path d="M14 4h6v6" />
      <path d="M11 13 20 4" />
      <path d="M19 14v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h5" />
    </Glyph>
  );
}
