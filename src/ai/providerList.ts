// The AI providers this edition offers, as the setup page and Settings show
// them in their drop-down.

export const PROVIDER_OPTIONS = [
  { id: "local", name: "Local model", blurb: "Ollama or LM Studio on this computer. Nothing leaves it." },
  { id: "cloud", name: "Free hosted model", blurb: "Groq, Gemini or OpenRouter. Needs a free key." },
  { id: "claude-subscription", name: "Claude subscription", blurb: "Pro or Max plan, through Claude Code." },
  { id: "codex-subscription", name: "ChatGPT subscription", blurb: "Plus or Pro plan, through Codex." },
  { id: "anthropic", name: "Anthropic API", blurb: "Claude, pay as you go. Needs a key." },
  { id: "openai", name: "OpenAI API", blurb: "ChatGPT's models, pay as you go. Needs a key." },
] as const;

export function isKnownProvider(id: string): boolean {
  return PROVIDER_OPTIONS.some((p) => p.id === id);
}
