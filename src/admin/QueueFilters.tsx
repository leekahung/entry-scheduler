import { PRIORITIES, PRIORITY_LABEL, type Priority } from "../shared/types";

type Props = {
  query: string;
  onQuery: (value: string) => void;
  triage: Priority | "";
  onTriage: (value: Priority | "") => void;
  filtering: boolean;
  shown: number;
  total: number;
  onClear: () => void;
};

/** Narrows every section at once, on the things the sections don't split by. */
export default function QueueFilters({
  query,
  onQuery,
  triage,
  onTriage,
  filtering,
  shown,
  total,
  onClear,
}: Props) {
  // Narrowing every list at once: the sections already split by status, so
  // this filters on the things they don't.
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-xl border border-border bg-surface px-4 py-3">
      <label className="sr-only" htmlFor="entry-search">
        Search by name or number
      </label>
      <input
        id="entry-search"
        type="search"
        className="w-auto field-wide"
        value={query}
        onChange={(event) => onQuery(event.target.value)}
        placeholder="Search name or #number"
      />
      <label className="sr-only" htmlFor="triage-filter">
        Triage level
      </label>
      {/* A fixed width, not one that follows the selected option: the row is a
        flex line, so a select that grew from "Urgent" to "Any triage level"
        moved the search field and the checkbox beside it every time. */}
      <select
        id="triage-filter"
        className="w-[12rem] max-w-full flex-none"
        value={triage}
        onChange={(event) => onTriage(event.target.value as Priority | "")}
      >
        <option value="">Any triage level</option>
        {PRIORITIES.map((level) => (
          <option key={level} value={level}>
            {PRIORITY_LABEL[level]}
          </option>
        ))}
      </select>
      {/* Its own line, and always there: a row that came and went with the
        filters shortened the search field beside it and moved everything below
        the card every time someone picked a triage level. The button keeps its
        space when there is nothing to clear — `invisible` leaves it out of the
        tab order and the accessibility tree, but not out of the layout. */}
      <p className="m-0 flex flex-[1_1_100%] flex-wrap items-center gap-3 text-meta text-muted">
        <span role="status">
          {shown} of {total} shown
        </span>
        <button
          type="button"
          className={`btn-secondary pointer-fine:min-h-[2.25rem] px-[0.7rem] py-[0.35rem] ${
            filtering ? "" : "invisible"
          }`}
          onClick={onClear}
        >
          Clear filters
        </button>
      </p>
    </div>
  );
}
