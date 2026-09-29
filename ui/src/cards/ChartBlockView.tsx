import { useEffect, useState } from 'react';
import { X, Maximize2 } from 'lucide-react';

export type ChartSpec = {
  title?: string;
  type?: 'bar' | 'line' | 'scatter' | 'pie';
  series?: { label: string; color?: string; data?: number[] }[];
  labels?: string[];
  [key: string]: unknown;
};

export type ChartBlock = {
  kind: 'chart';
  name: string;
  spec?: ChartSpec;
  data?: unknown[];
};

function SimpleSvgChart({
  spec,
  data: _data,
  width = 520,
  height = 240,
}: {
  spec?: ChartSpec;
  data?: unknown[];
  width?: number;
  height?: number;
}) {
  const series = spec?.series ?? [
    { label: 'Series A', color: 'var(--primary, #3b82f6)', data: [12, 19, 8, 15, 22, 30] },
    { label: 'Series B', color: '#10b981', data: [8, 11, 14, 12, 18, 24] },
  ];
  const labels = spec?.labels ?? ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun'];

  const padding = { top: 20, right: 20, bottom: 30, left: 40 };
  const chartWidth = Math.max(100, width - padding.left - padding.right);
  const chartHeight = Math.max(80, height - padding.top - padding.bottom);

  const allValues = series.flatMap(s => s.data ?? []);
  const maxVal = Math.max(1, ...allValues);

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      width="100%"
      height="100%"
      style={{ maxHeight: `${height}px`, overflow: 'visible' }}
    >
      {/* Grid lines */}
      {[0, 0.25, 0.5, 0.75, 1].map((pct, i) => {
        const y = padding.top + chartHeight * (1 - pct);
        return (
          <g key={i}>
            <line
              x1={padding.left}
              y1={y}
              x2={padding.left + chartWidth}
              y2={y}
              stroke="var(--border)"
              strokeDasharray="3 3"
              strokeWidth="1"
            />
            <text
              x={padding.left - 6}
              y={y + 3}
              textAnchor="end"
              fontSize="10"
              fill="var(--muted-foreground)"
            >
              {Math.round(maxVal * pct)}
            </text>
          </g>
        );
      })}

      {/* Series */}
      {series.map((s, sIdx) => {
        const dataPoints = s.data ?? [];
        if (dataPoints.length === 0) return null;
        const color = s.color ?? '#3b82f6';

        // Draw line chart
        const points = dataPoints.map((val, idx) => {
          const x = padding.left + (idx / Math.max(1, dataPoints.length - 1)) * chartWidth;
          const y = padding.top + chartHeight * (1 - val / maxVal);
          return `${x},${y}`;
        });

        return (
          <g key={sIdx}>
            <polyline
              fill="none"
              stroke={color}
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              points={points.join(' ')}
            />
            {dataPoints.map((val, idx) => {
              const x = padding.left + (idx / Math.max(1, dataPoints.length - 1)) * chartWidth;
              const y = padding.top + chartHeight * (1 - val / maxVal);
              return (
                <circle
                  key={idx}
                  cx={x}
                  cy={y}
                  r="3.5"
                  fill="var(--card)"
                  stroke={color}
                  strokeWidth="2"
                />
              );
            })}
          </g>
        );
      })}

      {/* X axis labels */}
      {labels.map((label, idx) => {
        const x = padding.left + (idx / Math.max(1, labels.length - 1)) * chartWidth;
        const y = padding.top + chartHeight + 18;
        return (
          <text
            key={idx}
            x={x}
            y={y}
            textAnchor="middle"
            fontSize="10"
            fill="var(--muted-foreground)"
          >
            {label}
          </text>
        );
      })}
    </svg>
  );
}

/**
 * Polaris ChartBlockView for rendering SVG data charts with an Expand dialog.
 */
export function ChartBlockView({
  name,
  spec = {},
  data = [],
}: {
  name: string;
  spec?: ChartSpec;
  data?: unknown[];
}) {
  const [expanded, setExpanded] = useState(false);
  const [viewport, setViewport] = useState(() => ({
    width: typeof window !== 'undefined' ? window.innerWidth : 800,
    height: typeof window !== 'undefined' ? window.innerHeight : 600,
  }));

  useEffect(() => {
    if (!expanded) return;
    const onResize = () => setViewport({ width: window.innerWidth, height: window.innerHeight });
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [expanded]);

  const series = spec?.series ?? [
    { label: 'Series A', color: 'var(--primary, #3b82f6)' },
    { label: 'Series B', color: '#10b981' },
  ];

  return (
    <>
      <div
        data-testid="chart-block-view"
        className="group relative max-w-[74%] rounded-[20px] border border-border bg-card p-4 text-foreground shadow-sm"
      >
        {spec?.title ? (
          <div className="mb-1 text-[14.5px] font-semibold text-foreground">{spec.title}</div>
        ) : null}
        {series.length > 0 ? (
          <div className="mb-2 flex flex-wrap gap-x-3 gap-y-1">
            {series.map(s => (
              <span
                key={s.label}
                className="flex items-center gap-1.5 text-[12px] text-muted-foreground"
              >
                <span
                  className="h-[10px] w-[10px] rounded-[3px]"
                  style={{ background: s.color ?? '#3b82f6' }}
                />
                {s.label}
              </span>
            ))}
          </div>
        ) : null}

        <div className="pt-2">
          <SimpleSvgChart spec={spec} data={data} width={520} height={220} />
        </div>

        <button
          type="button"
          onClick={() => setExpanded(true)}
          aria-label="Expand chart"
          className="absolute end-3 top-3 flex items-center gap-1 rounded-lg border border-border bg-card px-2.5 py-1 text-xs text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100 hover:text-foreground hover:bg-accent"
        >
          <Maximize2 size={12} />
          <span>Expand</span>
        </button>
      </div>

      {expanded ? (
        <div
          className="polaris-dialog-backdrop"
          onClick={e => {
            if (e.target === e.currentTarget) setExpanded(false);
          }}
        >
          <div
            className="polaris-dialog-content max-h-[92vh] w-[min(1120px,94vw)] max-w-none overflow-auto p-6 sm:max-w-none"
            role="dialog"
            aria-modal="true"
          >
            <div className="flex items-center justify-between pb-4 border-b border-border">
              <h2 className="text-[14px] font-medium text-foreground">{name}</h2>
              <button
                type="button"
                aria-label="Close chart"
                onClick={() => setExpanded(false)}
                className="flex h-7 w-7 items-center justify-center rounded-lg text-muted-foreground hover:bg-accent hover:text-foreground"
              >
                <X size={16} />
              </button>
            </div>
            <div className="py-4">
              <SimpleSvgChart
                spec={spec}
                data={data}
                width={Math.min(1000, viewport.width - 80)}
                height={Math.min(500, viewport.height - 200)}
              />
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
