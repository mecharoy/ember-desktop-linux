import { WING_RAMP } from "./palette";

/** Tiny inline SVG sparkline (weekly counts, oldest→newest). */
export default function Sparkline({
  values,
  width = 72,
  height = 20,
  stroke = WING_RAMP[1],
}: {
  values: number[];
  width?: number;
  height?: number;
  stroke?: string;
}) {
  const max = Math.max(...values, 1);
  const pad = 2;
  const step = values.length > 1 ? (width - pad * 2) / (values.length - 1) : 0;
  const points = values
    .map((v, i) => `${pad + i * step},${height - pad - (v / max) * (height - pad * 2)}`)
    .join(" ");
  return (
    <svg width={width} height={height} className="shrink-0" aria-hidden="true">
      <polyline points={points} fill="none" stroke={stroke} strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}
