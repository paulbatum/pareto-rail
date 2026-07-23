import {Composition} from 'remotion';
import {Trailer, FPS, TOTAL_FRAMES} from './Trailer';

export const Root: React.FC = () => {
  return (
    <Composition
      id="Trailer"
      component={Trailer}
      durationInFrames={TOTAL_FRAMES}
      fps={FPS}
      width={1920}
      height={1080}
    />
  );
};
