import {
  AbsoluteFill,
  OffthreadVideo,
  Sequence,
  interpolate,
  staticFile,
  useCurrentFrame,
} from 'remotion';
import {
  ACCENT,
  BEATS,
  Beat,
  EndCard,
  FOOTAGE_FRAMES,
  INK,
  ModelsBeat,
} from './shared';

export {FPS} from './shared';

const CARD_FRAMES = 190;
export const TOTAL_FRAMES = FOOTAGE_FRAMES + CARD_FRAMES;

// The 17s gameplay edit with all overlay beats, fading out at the end.
export const FootageWithBeats: React.FC = () => {
  const frame = useCurrentFrame();
  const footageFade = interpolate(
    frame,
    [FOOTAGE_FRAMES - 22, FOOTAGE_FRAMES - 2],
    [1, 0],
    {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'},
  );
  return (
    <>
      <Sequence durationInFrames={FOOTAGE_FRAMES}>
        <AbsoluteFill style={{opacity: footageFade}}>
          <OffthreadVideo
            src={staticFile('footage.mp4')}
            volume={(f) =>
              interpolate(f, [FOOTAGE_FRAMES - 40, FOOTAGE_FRAMES - 4], [1, 0], {
                extrapolateLeft: 'clamp',
                extrapolateRight: 'clamp',
              })
            }
          />
        </AbsoluteFill>
      </Sequence>

      <Sequence from={BEATS.line1.from} durationInFrames={BEATS.line1.to - BEATS.line1.from}>
        <Beat durationInFrames={BEATS.line1.to - BEATS.line1.from}>
          Every level in this video
        </Beat>
      </Sequence>

      <Sequence from={BEATS.line2.from} durationInFrames={BEATS.line2.to - BEATS.line2.from}>
        <Beat durationInFrames={BEATS.line2.to - BEATS.line2.from}>
          was <span style={{color: ACCENT}}>one-shot</span> by an AI model
        </Beat>
      </Sequence>

      <Sequence from={BEATS.models.from} durationInFrames={BEATS.models.to - BEATS.models.from}>
        <ModelsBeat durationInFrames={BEATS.models.to - BEATS.models.from} />
      </Sequence>

      <Sequence from={BEATS.line4.from} durationInFrames={BEATS.line4.to - BEATS.line4.from}>
        <Beat durationInFrames={BEATS.line4.to - BEATS.line4.from}>
          Want to know which was which?
        </Beat>
      </Sequence>

      <Sequence from={BEATS.line5.from} durationInFrames={BEATS.line5.to - BEATS.line5.from}>
        <Beat durationInFrames={BEATS.line5.to - BEATS.line5.from}>
          Play them. <span style={{color: ACCENT}}>Rank them blind.</span>
        </Beat>
      </Sequence>
    </>
  );
};

export const Trailer: React.FC = () => {
  return (
    <AbsoluteFill style={{background: INK}}>
      <FootageWithBeats />
      <Sequence from={FOOTAGE_FRAMES}>
        <EndCard />
      </Sequence>
    </AbsoluteFill>
  );
};
