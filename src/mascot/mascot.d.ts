/** Types for the vendored mascot kit (mascot.js). */

export type MascotState =
  | "idle"
  | "listening"
  | "thinking"
  | "saving"
  | "flying"
  | "loading"
  | "celebrate"
  | "sleeping";

export interface Mascot {
  readonly el: HTMLElement;
  /** Switch to a looping state and stay there. */
  set(state: MascotState): Mascot;
  /** Play one cycle, then fall back to the looping state. */
  once(state: MascotState, ms?: number): Mascot;
  readonly state: MascotState;
  readonly base: MascotState;
  onChange(fn: (state: MascotState) => void): () => void;
  destroy(): void;
}

export interface MountOptions {
  state?: MascotState;
  theme?: "dark";
  motion?: "always";
}

export interface EditorBinding {
  pause(): void;
  resume(): void;
  wake(): void;
  unbind(): void;
}

export interface BindEditorOptions {
  idleAfter?: number;
  thinkAfter?: number;
  sleepAfter?: number;
  thinking?: boolean;
}

export function mount(el: HTMLElement, opts?: MountOptions): Mascot;
export function bindEditor(m: Mascot, field: HTMLElement, opts?: BindEditorOptions): EditorBinding;
export const STATES: readonly MascotState[];

declare const ElytraMascot: {
  mount: typeof mount;
  bindEditor: typeof bindEditor;
  template(): string;
  STATES: readonly MascotState[];
  CYCLE: Record<string, number>;
  version: string;
};
export default ElytraMascot;
