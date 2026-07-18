import type { EventBus } from '../../events';
import { createBeatLevelAudio } from '../../engine/audio-kit';
import { secondsPerStep } from '../../engine/music';
import { STRANDLINE_C0FB_BPM } from './gameplay';

// Spine: keep arrangement, harmony, section structure, and timing decisions here.
// Move synth voice construction to leaf files as this level grows. This scaffold
// intentionally emits beat events while playing silence.
const BEAT_SECONDS = secondsPerStep(STRANDLINE_C0FB_BPM, 1);

export function createAudio(bus: EventBus) {
  return createBeatLevelAudio({
    bus,
    stepSeconds: BEAT_SECONDS,
    mix: {
      compressor: { threshold: -18, ratio: 5, attack: 0.005, release: 0.22 },
    },
    onStep() {
      // Silent by design. Replace with authored arrangement scheduling.
    },
  }).audio;
}
