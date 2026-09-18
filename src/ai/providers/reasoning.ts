/**
 * Reasoning models stream their scratchpad as ordinary content, wrapped in
 * `<think>…</think>`. Ember's chat is a conversation, so that has to go: it
 * reads as the model talking to itself, and on a capped free tier it also
 * eats the reply's token budget.
 *
 * Providers that can suppress it at source are asked to (see CLOUD_PRESETS),
 * but not every free model offers a switch, so the text is filtered here too.
 */

const OPEN = "<think>";
const CLOSE = "</think>";

/** How much of the tail must be held back in case it is a split tag. */
function partialTagLength(text: string, tag: string): number {
  for (let n = Math.min(text.length, tag.length - 1); n > 0; n--) {
    if (text.endsWith(tag.slice(0, n))) return n;
  }
  return 0;
}

/** Strips whole and unclosed think blocks out of a finished string. */
export function stripReasoning(text: string): string {
  const filter = createReasoningFilter();
  return (filter.push(text) + filter.flush()).trim();
}

/**
 * Stateful filter for a stream: `push` returns the part of the chunk that is
 * safe to show, holding back anything that might turn out to be a tag once
 * the next chunk arrives. `flush` releases the remainder at end of stream.
 */
export function createReasoningFilter() {
  let buffer = "";
  let inside = false;

  return {
    push(chunk: string): string {
      buffer += chunk;
      let out = "";

      for (;;) {
        if (inside) {
          const end = buffer.indexOf(CLOSE);
          if (end === -1) break;
          buffer = buffer.slice(end + CLOSE.length);
          inside = false;
        } else {
          const start = buffer.indexOf(OPEN);
          if (start === -1) break;
          out += buffer.slice(0, start);
          buffer = buffer.slice(start + OPEN.length);
          inside = true;
        }
      }

      if (inside) {
        // Everything still buffered is reasoning; keep only a split close tag.
        buffer = buffer.slice(buffer.length - partialTagLength(buffer, CLOSE));
      } else {
        const keep = partialTagLength(buffer, OPEN);
        out += buffer.slice(0, buffer.length - keep);
        buffer = buffer.slice(buffer.length - keep);
      }

      return out;
    },

    /** An unclosed block means the reply ran out mid-thought — show nothing. */
    flush(): string {
      const out = inside ? "" : buffer;
      buffer = "";
      inside = false;
      return out;
    },
  };
}
