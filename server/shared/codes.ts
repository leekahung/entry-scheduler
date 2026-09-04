/**
 * Controlled vocabularies from the CARE4 CODES sheet of the legal triage log.
 * Imported by the frontend too, so the dropdowns and the export can't drift.
 */

export const CASE_TYPES = [
  "Child Support (CSSD)",
  "Consumer debt",
  "Criminal",
  "DCFS",
  "Divorce/Separation",
  "DVRO/CHRO",
  "Expungement",
  "Guardianship",
  "Housing/Eviction",
  "Immigration",
  "Name Change",
  "Other- Civil",
  "Parentage",
  "Policing/Civil Rights",
  "SSA Benefits",
  "Traffic",
  "Wills/Estates",
] as const;

/** Gender options offered at sign-in; "Other" covers anything else. */
export const GENDERS = ["Male", "Female", "Non-binary", "Other"] as const;

export const APPOINTMENT_TYPES = [
  "Consult",
  "Clinic",
  "Court Appearance",
  "Case work & Management",
  "Accompaniment",
] as const;

export const APPOINTMENT_OUTCOMES = [
  "Completed",
  "Cancelled",
  "Rescheduled",
  "No Show/No Call",
] as const;

export const LEGAL_OUTCOMES = [
  "APPOINTMENT MADE",
  "CONSULT ONLY",
  "REFERRAL MADE",
  "FAMILY REUNIFICATION*",
  "FILED- EXPUNGEMENT",
  "FILED- CSSD",
  "FILED- DVRO/CHRO (NO KIDS)",
  "FILED- DVRO/CHRO (WITH KIDS)",
  "FILED- FL (NO KIDS)",
  "FILED- FL (WITH KIDS)",
  "FILED- NAME CHANGE (MINOR)",
  "FILED- NAME CHANGE (ADULT)",
  "FILED- GUARDIANSHIP (PET/MOD/TERM)",
  "FILED- OTHER- CIVIL",
  "ORDER MADE: EXPUNGEMENT",
  "ORDER MADE: CSSD",
  "ORDER MADE: DVRO/CHRO (NO KIDS)",
  "ORDER MADE - DVRO/CHRO (WITH KIDS)*",
  "ORDER MADE- FL (NO KIDS)",
  "ORDER MADE- FL (WITH KIDS)",
  "ORDER MADE- NAME CHANGE (MINOR)",
  "ORDER MADE- NAME CHANGE (ADULT)",
  "ORDER MADE- GUARDIANSHIP (PET/MOD/TERM)*",
  "ORDER MADE- OTHER- CIVIL",
] as const;

export type CaseType = (typeof CASE_TYPES)[number];
export type Gender = (typeof GENDERS)[number];

/**
 * Plain-English wording for each case type, with every acronym spelled out.
 *
 * Currently unused: the sign-in screen this was written for no longer asks
 * visitors to pick a case type — staff set it from the raw codes. Kept for
 * whenever a visitor-facing picker comes back.
 */
export const CASE_TYPE_LABEL: Record<CaseType, string> = {
  // Opaque on their own — plain term first, then the acronym spelled out.
  "Child Support (CSSD)": "Child support (Child Support Services Department)",
  DCFS: "Child welfare (Department of Children and Family Services)",
  "DVRO/CHRO":
    "Restraining order (Domestic Violence or Civil Harassment Restraining Order)",
  "SSA Benefits": "Social Security benefits (Social Security Administration)",
  Expungement: "Clearing a criminal record (expungement)",
  Parentage: "Parentage or paternity",
  "Other- Civil": "Something else (civil)",

  // Already plain — tidied punctuation only.
  "Consumer debt": "Consumer debt",
  Criminal: "Criminal",
  "Divorce/Separation": "Divorce or separation",
  Guardianship: "Guardianship",
  "Housing/Eviction": "Housing or eviction",
  Immigration: "Immigration",
  "Name Change": "Name change",
  "Policing/Civil Rights": "Policing or civil rights",
  Traffic: "Traffic",
  "Wills/Estates": "Wills and estates",
};

