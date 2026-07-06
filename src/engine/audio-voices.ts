import { midiToFreq } from './music';
import { playNoiseHit, playOscillatorVoice, type AutomationStep, type BiquadFilterOptions } from './audio-kit';

export type VoiceFrequencyInput =
  | { frequency: number; midi?: never }
  | { midi: number; frequency?: never };

export type VoiceOscillatorSpec<Call extends object = object> = {
  type: OscillatorType | ((call: Call) => OscillatorType);
  gain?: number | ((call: Call) => number);
  octave?: number | ((call: Call) => number);
  midiOffset?: number | ((call: Call) => number);
  frequencyRatio?: number | ((call: Call) => number);
  detune?: number | ((call: Call) => number | undefined);
};

export type VoiceFilterSpec<Call extends object = object> = Omit<BiquadFilterOptions, 'frequency' | 'Q' | 'gain' | 'detune'> & {
  type?: BiquadFilterType | ((call: Call) => BiquadFilterType | undefined);
  frequency?: number | ((call: Call) => number | undefined);
  cutoff?: number | ((call: Call) => number | undefined);
  Q?: number | ((call: Call) => number | undefined);
  gain?: number | ((call: Call) => number | undefined);
  detune?: number | ((call: Call) => number | undefined);
  frequencyAutomation?: (time: number, call: Call) => AutomationStep[] | undefined;
};

export type VoiceEnvelopeSpec<Call extends object = object> = {
  attack?: number | ((call: Call) => number);
  decay: number | ((call: Call) => number);
  sustain?: number | ((call: Call) => number);
  release?: number | ((call: Call) => number);
  peak?: number | ((call: Call) => number);
  floor?: number | ((call: Call) => number);
  attackCurve?: 'linear' | 'exponential';
  decayCurve?: 'linear' | 'exponential';
  releaseCurve?: 'linear' | 'exponential';
};

export type VoiceSpec<Call extends object = object> = {
  oscillators: readonly VoiceOscillatorSpec<Call>[];
  envelope?: VoiceEnvelopeSpec<Call>;
  gainAutomation?: (time: number, gain: number, call: Call) => AutomationStep[];
  filter?: VoiceFilterSpec<Call>;
  frequencyAutomation?: (time: number, frequency: number, call: Call) => AutomationStep[] | undefined;
  duration?: number | ((call: Call) => number);
  stopPadding?: number | ((call: Call) => number);
  sends?: (call: Call) => Array<{ destination: AudioNode; gain: number }> | undefined;
};

export type VoicePlayOptions<Call extends object = object> = Call & VoiceFrequencyInput & {
  context: AudioContext;
  time: number;
  destination: AudioNode | AudioNode[];
  velocity?: number;
  weight?: number;
  gain?: number;
  detune?: number;
  cutoff?: number;
  duration?: number;
  stopPadding?: number;
  frequencyAutomation?: AutomationStep[];
  sends?: Array<{ destination: AudioNode; gain: number }>;
};

export function voice<Call extends object = object>(spec: VoiceSpec<Call>) {
  return {
    play(options: VoicePlayOptions<Call>) {
      const time = options.time;
      const duration = options.duration ?? resolve(spec.duration, options as unknown as Call, 0);
      const stopPadding = options.stopPadding ?? resolve(spec.stopPadding, options as unknown as Call, 0);
      const call = options as unknown as Call;
      const results = [];

      for (const oscillator of spec.oscillators) {
        const oscGain = resolve(oscillator.gain, call, 1);
        const velocity = options.velocity ?? 1;
        const weight = options.weight ?? 1;
        const gain = (options.gain ?? 1) * oscGain * velocity * weight;
        const frequency = oscillatorFrequency(options, oscillator, call);
        const detune = options.detune ?? resolve(oscillator.detune, call, undefined);
        const filter = resolveFilter(spec.filter, options, call, time);
        const gainAutomation = spec.gainAutomation
          ? spec.gainAutomation(time, gain, call)
          : envelopeAutomation(time, gain, duration, spec.envelope, call);

        results.push(playOscillatorVoice({
          context: options.context,
          time,
          stopTime: time + duration + stopPadding,
          oscillatorType: resolve(oscillator.type, call, 'sine'),
          frequency,
          detune,
          frequencyAutomation: options.frequencyAutomation ?? spec.frequencyAutomation?.(time, frequency, call),
          filter,
          gainAutomation,
          destination: options.destination,
          sends: options.sends ?? spec.sends?.(call),
        }));
      }

      return results;
    },
  };
}

