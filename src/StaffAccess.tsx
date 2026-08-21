import { useEffect, useState } from "react";
import {
  addStaff,
  fetchStaff,
  removeStaff,
  type StaffList,
  type StaffRole,
} from "./api";

const SECONDARY = "border-border bg-surface text-text";

/**
 * Lets an owner grant and revoke console access.
 * Rendered only for owners; the server enforces the same rule, so this is
 * about not offering buttons that cannot work.
 */
export default function StaffAccess({ passcode }: { passcode: string }) {
  const [list, setList] = useState<StaffList | null>(null);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<StaffRole>("staff");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const load = () =>
    fetchStaff(passcode)
      .then(setList)
      .catch(() => setError("Could not load the staff list."));

  // Loading once on mount is enough; the list changes only from this panel.
  // biome-ignore lint/correctness/useExhaustiveDependencies: load is rebuilt every render, so depending on it would refetch in a loop.
  useEffect(() => {
    void load();
  }, []);

  const run = async (action: () => Promise<unknown>) => {
    setBusy(true);
    setError("");
    try {
      await action();
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "That did not work.");
    }
    setBusy(false);
  };

  if (!list) {
    return (
      <section className="mt-2 flex flex-col gap-2 rounded-xl border border-border bg-surface p-5">
        <h2 className="mx-0 mt-0 mb-1 text-[1.15rem]">Staff access</h2>
        <p className="m-0 text-muted">{error || "Loading who has access…"}</p>
      </section>
    );
  }

  return (
    <section className="mt-2 flex flex-col gap-3 rounded-xl border border-border bg-surface p-5">
      <div>
        <h2 className="mx-0 mt-0 mb-1 text-[1.15rem]">Staff access</h2>
        <p className="m-0 text-muted">
          Owners can change this list. Everyone here signs in with their own
          Google account.
        </p>
      </div>

      <form
        className="flex flex-wrap items-end gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          void run(async () => {
            await addStaff(passcode, email, role);
            setEmail("");
            setRole("staff");
          });
        }}
      >
        <div className="flex flex-[1_1_16rem] flex-col gap-2">
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
        <button type="submit" disabled={busy || !email.trim()}>
          Add
        </button>
      </form>

      {error && <p className="m-0 text-[0.9rem] text-danger">{error}</p>}

      <ul className="m-0 flex list-none flex-col gap-2 p-0">
        {list.bootstrapOwners.map((owner) => (
          <li key={owner} className="flex flex-wrap items-center gap-3">
            <span className="flex-1">{owner}</span>
            <span className="text-[0.85rem] text-muted">
              Owner · set on the server
            </span>
          </li>
        ))}
        {list.members.map((member) => (
          <li key={member.email} className="flex flex-wrap items-center gap-3">
            <span className="flex-1">{member.email}</span>
            <span className="text-[0.85rem] text-muted">
              {member.role === "owner" ? "Owner" : "Staff"}
              {member.addedBy && ` · added by ${member.addedBy}`}
            </span>
            <button
              type="button"
              className={SECONDARY}
              disabled={busy || member.email === list.you?.email}
              onClick={() =>
                void run(() => removeStaff(passcode, member.email))
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
    </section>
  );
}
