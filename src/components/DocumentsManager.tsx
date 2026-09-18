import { useEffect, useRef, useState } from "react";
import { listDocuments, removeDocument, saveDocument, setDocumentEnabled } from "../db/documents";
import type { UserDocument } from "../db/types";
import {
  DOCUMENT_ACCEPT,
  DOCUMENT_CHAR_BUDGET,
  DOCUMENT_MAX_FILE_BYTES,
  isAcceptedDocumentName,
  normalizeDocumentText,
} from "../ai/documents";

function formatChars(n: number): string {
  return n < 1000 ? `${n} characters` : `${(n / 1000).toFixed(1)}k characters`;
}

/**
 * Settings → Your documents. Changes apply straight away (no Save needed);
 * the next evening session picks them up — a session already open keeps the
 * snapshot it started with.
 */
export default function DocumentsManager() {
  const [docs, setDocs] = useState<UserDocument[] | null>(null);
  const [problems, setProblems] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  function refresh() {
    return listDocuments().then(setDocs);
  }

  useEffect(() => {
    refresh();
  }, []);

  async function handleFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    setBusy(true);
    const errors: string[] = [];
    for (const file of Array.from(files)) {
      if (!isAcceptedDocumentName(file.name)) {
        errors.push(`${file.name}: only .md and .txt files can be added.`);
        continue;
      }
      if (file.size > DOCUMENT_MAX_FILE_BYTES) {
        errors.push(`${file.name}: too large. The limit is ${DOCUMENT_MAX_FILE_BYTES / 1000} KB per file.`);
        continue;
      }
      try {
        await saveDocument(file.name, normalizeDocumentText(await file.text()));
      } catch (e) {
        errors.push(`${file.name}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
    // Clear the picker so choosing the same file again (after editing it) still fires onChange.
    if (inputRef.current) inputRef.current.value = "";
    setProblems(errors);
    setBusy(false);
    await refresh();
  }

  async function handleToggle(d: UserDocument) {
    await setDocumentEnabled(d.id, d.enabled !== 1);
    await refresh();
  }

  async function handleRemove(d: UserDocument) {
    await removeDocument(d.id);
    await refresh();
  }

  const loaded = (docs ?? []).filter((d) => d.enabled === 1).reduce((n, d) => n + d.content.length, 0);
  const over = loaded > DOCUMENT_CHAR_BUDGET;

  return (
    <div className="flex max-w-md flex-col gap-3">
      <div>
        <button onClick={() => inputRef.current?.click()} disabled={busy} className="btn-subtle">
          {busy ? "Adding…" : "Add files"}
        </button>
        <input
          ref={inputRef}
          type="file"
          multiple
          accept={DOCUMENT_ACCEPT}
          className="hidden"
          onChange={(e) => handleFiles(e.target.files)}
        />
      </div>

      {problems.map((p) => (
        <p key={p} className="text-[12px] text-danger">
          {p}
        </p>
      ))}

      {docs && docs.length > 0 && (
        <>
          <ul className="flex flex-col divide-y divide-rule border-y border-rule">
            {docs.map((d) => (
              <li key={d.id} className="flex items-center gap-3 py-2 text-[13.5px]">
                <label className="flex min-w-0 flex-1 items-center gap-2.5" title="Read in each conversation">
                  <input
                    type="checkbox"
                    checked={d.enabled === 1}
                    onChange={() => handleToggle(d)}
                    className="h-3.5 w-3.5 shrink-0 accent-ember"
                  />
                  <span className={`truncate ${d.enabled === 1 ? "text-ink" : "text-ink-faint line-through"}`}>{d.name}</span>
                </label>
                <span className="shrink-0 text-[12px] tabular-nums text-ink-faint">{formatChars(d.content.length)}</span>
                <button onClick={() => handleRemove(d)} className="shrink-0 text-[12px] text-ink-faint hover:text-danger">
                  Remove
                </button>
              </li>
            ))}
          </ul>
          <span className={`text-[12px] ${over ? "text-ember" : "text-ink-faint"}`}>
            {formatChars(loaded)} of {formatChars(DOCUMENT_CHAR_BUDGET)} go into each conversation.
            {over && " Anything past the limit is cut off, so untick a file or shorten it."}
          </span>
        </>
      )}
    </div>
  );
}
