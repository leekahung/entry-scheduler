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
      {/* Fixed width, so changing the option does not shift the row. */}
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
      {/* Always on its own line so the layout never shifts; `invisible` keeps
        the space while hiding the button from tab order and screen readers. */}
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
