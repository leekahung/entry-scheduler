import { useEffect, useState } from "react";
import { isEmailish, normalizeEmail } from "../server/staff";
import {
  addStaff,
  fetchStaff,
  removeStaff,
  type StaffList,
  type StaffRole,
} from "./api";
import ConfirmDialog from "./ConfirmDialog";
import { duplicateReason } from "./staffList";
import { useAsyncAction } from "./useAsyncAction";

/**
 * Lets an owner grant and revoke console access.
 * Rendered only for owners; the server enforces the same rule, so this is
 * about not offering buttons that cannot work.
 */
export default function StaffAccess({ passcode }: { passcode: string }) {
  const [list, setList] = useState<StaffList | null>(null);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<StaffRole>("staff");
  const {
    pending: busy,
    error,
    setError,
    run: attempt,
  } = useAsyncAction("That did not work.");
  // Taking someone's access away locks them out mid-shift and cannot be
  // undone from here — they have to be added again — so it is asked about
  // first, the same as removing someone from the queue.
  const [confirming, setConfirming] = useState<{
    email: string;
    role: StaffRole | "row";
  } | null>(null);

  const load = () =>
    fetchStaff(passcode)
      .then(setList)
      .catch(() => setError("Could not load the staff list."));

  // Loading once on mount is enough; the list changes only from this panel.
  // biome-ignore lint/correctness/useExhaustiveDependencies: load is rebuilt every render, so depending on it would refetch in a loop.
  useEffect(() => {
    void load();
  }, []);

  // The list is reloaded inside the attempt, so a write that lands but leaves
  // the panel unable to re-read it still reports the failure.
  const run = (action: () => Promise<unknown>) =>
    attempt(async () => {
      await action();
      await load();
    });

  if (!list) {
    return (
      <section className="mt-2 flex flex-col gap-2 rounded-xl border border-border bg-surface p-5">
        <h2 className="mx-0 mt-0 mb-1 text-lead">Staff access</h2>
        <p className="m-0 text-muted">{error || "Loading who has access…"}</p>
      </section>
    );
  }

  return (
    <section className="mt-2 flex flex-col gap-3 rounded-xl border border-border bg-surface p-5">
      <div>
        <h2 className="mx-0 mt-0 mb-1 text-lead">Staff access</h2>
        <p className="m-0 text-muted">
          Owners can change this list. Everyone here signs in with their own
          Google account.
        </p>
      </div>

      <form
        className="flex flex-wrap items-end gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          // The browser's own email check accepts "sam@clinic"; the server
          // does not, so use the server's rule and say so before sending.
          const address = normalizeEmail(email);
          if (!isEmailish(address)) {
            setError("That is not a valid email address.");
            return;
          }
          // Re-adding someone rewrites their row, silently changing who
          // granted the access and when. Say so instead when the add would
          // achieve nothing.
          const duplicate = duplicateReason(list, address, role);
          if (duplicate) {
            setError(duplicate);
            return;
          }
          void run(async () => {
            await addStaff(passcode, address, role);
            setEmail("");
            setRole("staff");
          });
        }}
      >
        <div className="flex field-wide flex-col gap-2">
          <label htmlFor="staff-email">Add a Google address</label>
          <input
            id="staff-email"
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="e.g. kim@clinic.org"
            required
          />
        </div>
        <div className="flex flex-col gap-2">
          <label htmlFor="staff-role">Access</label>
          <select
            id="staff-role"
            value={role}
            onChange={(event) => setRole(event.target.value as StaffRole)}
          >
            <option value="staff">Staff — can work the queue</option>
            <option value="owner">Owner — can also change this list</option>
          </select>
        </div>
        {/* A box the height of the controls beside it, so the shorter button
          is centred on the input and the select rather than sitting on their
          bottom edge. The two heights are the ones the base stylesheet gives
          every field, coarse pointers included. */}
        <div className="flex h-11 items-center pointer-coarse:h-12">
          <button
            type="submit"
            className="pointer-fine:min-h-[2.25rem] px-[0.7rem] py-[0.35rem]"
            disabled={busy || !email.trim()}
          >
            Add
          </button>
        </div>
      </form>

      {error && <p className="m-0 text-meta text-danger">{error}</p>}

      <ul className="m-0 flex list-none flex-col gap-2 p-0">
        {list.bootstrapOwners.map((owner) => (
          <li key={owner} className="flex flex-wrap items-center gap-3">
            <span className="flex-1">{owner}</span>
            <span className="text-meta text-muted">
              Owner · set on the server
              {list.redundantRows.includes(owner) &&
                " · leftover row in the sheet"}
            </span>
            {/* The row grants nothing while the environment lists them, but it
                would start granting again the day they are taken out of it. */}
            {list.redundantRows.includes(owner) && (
              <button
                type="button"
                className="btn-secondary pointer-fine:min-h-[2.25rem] px-[0.7rem] py-[0.35rem]"
                disabled={busy}
                onClick={() => setConfirming({ email: owner, role: "row" })}
              >
                Clear row
              </button>
            )}
          </li>
        ))}
        {list.members.map((member) => (
          <li key={member.email} className="flex flex-wrap items-center gap-3">
            <span className="flex-1">{member.email}</span>
            <span className="text-meta text-muted">
              {member.role === "owner" ? "Owner" : "Staff"}
              {member.addedBy && ` · added by ${member.addedBy}`}
            </span>
            <button
              type="button"
              className="btn-secondary pointer-fine:min-h-[2.25rem] px-[0.7rem] py-[0.35rem]"
              disabled={busy || member.email === list.you?.email}
              onClick={() =>
                setConfirming({ email: member.email, role: member.role })
              }
            >
              Remove
            </button>
          </li>
        ))}
        {list.members.length === 0 && (
          <li className="text-muted">Nobody else has been given access yet.</li>
        )}
      </ul>

      <ConfirmDialog
        open={confirming !== null}
        title={
          confirming?.role === "row"
            ? "Clear this leftover row?"
            : `Remove ${confirming?.email}?`
        }
        body={
          confirming?.role === "row"
            ? `${confirming.email} is an owner from the server settings and stays one. Only the leftover row in the sheet is cleared.`
            : `${confirming?.email} loses access to the console within about 30 seconds, including mid-shift. Adding them again is the only way back.`
        }
        confirmLabel={
          confirming?.role === "row" ? "Clear row" : "Remove access"
        }
        onCancel={() => setConfirming(null)}
        onConfirm={() => {
          const target = confirming?.email;
          setConfirming(null);
          if (target) void run(() => removeStaff(passcode, target));
        }}
      />
    </section>
  );
}
