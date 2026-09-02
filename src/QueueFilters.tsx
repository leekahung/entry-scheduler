import { PRIORITIES, PRIORITY_LABEL, type Priority } from "./api";

type Props = {
  query: string;
  onQuery: (value: string) => void;
  triage: Priority | "";
  onTriage: (value: Priority | "") => void;
  incompleteOnly: boolean;
  onIncompleteOnly: (value: boolean) => void;
  /** How many entries are still missing something the log needs. */
  incompleteCount: number;
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
  incompleteOnly,
  onIncompleteOnly,
  incompleteCount,
  filtering,
  shown,
  total,
  onClear,
}: Props) {
  // Narrowing the three lists at once: the sections already split by status,
  // so this filters on the things they don't.
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
      <select
        id="triage-filter"
        className="w-auto flex-[0_1_12rem]"
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
      <label className="flex items-center gap-[0.4rem] font-normal whitespace-nowrap">
        <input
          className="min-h-0 w-auto"
          type="checkbox"
          checked={incompleteOnly}
          onChange={(event) => onIncompleteOnly(event.target.checked)}
        />
        Needs details ({incompleteCount})
      </label>
      {filtering && (
        <button
          type="button"
          className="btn-secondary pointer-fine:min-h-[2.25rem] px-[0.7rem] py-[0.35rem]"
          onClick={onClear}
        >
          Clear filters
        </button>
      )}
      {filtering && (
        <p className="m-0 flex-[1_1_100%] text-meta text-muted" role="status">
          {shown} of {total} shown
        </p>
      )}
    </div>
  );
}
