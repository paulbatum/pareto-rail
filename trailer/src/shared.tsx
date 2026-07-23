import {
  AbsoluteFill,
  interpolate,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from 'remotion';
import {loadFont as loadArchivo} from '@remotion/google-fonts/Archivo';
import {loadFont as loadPlexMono} from '@remotion/google-fonts/IBMPlexMono';

export const archivo = loadArchivo();
export const plexMono = loadPlexMono();

export const FPS = 60;
export const FOOTAGE_FRAMES = 1030; // 17.167s at 60fps

export const PAPER = '#F2EDDF';
export const INK = '#171410';
export const ACCENT = '#E85D93';

export const Scrim: React.FC<{opacity: number}> = ({opacity}) => (
  <AbsoluteFill
    style={{
      background:
        'linear-gradient(to top, rgba(10,8,6,0.62) 0%, rgba(10,8,6,0.30) 22%, rgba(10,8,6,0) 45%)',
      opacity,
    }}
  />
);

// One overlay beat: a big headline that springs up, holds, and fades out.
export const Beat: React.FC<{
  children: React.ReactNode;
  durationInFrames: number;
}> = ({children, durationInFrames}) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const enter = spring({frame, fps, config: {damping: 200, stiffness: 90}});
  const exit = interpolate(
    frame,
    [durationInFrames - 14, durationInFrames - 2],
    [1, 0],
    {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'},
  );
  return (
    <AbsoluteFill>
      <Scrim opacity={enter * exit} />
      <div
        style={{
          position: 'absolute',
          left: 110,
          right: 110,
          bottom: 96,
          opacity: enter * exit,
          transform: `translateY(${(1 - enter) * 46}px)`,
          fontFamily: archivo.fontFamily,
          fontWeight: 800,
          fontSize: 84,
          lineHeight: 1.06,
          letterSpacing: '-0.01em',
          color: PAPER,
          textShadow: '0 2px 24px rgba(0,0,0,0.55)',
        }}
      >
        {children}
      </div>
    </AbsoluteFill>
  );
};

// In-game-style boxed mono chip.
export const Chip: React.FC<{
  children: React.ReactNode;
  size?: number;
  accent?: boolean;
}> = ({children, size = 30, accent = false}) => (
  <span
    style={{
      display: 'inline-block',
      padding: `${size * 0.42}px ${size * 0.75}px ${size * 0.34}px`,
      background: accent ? ACCENT : 'rgba(13,11,9,0.82)',
      color: accent ? INK : PAPER,
      fontFamily: plexMono.fontFamily,
      fontWeight: 600,
      fontSize: size,
      letterSpacing: '0.18em',
      textTransform: 'uppercase',
      whiteSpace: 'nowrap',
    }}
  >
    {children}
  </span>
);

// The "built by" beat: three model chips landing one after another.
export const ModelsBeat: React.FC<{durationInFrames: number}> = ({durationInFrames}) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const exit = interpolate(
    frame,
    [durationInFrames - 14, durationInFrames - 2],
    [1, 0],
    {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'},
  );
  const kicker = spring({frame, fps, config: {damping: 200, stiffness: 90}});
  const models = ['Claude Opus', 'Claude Fable', 'GPT-5.6 Sol'];
  return (
    <AbsoluteFill>
      <Scrim opacity={kicker * exit} />
      <div
        style={{
          position: 'absolute',
          left: 110,
          bottom: 96,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'flex-start',
          gap: 26,
          opacity: exit,
        }}
      >
        <div
          style={{
            opacity: kicker,
            transform: `translateY(${(1 - kicker) * 30}px)`,
            fontFamily: archivo.fontFamily,
            fontWeight: 800,
            fontSize: 60,
            color: PAPER,
            textShadow: '0 2px 24px rgba(0,0,0,0.55)',
          }}
        >
          Built by
        </div>
        {models.map((m, i) => {
          const s = spring({
            frame: frame - 16 - i * 34,
            fps,
            config: {damping: 200, stiffness: 110},
          });
          return (
            <div
              key={m}
              style={{
                opacity: s,
                transform: `translateY(${(1 - s) * 30}px)`,
              }}
            >
              <Chip size={40}>{m}</Chip>
            </div>
          );
        })}
      </div>
    </AbsoluteFill>
  );
};

export const Mark: React.FC<{size: number}> = ({size}) => (
  <svg width={size} height={size} viewBox="0 0 22 22">
    <rect
      x="4.5"
      y="4.5"
      width="13"
      height="13"
      transform="rotate(45 11 11)"
      fill="none"
      stroke={PAPER}
      strokeWidth="1.1"
    />
    <circle cx="11" cy="11" r="3" fill={ACCENT} />
  </svg>
);

export const EndCard: React.FC = () => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const markIn = spring({frame, fps, config: {damping: 200, stiffness: 70}});
  const titleIn = spring({frame: frame - 14, fps, config: {damping: 200, stiffness: 80}});
  const tagIn = spring({frame: frame - 30, fps, config: {damping: 200, stiffness: 80}});
  const urlIn = spring({frame: frame - 48, fps, config: {damping: 200, stiffness: 120}});
  return (
    <AbsoluteFill
      style={{
        background: INK,
        alignItems: 'center',
        justifyContent: 'center',
        flexDirection: 'column',
        gap: 34,
      }}
    >
      <div
        style={{
          opacity: markIn,
          transform: `scale(${0.7 + markIn * 0.3}) rotate(${(1 - markIn) * 45}deg)`,
        }}
      >
        <Mark size={150} />
      </div>
      <div
        style={{
          opacity: titleIn,
          transform: `translateY(${(1 - titleIn) * 24}px)`,
          fontFamily: archivo.fontFamily,
          fontWeight: 800,
          fontSize: 110,
          letterSpacing: '0.04em',
          color: PAPER,
        }}
      >
        PARETO RAIL
      </div>
      <div
        style={{
          opacity: tagIn,
          transform: `translateY(${(1 - tagIn) * 18}px)`,
          fontFamily: plexMono.fontFamily,
          fontWeight: 500,
          fontSize: 30,
          letterSpacing: '0.22em',
          textTransform: 'uppercase',
          color: 'rgba(242,237,223,0.72)',
        }}
      >
        The playable benchmark
      </div>
      <div
        style={{
          marginTop: 18,
          opacity: urlIn,
          transform: `scale(${0.9 + urlIn * 0.1})`,
        }}
      >
        <Chip size={36} accent>
          paretorail.com
        </Chip>
      </div>
    </AbsoluteFill>
  );
};

// Beat timings in frames, aligned to the edit's cut points.
export const BEATS = {
  line1: {from: 14, to: 169}, // orange ring level
  line2: {from: 169, to: 333}, // corona dive
  models: {from: 333, to: 558}, // tunnel levels
  line4: {from: 558, to: 792}, // pink canyon
  line5: {from: 806, to: 1014}, // cube + jellyfish bell
};
