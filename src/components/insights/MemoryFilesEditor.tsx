import { useEffect, useState } from "react";
import { getProfileSummary, setProfileSummary } from "../../db/profile";
import { listMemoryFiles, saveMemoryFile, type MemoryFile, type MemoryFileName } from "../../db/memoryFiles";
import { MEMORY_FILE_LABELS, refreshMemoryFiles } from "../../ai/memoryFiles";
import { localStamp } from "../../time";

type Key = "about" | MemoryFileName;

/**
 * What Elytra knows about them, file by file, editable. Their edits are kept:
 * the weekly update adds to an edited file but doesn't reword it.
 */
export default function MemoryFilesEditor() {
  const [about, setAbout] = useState("");
  const [files, setFiles] = useState<MemoryFile[]>([]);
  const [editing, setEditing] = useState<{ key: Key; text: string } | null>(null);
  const [state, setState] = useState<{ busy: boolean; message: string | null }>({ busy: false, message: null });

  async function load() {
    const [p, f] = await Promise.all([getProfileSummary(), listMemoryFiles()]);
    setAbout(p ?? "");
    setFiles(f);
  }

  useEffect(() => {
    load();
  }, []);

  async function save() {
    if (!editing) return;
    if (editing.key === "about") await setProfileSummary(editing.text.trim(), localStamp());
    else await saveMemoryFile(editing.key, editing.text, true);
    setEditing(null);
    await load();
  }

  async function update() {
    setState({ busy: true, message: "Reading what Elytra has learned…" });
    const r = await refreshMemoryFiles().catch((e) => ({ ok: false as const, error: String(e) }));
    setState({ busy: false, message: r.ok ? "Updated." : `Couldn't update: ${r.error}` });
    await load();
  }

  const sections: { key: Key; title: string; what: string; text: string; edited: boolean }[] = [
    { key: "about", title: "About me", what: "Who you are, in a few lines.", text: about, edited: false },
    ...files.map((f) => ({ key: f.name as Key, title: MEMORY_FILE_LABELS[f.name].title, what: MEMORY_FILE_LABELS[f.name].what, text: f.content, edited: f.user_edited === 1 })),
  ];

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="font-serif text-[16px] text-fg">What Elytra knows about you</h3>
        <div className="flex items-center gap-3">
          {state.message && <span className="text-[12.5px] text-fg-faint">{state.message}</span>}
          <button onClick={update} disabled={state.busy} className="btn-chip">
            {state.busy ? "Updating…" : "Update now"}
          </button>
        </div>
      </div>
      <p className="hint max-w-2xl">
        Updated each week. Small models read only the lines that match your day, so each line stands on its own. Your
        edits are kept.
      </p>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        {sections.map((s) => (
          <section key={s.key} className="flex flex-col gap-1.5 rounded-lg border border-line bg-surface/60 p-4">
            <div className="flex items-baseline justify-between gap-2">
              <span className="font-serif text-[15.5px] text-fg">
                {s.title}
                {s.edited && <span className="ml-2 font-sans text-[11.5px] text-fg-faint">edited by you</span>}
              </span>
              {editing?.key !== s.key && (
                <button onClick={() => setEditing({ key: s.key, text: s.text })} className="btn-chip min-h-[26px] px-2.5 py-0.5 text-[12px]">
                  Edit
                </button>
              )}
            </div>
            <span className="text-[12px] text-fg-faint">{s.what}</span>
            {editing?.key === s.key ? (
              <>
                <textarea
                  autoFocus
                  className="input min-h-[140px] resize-y text-[14px] leading-relaxed"
                  value={editing.text}
                  onChange={(e) => setEditing({ key: s.key, text: e.target.value })}
                  placeholder="- One thing per line"
                />
                <div className="flex gap-2">
                  <button onClick={save} className="btn-chip">
                    Save
                  </button>
                  <button onClick={() => setEditing(null)} className="btn-ghost min-h-[30px] py-1 text-[12.5px]">
                    Cancel
                  </button>
                </div>
              </>
            ) : (
              <p className="whitespace-pre-wrap text-[13.5px] leading-relaxed text-fg-dim">{s.text || "Nothing yet."}</p>
            )}
          </section>
        ))}
      </div>
    </div>
  );
}
