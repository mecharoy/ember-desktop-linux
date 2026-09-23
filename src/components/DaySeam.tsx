/**
 * The divisions inside a day: a small-capitals label with the punctation rule
 * running off to the right, and sometimes a count or an action at the far end.
 *
 * The day is one column — notes, then the talk, then the entry, in the order
 * the day actually happened — and these are the only thing separating the
 * three. No boxes, no tabs, no cards: a rule and a name, the way a specimen
 * drawer is divided.
 *
 * This file is the same in elytra-desktop and elytra-mobile: change both.
 */
export default function DaySeam({
  label,
  trailing,
}: {
  label: string;
  /** A count, or a quiet button. Sits after the rule, at the right edge. */
  trailing?: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-3">
      <span className="spec shrink-0">{label}</span>
      <span className="punct-rule min-w-6 flex-1" aria-hidden="true" />
      {trailing}
    </div>
  );
}
