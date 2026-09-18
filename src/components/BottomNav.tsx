interface BottomNavProps {
  active: string;
  onSelect: (tab: string) => void;
}

/** Line icons drawn in the ink colour; one stroke weight, no fills. */
export function NavIcon({ id }: { id: string }) {
  const common = {
    width: 22,
    height: 22,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.6,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true,
  };
  switch (id) {
    case "today": // a flame
      return (
        <svg {...common}>
          <path d="M12 21c-3.9 0-6.5-2.6-6.5-6.2 0-3.1 2.2-5 3.6-7.2.4 1.8 1.4 2.9 2.4 3.3.2-2.9 1.4-5.4 3.4-7.4.3 3 3.6 5.5 3.6 10.1C18.5 17.9 15.9 21 12 21z" />
          <path d="M12 21c-1.6 0-2.8-1.2-2.8-2.9 0-1.6 1.3-2.6 2.2-3.8.9 1.3 3.4 2.3 3.4 4 0 1.5-1.2 2.7-2.8 2.7z" />
        </svg>
      );
    case "journal": // an open notebook
      return (
        <svg {...common}>
          <path d="M12 6.5C10 5 7.5 4.5 4 4.8v13.4c3.5-.3 6 .2 8 1.8 2-1.6 4.5-2.1 8-1.8V4.8c-3.5-.3-6 .2-8 1.7z" />
          <path d="M12 6.5V20" />
        </svg>
      );
    case "insights": // a rising line
      return (
        <svg {...common}>
          <path d="M4 19h16" />
          <path d="M5 15.5l4.2-4.3 3.3 2.8L19 7" />
          <circle cx="19" cy="7" r="1.2" />
        </svg>
      );
    default: // settings: sliders
      return (
        <svg {...common}>
          <path d="M5 7h9M18 7h1M5 12h3M12 12h7M5 17h11M20 17h-1" />
          <circle cx="16" cy="7" r="2" />
          <circle cx="10" cy="12" r="2" />
          <circle cx="18" cy="17" r="2" />
        </svg>
      );
  }
}

export const TABS = [
  { id: "today", label: "Today" },
  { id: "journal", label: "Journal" },
  { id: "insights", label: "Insights" },
  { id: "settings", label: "Settings" },
];

export default function BottomNav({ active, onSelect }: BottomNavProps) {
  return (
    <nav
      className="relative z-30 flex shrink-0 border-t border-rule bg-paper/95"
      style={{ height: "var(--nav-h)" }}
      aria-label="Sections"
    >
      {TABS.map((tab) => {
        const on = active === tab.id;
        return (
          <button
            key={tab.id}
            onClick={() => onSelect(tab.id)}
            aria-current={on ? "page" : undefined}
            className={`relative flex flex-1 flex-col items-center justify-center gap-0.5 transition-colors duration-200 ${
              on ? "text-ink" : "text-ink-faint"
            }`}
          >
            <span
              aria-hidden="true"
              className={`absolute top-0 h-[2px] w-8 rounded-full bg-ember transition-opacity duration-200 ${on ? "opacity-100" : "opacity-0"}`}
            />
            <span className={`transition-transform duration-200 ${on ? "-translate-y-px" : ""}`}>
              <NavIcon id={tab.id} />
            </span>
            <span className="text-[11.5px] leading-none">{tab.label}</span>
          </button>
        );
      })}
    </nav>
  );
}
