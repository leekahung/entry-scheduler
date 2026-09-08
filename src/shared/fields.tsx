import { MAX_PHONE } from "../../server/shared/limits";
import { formatUsPhone } from "./phone";
import { todayLocal } from "./time";

/**
 * The three forms that collect intake details lay them out differently, so
 * these are single fields rather than a block: each owns the rules its field
 * is held to, and the caller decides where it sits.
 */
type FieldProps = {
  id: string;
  value: string;
  onChange: (value: string) => void;
  /** The editor stacks its labels; the other forms let them sit inline. */
  labelClassName?: string;
  /** The editor tints its inputs by whether they have to be filled in. */
  inputClassName?: string;
  required?: boolean;
  /** Set where the browser should hold the field to a whole US number. */
  pattern?: string;
};

export function DobField({
  id,
  value,
  onChange,
  labelClassName,
  inputClassName,
  required,
}: FieldProps) {
  return (
    <>
      <label className={labelClassName} htmlFor={id}>
        Date of birth
      </label>
      <input
        id={id}
        type="date"
        className={inputClassName}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        // Nobody is born tomorrow, and the server refuses it either way.
        max={todayLocal()}
        required={required}
      />
    </>
  );
}

export function PhoneField({
  id,
  value,
  onChange,
  labelClassName,
  inputClassName,
  required,
  pattern,
}: FieldProps) {
  return (
    <>
      <label className={labelClassName} htmlFor={id}>
        Phone number
      </label>
      <input
        id={id}
        type="tel"
        className={inputClassName}
        value={value}
        onChange={(event) =>
          onChange(formatUsPhone(event.target.value).slice(0, MAX_PHONE))
        }
        placeholder="e.g. 503-555-0142"
        maxLength={MAX_PHONE}
        autoComplete="tel"
        required={required}
        pattern={pattern}
        title={pattern ? "A 10-digit US number, like 503-555-0142" : undefined}
      />
    </>
  );
}

type CodeSelectProps<T extends string> = {
  id: string;
  label: string;
  value: T | "";
  codes: readonly T[];
  onChange: (value: T | "") => void;
  /** Plain wording for a code that is opaque on its own. */
  labelFor?: (code: T) => string;
  labelClassName?: string;
  inputClassName?: string;
};

/**
 * One of a controlled vocabulary, or blank.
 * Blank is always offered: these fields are filled in over the course of a
 * visit, so "not said yet" has to be expressible.
 */
export function CodeSelect<T extends string>({
  id,
  label,
  value,
  codes,
  onChange,
  labelFor,
  labelClassName,
  inputClassName,
}: CodeSelectProps<T>) {
  return (
    <>
      <label className={labelClassName} htmlFor={id}>
        {label}
      </label>
      <select
        id={id}
        className={inputClassName}
        value={value}
        onChange={(event) => onChange(event.target.value as T | "")}
      >
        <option value="">—</option>
        {codes.map((code) => (
          <option key={code} value={code}>
            {labelFor ? labelFor(code) : code}
          </option>
        ))}
      </select>
    </>
  );
}
