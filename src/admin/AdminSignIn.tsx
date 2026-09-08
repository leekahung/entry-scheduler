import type { useAdminSession } from "../hooks/useAdminSession";

const REMAINING_WARN_FROM = 5;

/**
 * The gate in front of the console: whichever sign-in this deployment is
 * configured for, and nothing else. Rendered until the session unlocks.
 */
export default function AdminSignIn({
  session,
}: {
  session: ReturnType<typeof useAdminSession>;
}) {
  const { passcode } = session;

  return (
    <main
      data-scale="kiosk"
      className="mx-auto flex max-w-[24rem] flex-col gap-5 pt-8 page-inset kiosk:max-w-kiosk"
    >
      {session.mode === null ? (
        // Which sign-in to offer is the server's answer, so wait for it
        // rather than flashing a passcode box that may be wrong.
        <div className="flex flex-col gap-2 rounded-xl border border-border bg-surface p-5">
          <h1 className="mx-0 mt-0 mb-1 text-lead kiosk:text-title-kiosk">
            Staff sign-in
          </h1>
          <p className="m-0 text-muted">{session.error || "Connecting…"}</p>
        </div>
      ) : session.mode === "google" ? (
        <div className="flex flex-col gap-2 rounded-xl border border-border bg-surface p-5">
          <h1 className="mx-0 mt-0 mb-1 text-lead kiosk:text-title-kiosk">
            Staff sign-in
          </h1>
          <p className="mt-1 mb-0 text-muted">
            Sign in with your work Google account to manage the help queue.
          </p>
          <button type="button" onClick={session.signInWithGoogle}>
            Sign in with Google
          </button>
          {session.error && (
            <p className="m-0 text-meta text-danger">{session.error}</p>
          )}
        </div>
      ) : (
        <form
          className="flex flex-col gap-2 rounded-xl border border-border bg-surface p-5"
          onSubmit={(event) => {
            event.preventDefault();
            session.unlock();
          }}
        >
          <h1 className="mx-0 mt-0 mb-1 text-lead kiosk:text-title-kiosk">
            Staff sign-in
          </h1>
          <p className="mt-1 mb-0 text-muted">
            Enter the staff passcode to manage the help queue.
          </p>
          <label htmlFor="passcode">Passcode</label>
          <input
            id="passcode"
            type="password"
            value={passcode}
            onChange={(event) => session.setPasscode(event.target.value)}
            autoComplete="current-password"
            required
          />
          <button type="submit">Unlock</button>
          {session.error && (
            <p className="m-0 text-meta text-danger">{session.error}</p>
          )}
          {session.attemptsLeft !== null &&
            session.attemptsLeft <= REMAINING_WARN_FROM && (
              <p className="mx-0 -mt-1.5 mb-0 text-meta text-caution">
                {session.attemptsLeft === 0
                  ? "No attempts left — this device is now locked for 15 minutes."
                  : `${session.attemptsLeft} ${session.attemptsLeft === 1 ? "attempt" : "attempts"} left before this device is locked out for 15 minutes.`}
              </p>
            )}
        </form>
      )}
      <p className="m-0 text-center text-meta text-muted">
        Here to get help instead? <a href="#/">Check in</a>
      </p>
    </main>
  );
}
