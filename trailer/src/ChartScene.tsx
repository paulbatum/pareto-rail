import {
  AbsoluteFill,
  interpolate,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from 'remotion';
import {ACCENT, Chip, INK, PAPER, archivo, plexMono} from './shared';

// Chart geometry: x = generation cost ($0-60), y = preference rating (600-1600).
const PLOT = {left: 250, right: 1760, top: 340, bottom: 890};
const X_MAX = 60;
const Y_MIN = 600;
const Y_MAX = 1600;

const px = (cost: number) =>
  PLOT.left + (cost / X_MAX) * (PLOT.right - PLOT.left);
const py = (rating: number) =>
  PLOT.bottom - ((rating - Y_MIN) / (Y_MAX - Y_MIN)) * (PLOT.bottom - PLOT.top);

type Point = {
  cost: number;
  rating: number;
  frontier: boolean;
  estimate?: boolean;
  sub?: string;
  labelSide: 'above' | 'below';
};

// Loosely modeled on a real personal-results chart; names stay blurred anyway.
const POINTS: Point[] = [
  {cost: 4, rating: 825, frontier: true, labelSide: 'above'},
  {cost: 24, rating: 1180, frontier: true, sub: '$20 budget', labelSide: 'above'},
  {cost: 57, rating: 1385, frontier: true, estimate: true, labelSide: 'above'},
  {cost: 16, rating: 770, frontier: false, estimate: true, sub: '$20 budget', labelSide: 'above'},
  {cost: 32, rating: 1130, frontier: false, estimate: true, labelSide: 'below'},
  {cost: 32, rating: 965, frontier: false, sub: '$20 budget', labelSide: 'below'},
];

const FRONTIER = POINTS.filter((p) => p.frontier);

const GRID_COSTS = [0, 20, 40, 60];
const GRID_RATINGS = [600, 800, 1000, 1200, 1400, 1600];

export const ChartScene: React.FC = () => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();

  const frameIn = spring({frame, fps, config: {damping: 200, stiffness: 80}});
  const titleIn = spring({frame: frame - 6, fps, config: {damping: 200, stiffness: 90}});
  const lineProgress = interpolate(frame, [70, 150], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });

  const frontierPath = FRONTIER.map(
    (p, i) => `${i === 0 ? 'M' : 'L'} ${px(p.cost)} ${py(p.rating)}`,
  ).join(' ');

  const mono = (size: number): React.CSSProperties => ({
    fontFamily: plexMono.fontFamily,
    fontWeight: 500,
    fontSize: size,
    letterSpacing: '0.18em',
    textTransform: 'uppercase',
  });

  return (
    <AbsoluteFill style={{background: INK}}>
      {/* Header, styled after the rank page's personal-results section */}
      <div style={{position: 'absolute', left: 130, top: 92, opacity: titleIn}}>
        <div style={{...mono(26), color: ACCENT, marginBottom: 22}}>
          Personal results
        </div>
        <div
          style={{
            fontFamily: archivo.fontFamily,
            fontWeight: 800,
            fontSize: 74,
            color: PAPER,
            letterSpacing: '-0.01em',
          }}
        >
          Your votes become <span style={{color: ACCENT}}>your</span> Pareto frontier
        </div>
      </div>

      <div
        style={{
          position: 'absolute',
          right: 150,
          top: 118,
          opacity: titleIn,
          ...mono(24),
          color: 'rgba(242,237,223,0.6)',
        }}
      >
        {'↖'} better value
      </div>

      <svg
        width={1920}
        height={1080}
        style={{position: 'absolute', inset: 0, opacity: frameIn}}
      >
        {/* Grid + axes */}
        {GRID_RATINGS.map((r) => (
          <line
            key={r}
            x1={PLOT.left}
            x2={PLOT.right}
            y1={py(r)}
            y2={py(r)}
            stroke="rgba(242,237,223,0.13)"
            strokeWidth={r === Y_MIN ? 2 : 1}
          />
        ))}
        {GRID_COSTS.map((c) => (
          <line
            key={c}
            y1={PLOT.top}
            y2={PLOT.bottom}
            x1={px(c)}
            x2={px(c)}
            stroke="rgba(242,237,223,0.13)"
            strokeWidth={c === 0 ? 2 : 1}
          />
        ))}
        {GRID_RATINGS.map((r) => (
          <text
            key={r}
            x={PLOT.left - 26}
            y={py(r) + 9}
            textAnchor="end"
            fill="rgba(242,237,223,0.55)"
            style={{...(mono(24) as object), letterSpacing: '0.08em'}}
          >
            {r}
          </text>
        ))}
        {GRID_COSTS.map((c) => (
          <text
            key={c}
            x={px(c)}
            y={PLOT.bottom + 52}
            textAnchor="middle"
            fill="rgba(242,237,223,0.55)"
            style={{...(mono(24) as object), letterSpacing: '0.08em'}}
          >
            ${c}
          </text>
        ))}

        {/* Frontier line, revealed left-to-right so the dashes stay intact */}
        <clipPath id="frontier-wipe">
          <rect
            x={PLOT.left}
            y={PLOT.top - 40}
            width={(PLOT.right - PLOT.left + 40) * lineProgress}
            height={PLOT.bottom - PLOT.top + 80}
          />
        </clipPath>
        <path
          d={frontierPath}
          fill="none"
          stroke={ACCENT}
          strokeWidth={4}
          strokeDasharray="14 12"
          clipPath="url(#frontier-wipe)"
        />

        {/* Points */}
        {POINTS.map((p, i) => {
          const s = spring({
            frame: frame - 26 - i * 12,
            fps,
            config: {damping: 14, stiffness: 160},
          });
          const cx = px(p.cost);
          const cy = py(p.rating);
          return (
            <g key={i} transform={`translate(${cx} ${cy}) scale(${s})`}>
              {p.estimate ? (
                <circle
                  r={16}
                  fill="none"
                  stroke={p.frontier ? ACCENT : PAPER}
                  strokeWidth={4}
                  strokeDasharray="7 7"
                />
              ) : (
                <circle r={16} fill={p.frontier ? ACCENT : PAPER} />
              )}
            </g>
          );
        })}
      </svg>

      {/* Blurred name labels */}
      {POINTS.map((p, i) => {
        const s = spring({
          frame: frame - 40 - i * 12,
          fps,
          config: {damping: 200, stiffness: 120},
        });
        const above = p.labelSide === 'above';
        return (
          <div
            key={i}
            style={{
              position: 'absolute',
              left: px(p.cost) + 26,
              top: py(p.rating) + (above ? -64 : 30),
              opacity: s,
              display: 'flex',
              flexDirection: 'column',
              gap: 6,
              alignItems: 'flex-start',
            }}
          >
            <span
              style={{
                fontFamily: archivo.fontFamily,
                fontWeight: 700,
                fontSize: 34,
                color: PAPER,
                filter: 'blur(13px)',
              }}
            >
              Model name
            </span>
            {p.sub ? (
              <span style={{...mono(21), color: 'rgba(242,237,223,0.55)'}}>
                {p.sub}
              </span>
            ) : null}
          </div>
        );
      })}

      {/* Axis captions */}
      <div
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          bottom: 64,
          textAlign: 'center',
          opacity: frameIn,
          ...mono(24),
          color: 'rgba(242,237,223,0.6)',
        }}
      >
        Measured generation cost (USD) {'·'} lower is better {'←'}
      </div>
      <div
        style={{
          position: 'absolute',
          left: 74,
          top: PLOT.top,
          transformOrigin: 'left top',
          transform: `rotate(-90deg) translateX(${-(PLOT.bottom - PLOT.top)}px)`,
          opacity: frameIn,
          ...mono(24),
          color: 'rgba(242,237,223,0.6)',
        }}
      >
        Your preference rating {'·'} higher is better {'→'}
      </div>

      {/* Payoff chip */}
      <ChartPayoff frame={frame} />
    </AbsoluteFill>
  );
};

const ChartPayoff: React.FC<{frame: number}> = ({frame}) => {
  const {fps} = useVideoConfig();
  const s = spring({frame: frame - 150, fps, config: {damping: 200, stiffness: 110}});
  return (
    <div
      style={{
        position: 'absolute',
        left: 0,
        right: 0,
        bottom: 140,
        display: 'flex',
        justifyContent: 'center',
        opacity: s,
        transform: `translateY(${(1 - s) * 24}px)`,
      }}
    >
      <Chip size={34} accent>
        Rank levels to reveal the names
      </Chip>
    </div>
  );
};
