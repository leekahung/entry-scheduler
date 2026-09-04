import { MAX_NAME } from "../server/validate";

type Props = {
  /** The name Google gave, or "" when it gave none. */
  signedInAs: string;
  typedAs: string;
  onTypedAs: (value: string) => void;
};

/** Who the console is helping as. Reads as "who am I", not as an entry field. */
export default function HelpingAs({ signedInAs, typedAs, onTypedAs }: Props) {
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-xl border border-border bg-surface px-4 py-3">
      <span id="helpedBy-label" className="font-semibold text-[0.9rem]">
        Helping as
      </span>
      {signedInAs ? (
        <p className="m-0 flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <strong>{signedInAs}</strong>
          <span className="text-meta text-muted">
            From your Google sign-in. Everyone you help is credited to you.
          </span>
        </p>
      ) : (
        <>
          <input
            id="helpedBy"
            value={typedAs}
            maxLength={MAX_NAME}
            onChange={(event) => onTypedAs(event.target.value)}
            className="w-auto flex-[0_1_14rem]"
            placeholder="Your name, e.g. Kim"
            aria-labelledby="helpedBy-label"
            aria-describedby="helpedBy-hint"
          />
          <p id="helpedBy-hint" className="m-0 field text-meta text-muted">
            {typedAs.trim()
              ? `Entries you work on will be credited to ${typedAs.trim()}.`
              : "Add your name so the queue shows who helped each person."}
          </p>
        </>
      )}
    </div>
  );
}
