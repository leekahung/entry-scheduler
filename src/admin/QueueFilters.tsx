import { VISIT_TYPES, VISIT_TYPE_LABEL, type VisitType } from "../shared/types";

type Props = {
  query: string;
  onQuery: (value: string) => void;
  visitType: VisitType | "";
  onVisitType: (value: VisitType | "") => void;
  filtering: boolean;
  shown: number;
  total: number;
  onClear: () => void;
};

/** Narrows every section at once, on the things the sections don't split by. */
export default function QueueFilters({
  query,
  onQuery,
  visitType,
  onVisitType,
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
      <label className="sr-only" htmlFor="visit-type-filter">
        Visit type
      </label>
      {/* A fixed width, not one that follows the selected option: the row is a
        flex line, so a select that grew from "Remote" to "Any visit type"
        moved the search field and the checkbox beside it every time. */}
      <select
        id="visit-type-filter"
        className="w-[12rem] max-w-full flex-none"
        value={visitType}
        onChange={(event) => onVisitType(event.target.value as VisitType | "")}
      >
        <option value="">Any visit type</option>
        {VISIT_TYPES.map((type) => (
          <option key={type} value={type}>
            {VISIT_TYPE_LABEL[type]}
          </option>
        ))}
      </select>
      {/* Its own line, and always there: a row that came and went with the
        filters shortened the search field beside it and moved everything below
        the card every time someone picked a visit type. The button keeps its
        space when there is nothing to clear — `invisible` leaves it out of the
        tab order and the accessibility tree, but not out of the layout. */}
      <p className="m-0 flex flex-[1_1_100%] flex-wrap items-center gap-3 text-meta text-muted">
        <span role="status">
          {shown} of {total} shown
        </span>
        <button
          type="button"
          className={`btn-secondary pointer-fine:min-h-9 px-3 py-1.5 ${
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
