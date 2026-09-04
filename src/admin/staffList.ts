import type { StaffList, StaffRole } from "../shared/types";

const ROLE_WORD: Record<StaffRole, string> = {
  owner: "an owner",
  staff: "staff",
};

/**
 * Why this address cannot be added to the staff list, or null if it can.
 * Changing someone's role by re-adding them is allowed and answers null; only
 * an add that would change nothing, or one the server will refuse, is stopped.
 */
export function duplicateReason(
  list: StaffList,
  address: string,
  role: StaffRole,
): string | null {
  if (list.bootstrapOwners.includes(address)) {
    return `${address} is already an owner set on the server.`;
  }
  const existing = list.members.find((member) => member.email === address);
  if (existing?.role === role) {
    return `${address} is already on the list as ${ROLE_WORD[role]}.`;
  }
  return null;
}
