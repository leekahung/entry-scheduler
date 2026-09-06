/**
 * The zone the clinic keeps its books in.
 * Months and stamps are cut in local time, so a container left on UTC files an
 * evening check-in under tomorrow — and one on the last of the month a month on.
 */
const CLINIC_ZONE = "America/Los_Angeles";

/**
 * Pins the process to that zone unless the deployment names one.
 * Here rather than in the environment, so a service nobody set `TZ` on is
 * still right; `TZ` still wins where a clinic in another zone sets it.
 */
export function applyClinicZone(): string {
  if (!process.env.TZ) process.env.TZ = CLINIC_ZONE;
  return process.env.TZ;
}