/** The case types A–Z by label, for a visitor-facing picker. Unused today. */
export const CASE_TYPES_BY_LABEL = [...CASE_TYPES].sort((a, b) =>
  CASE_TYPE_LABEL[a].localeCompare(CASE_TYPE_LABEL[b]),
);

export type AppointmentType = (typeof APPOINTMENT_TYPES)[number];
export type AppointmentOutcome = (typeof APPOINTMENT_OUTCOMES)[number];
export type LegalOutcome = (typeof LEGAL_OUTCOMES)[number];

/** Blank counts as valid everywhere: these fields are filled in over time. */
export function isCode<T extends string>(
  codes: readonly T[],
  value: unknown,
): value is T | "" {
  return (
    typeof value === "string" &&
    (value === "" || (codes as readonly string[]).includes(value))
  );
}

/** The log bills in quarter hours, so anything else would not sum correctly. */
export const TIME_STEP = 0.25;
export const TIME_MAX = 24;

export function isTimeSpent(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isFinite(value) &&
    value >= 0 &&
    value <= TIME_MAX &&
    Math.abs(value / TIME_STEP - Math.round(value / TIME_STEP)) < 1e-9
  );
}

/**
 * Display labels for the legal outcome codes.
 * The stored value stays the raw code so the export keeps matching the sheet;
 * only the wording on screen changes. Acronyms are left exactly as written.
 */
export const LEGAL_OUTCOME_LABEL: Record<LegalOutcome, string> = {
  "APPOINTMENT MADE": "Appointment made",
  "CONSULT ONLY": "Consult only",
  "REFERRAL MADE": "Referral made",
  "FAMILY REUNIFICATION*": "Family reunification*",

  // Inside the "Filed" and "Order made" groups the prefix is already the
  // group heading, so it would only be repeated on every line.
  "FILED- EXPUNGEMENT": "Expungement",
  "FILED- CSSD": "CSSD",
  "FILED- DVRO/CHRO (NO KIDS)": "DVRO/CHRO (no kids)",
  "FILED- DVRO/CHRO (WITH KIDS)": "DVRO/CHRO (with kids)",
  "FILED- FL (NO KIDS)": "FL (no kids)",
  "FILED- FL (WITH KIDS)": "FL (with kids)",
  "FILED- NAME CHANGE (MINOR)": "Name change (minor)",
  "FILED- NAME CHANGE (ADULT)": "Name change (adult)",
  "FILED- GUARDIANSHIP (PET/MOD/TERM)": "Guardianship (PET/MOD/TERM)",
  "FILED- OTHER- CIVIL": "Other — civil",

  "ORDER MADE: EXPUNGEMENT": "Expungement",
  "ORDER MADE: CSSD": "CSSD",
  "ORDER MADE: DVRO/CHRO (NO KIDS)": "DVRO/CHRO (no kids)",
  "ORDER MADE - DVRO/CHRO (WITH KIDS)*": "DVRO/CHRO (with kids)*",
  "ORDER MADE- FL (NO KIDS)": "FL (no kids)",
  "ORDER MADE- FL (WITH KIDS)": "FL (with kids)",
  "ORDER MADE- NAME CHANGE (MINOR)": "Name change (minor)",
  "ORDER MADE- NAME CHANGE (ADULT)": "Name change (adult)",
  "ORDER MADE- GUARDIANSHIP (PET/MOD/TERM)*": "Guardianship (PET/MOD/TERM)*",
  "ORDER MADE- OTHER- CIVIL": "Other — civil",
};

/**
 * The outcome list is 24 flat options; grouping it by what happened splits it
 * into three short menus. Membership follows the code's own prefix, so a new
 * code lands in the right group without editing this.
 */
export const LEGAL_OUTCOME_GROUPS: { label: string; codes: LegalOutcome[] }[] =
  [
    {
      label: "Other",
      codes: LEGAL_OUTCOMES.filter((code) => !/^(FILED|ORDER MADE)/.test(code)),
    },
    {
      label: "Filed",
      codes: LEGAL_OUTCOMES.filter((code) => code.startsWith("FILED")),
    },
    {
      label: "Order made",
      codes: LEGAL_OUTCOMES.filter((code) => code.startsWith("ORDER MADE")),
    },
  ];
