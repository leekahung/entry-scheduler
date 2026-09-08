import { useRef } from "react";

export type QueueTab = {
  id: string;
  label: string;
  count: number;
};

type Props = {
  tabs: readonly QueueTab[];
  active: string;
  onSelect: (id: string) => void;
};

/** The id a tab's button and its panel are wired together by. */
export const tabId = (id: string) => `queue-tab-${id}`;
export const panelId = (id: string) => `queue-panel-${id}`;

/**
 * The queue's sections as one row of tabs.
 * Arrow keys move between them and only the selected tab takes a tab stop,
 * which is what a row of plain buttons would not give.
 */
export default function QueueTabs({ tabs, active, onSelect }: Props) {
  const strip = useRef<HTMLDivElement>(null);

  const move = (to: number) => {
    const at = (to + tabs.length) % tabs.length;
    const next = tabs[at];
    if (!next) return;
    onSelect(next.id);
    // Focus follows selection, as a tablist is expected to.
    strip.current?.querySelectorAll("button")[at]?.focus();
  };

  return (
    <div
      ref={strip}
      role="tablist"
      aria-label="Queue sections"
      className="-mb-px flex flex-wrap gap-1"
    >
      {tabs.map((tab, index) => {
        const selected = tab.id === active;
        return (
          <button
            key={tab.id}
            type="button"
            role="tab"
            id={tabId(tab.id)}
            aria-selected={selected}
            aria-controls={panelId(tab.id)}
            tabIndex={selected ? 0 : -1}
            // Tabs, not buttons: no fill, no box, just a rule under the one
            // you are on. The base stylesheet makes every button a filled
            // accent pill, so each of those has to be undone here.
            className={`rounded-none border-0 border-b-[3px] bg-transparent px-3 py-2 ${
              selected
                ? "border-b-accent text-accent"
                : "border-b-transparent text-muted hover:border-b-border hover:text-text"
            }`}
            onClick={() => onSelect(tab.id)}
            onKeyDown={(event) => {
              if (event.key === "ArrowRight") move(index + 1);
              else if (event.key === "ArrowLeft") move(index - 1);
              else if (event.key === "Home") move(0);
              else if (event.key === "End") move(tabs.length - 1);
              else return;
              event.preventDefault();
            }}
          >
            {`${tab.label} (${tab.count})`}
          </button>
        );
      })}
    </div>
  );
}
