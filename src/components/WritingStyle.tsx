import { useRef, useState } from "react";

/** Longest sample kept: enough to show a voice, small enough for any model. */
export const WRITING_SAMPLE_MAX = 6000;

/**
 * A sample of their own writing, so journal entries sound like them. Either a
 * .txt or .md file, or a day or event they describe here in detail. The
 * sample stays in the box to read and change.
 */
export default function WritingStyle({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [note, setNote] = useState<string | null>(null);

  async function loadFile(file: File | undefined) {
    if (!file) return;
    if (!/\.(txt|md|markdown)$/i.test(file.name)) {
      setNote("Pick a .txt or .md file.");
      return;
    }
    const text = (await file.text()).trim();
    setNote(text.length > WRITING_SAMPLE_MAX ? `Loaded ${file.name}. Only the first ${WRITING_SAMPLE_MAX} characters are kept.` : `Loaded ${file.name}.`);
    onChange(text.slice(0, WRITING_SAMPLE_MAX));
  }

  return (
    <div className="flex flex-col gap-2">
      <p className="hint">
        Elytra writes your journal in this style. Load something you wrote, or describe a day or an event here in detail,
        the way you would tell it.
      </p>
      <textarea
        className="input min-h-[160px] resize-y font-serif text-[16px] leading-relaxed"
        value={value}
        maxLength={WRITING_SAMPLE_MAX}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Last Saturday started badly. The bus never came, so I walked…"
      />
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" onClick={() => fileRef.current?.click()} className="btn-subtle">
          Load a file
        </button>
        {value && (
          <button type="button" onClick={() => onChange("")} className="btn-ghost">
            Clear
          </button>
        )}
        <span className="text-[12.5px] tabular-nums text-fg-faint">
          {value.length} / {WRITING_SAMPLE_MAX}
        </span>
        {note && <span className="text-[12.5px] text-fg-faint">{note}</span>}
      </div>
      <input
        ref={fileRef}
        type="file"
        accept=".txt,.md,.markdown,text/plain,text/markdown"
        className="hidden"
        onChange={(e) => {
          void loadFile(e.target.files?.[0]);
          e.target.value = "";
        }}
      />
    </div>
  );
}
