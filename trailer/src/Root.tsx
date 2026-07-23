import {Composition} from 'remotion';
import {Trailer, FPS, TOTAL_FRAMES} from './Trailer';
import {Trailer2, TOTAL_FRAMES_2} from './Trailer2';

export const Root: React.FC = () => {
  return (
    <>
      <Composition
        id="Trailer"
        component={Trailer}
        durationInFrames={TOTAL_FRAMES}
        fps={FPS}
        width={1920}
        height={1080}
      />
      <Composition
        id="Trailer2"
        component={Trailer2}
        durationInFrames={TOTAL_FRAMES_2}
        fps={FPS}
        width={1920}
        height={1080}
      />
    </>
  );
};
