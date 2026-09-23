export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

/**
 * Per-call hints a provider may use to make the request cheaper. Every field
 * is optional and every provider is free to ignore all of them — a provider
 * that does is still correct, just slower and dearer.
 */
export interface ChatOptions {
  /**
   * Stable id for the conversation these messages belong to (Elytra passes the
   * chat session's row id). Lets a provider continue a server- or CLI-side
   * session across turns instead of replaying the whole transcript, which
   * turns the prefix into a prompt-cache read. Omit it for one-shot calls.
   */
  conversationId?: string;
  /**
   * State that belongs to this turn only — the clock, how far into the
   * session we are. It rides on the outgoing user message rather than in the
   * system prompt, which has to stay byte-identical for the cached prefix to
   * survive.
   *
   * The provider applies it, not the caller, so that `messages` always stays
   * the plain stored history: a provider that resumes a session needs to
   * recognise that history turn to turn, and it can't do that if the caller
   * has already rewritten parts of it.
   */
  turnPreamble?: string;
  /**
   * How long a reply this call may need. Background jobs (journal entry,
   * extraction, reviews) ask for more than a chat turn; the provider raises
   * its usual ceiling to this, but never past what its tier allows.
   */
  maxTokens?: number;
}

/** Prepends ChatOptions.turnPreamble to the outgoing user message. Every
 *  provider calls this first, so the three behave identically. */
export function applyTurnPreamble(
  messages: ChatMessage[],
  preamble: string | undefined,
): ChatMessage[] {
  const last = messages[messages.length - 1];
  if (!preamble || !last || last.role !== "user") return messages;
  return [...messages.slice(0, -1), { ...last, content: `${preamble}

${last.content}` }];
}

export interface AIProvider {
  /** Streamed tokens for the live counselor chat. */
  chatStream(
    messages: ChatMessage[],
    system: string,
    options?: ChatOptions,
  ): AsyncIterable<string>;
  /** Non-streamed call for extraction/journal-writing/reviews (later phases). */
  complete(messages: ChatMessage[], system: string, options?: ChatOptions): Promise<string>;
}

/** Typed provider failure — surfaced in the UI as message + an actionable hint, never a raw throw-to-console. */
export class ProviderError extends Error {
  hint?: string;
  constructor(message: string, hint?: string) {
    super(message);
    this.name = "ProviderError";
    this.hint = hint;
  }
}
