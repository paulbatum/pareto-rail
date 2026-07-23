import {AbsoluteFill, Sequence, interpolate, useCurrentFrame} from 'remotion';
import {EndCard, FOOTAGE_FRAMES, INK} from './shared';
import {FootageWithBeats} from './Trailer';
import {ChartScene} from './ChartScene';

const CHART_FRAMES = 280; // ~4.7s
const CARD_FRAMES = 185;
export const TOTAL_FRAMES_2 = FOOTAGE_FRAMES + CHART_FRAMES + CARD_FRAMES;

const CHART_FROM = FOOTAGE_FRAMES;
const CARD_FROM = FOOTAGE_FRAMES + CHART_FRAMES;

export const Trailer2: React.FC = () => {
  const frame = useCurrentFrame();
  const chartFade = interpolate(
    frame,
    [CARD_FROM - 16, CARD_FROM - 2],
    [1, 0],
    {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'},
  );
  return (
    <AbsoluteFill style={{background: INK}}>
      <FootageWithBeats />
      <Sequence from={CHART_FROM} durationInFrames={CHART_FRAMES}>
        <AbsoluteFill style={{opacity: chartFade}}>
          <ChartScene />
        </AbsoluteFill>
      </Sequence>
      <Sequence from={CARD_FROM}>
        <EndCard />
      </Sequence>
    </AbsoluteFill>
  );
};
