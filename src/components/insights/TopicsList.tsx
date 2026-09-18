import type { Topic } from "../../db/types";

const STATUS: Record<Topic["status"], string> = {
  open: "working on it",
  avoid: "you'd rather not talk about it",
  resolved: "settled",
};

/** The topics Ember keeps across conversations (coach and therapist styles),
 *  with what it knows and what it means to pick up next. */
export default function TopicsList({
  topics,
  onStatus,
  onRemove,
}: {
  topics: Topic[];
  onStatus: (key: string, status: Topic["status"]) => void;
  onRemove: (key: string) => void;
}) {
  return (
    <div className="flex flex-col gap-2">
      <h3 className="font-serif text-[16px] text-ink">Topics</h3>
      {topics.length === 0 ? (
        <p className="hint max-w-xl">
          In the coach and therapist styles, Ember keeps notes here on what you&rsquo;re working through, and picks them up in
          later conversations.
        </p>
      ) : (
        <ul className="flex flex-col divide-y divide-rule border-y border-rule">
          {topics.map((t) => (
            <li key={t.key} className="flex flex-col gap-1.5 py-3">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <span className={`font-serif text-[15.5px] ${t.status === "resolved" ? "text-ink-faint" : "text-ink"}`}>{t.title}</span>
                <span className="text-[12px] text-ink-faint">
                  {STATUS[t.status]}
                  {t.last_discussed && ` · last talked about ${t.last_discussed.slice(0, 10)}`}
                </span>
              </div>
              {t.notes && <p className="max-w-[70ch] text-[13.5px] leading-snug text-ink-soft">{t.notes}</p>}
              {t.next_step && t.status !== "resolved" && (
                <p className="text-[12.5px] text-ink-faint">
                  <span className="italic">Next:</span> {t.next_step}
                </p>
              )}
              <div className="flex flex-wrap gap-2 pt-0.5">
                {t.status !== "resolved" && (
                  <button onClick={() => onStatus(t.key, "resolved")} className="btn-chip">
                    Settled
                  </button>
                )}
                {t.status !== "open" && (
                  <button onClick={() => onStatus(t.key, "open")} className="btn-chip">
                    Keep talking about it
                  </button>
                )}
                {t.status === "open" && (
                  <button onClick={() => onStatus(t.key, "avoid")} className="btn-chip">
                    Don&rsquo;t bring it up
                  </button>
                )}
                <button onClick={() => onRemove(t.key)} className="btn-chip danger">
                  Forget
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