export type NoiseHitSpec<Call extends object = object> = {
  filterType: BiquadFilterType | ((call: Call) => BiquadFilterType);
  frequency: number | ((call: Call) => number);
  velocity?: number | ((call: Call) => number);
  decay: number | ((call: Call) => number);
  loopStart?: number | ((call: Call) => number | undefined);
  offset?: number | ((call: Call) => number | undefined);
};

export type NoiseHitPlayOptions<Call extends object = object> = Call & {
  context: AudioContext;
  buffer: AudioBuffer;
  time: number;
  destination: AudioNode;
  velocity?: number;
  decay?: number;
  frequency?: number;
  filterType?: BiquadFilterType;
  loopStart?: number;
  offset?: number;
};

export function noiseHit<Call extends object = object>(spec: NoiseHitSpec<Call>) {
  return {
    play(options: NoiseHitPlayOptions<Call>) {
      const call = options as unknown as Call;
      return playNoiseHit({
        context: options.context,
        buffer: options.buffer,
        time: options.time,
        velocity: options.velocity ?? resolve(spec.velocity, call, 1),
        decay: options.decay ?? resolve(spec.decay, call, 0.05),
        filterType: options.filterType ?? resolve(spec.filterType, call, 'lowpass'),
        frequency: options.frequency ?? resolve(spec.frequency, call, 1000),
        destination: options.destination,
        loopStart: options.loopStart ?? resolve(spec.loopStart, call, undefined),
        offset: options.offset ?? resolve(spec.offset, call, undefined),
      });
    },
  };
}

function oscillatorFrequency<Call extends object>(options: VoicePlayOptions<Call>, oscillator: VoiceOscillatorSpec<Call>, call: Call) {
  const octave = resolve(oscillator.octave, call, 0);
  const midiOffset = resolve(oscillator.midiOffset, call, 0);
  const ratio = resolve(oscillator.frequencyRatio, call, 1);
  if (options.frequency !== undefined) return options.frequency * 2 ** octave * ratio;
  return midiToFreq(options.midi + octave * 12 + midiOffset) * ratio;
}

function resolveFilter<Call extends object>(
  spec: VoiceFilterSpec<Call> | undefined,
  options: VoicePlayOptions<Call>,
  call: Call,
  time: number,
): (BiquadFilterOptions & { frequencyAutomation?: AutomationStep[] }) | undefined {
  if (!spec) return undefined;
  const type = resolve(spec.type, call, undefined);
  const frequency = options.cutoff ?? resolve(spec.cutoff, call, resolve(spec.frequency, call, undefined));
  const Q = resolve(spec.Q, call, undefined);
  const gain = resolve(spec.gain, call, undefined);
  const detune = resolve(spec.detune, call, undefined);
  const frequencyAutomation = spec.frequencyAutomation?.(time, call);
  return { type, frequency, Q, gain, detune, frequencyAutomation };
}

function envelopeAutomation<Call extends object>(time: number, gain: number, duration: number, envelope: VoiceEnvelopeSpec<Call> | undefined, call: Call): AutomationStep[] {
  if (!envelope) {
    return [
      { type: 'set', value: gain, time },
      { type: 'exponentialRamp', value: 0.001, time: time + duration },
    ];
  }

  const attack = resolve(envelope.attack, call, 0);
  const decay = resolve(envelope.decay, call, duration);
  const sustain = resolve(envelope.sustain, call, 0);
  const release = resolve(envelope.release, call, 0);
  const peak = resolve(envelope.peak, call, gain);
  const floor = resolve(envelope.floor, call, 0.001);
  const steps: AutomationStep[] = [];

  if (attack > 0) {
    steps.push({ type: 'set', value: floor, time });
    steps.push({ type: envelope.attackCurve === 'exponential' ? 'exponentialRamp' : 'linearRamp', value: peak, time: time + attack });
  } else {
    steps.push({ type: 'set', value: peak, time });
  }

  if (sustain > 0) {
    steps.push({ type: envelope.decayCurve === 'linear' ? 'linearRamp' : 'exponentialRamp', value: sustain * gain, time: time + attack + decay });
    if (duration > release) steps.push({ type: 'set', value: sustain * gain, time: time + duration - release });
    steps.push({ type: envelope.releaseCurve === 'linear' ? 'linearRamp' : 'exponentialRamp', value: floor, time: time + duration });
  } else {
    steps.push({ type: envelope.decayCurve === 'linear' ? 'linearRamp' : 'exponentialRamp', value: floor, time: time + decay });
  }

  return steps;
}

function resolve<T, Call extends object>(value: T | ((call: Call) => T) | undefined, call: Call, fallback: T): T {
  return typeof value === 'function' ? (value as (call: Call) => T)(call) : value ?? fallback;
}
