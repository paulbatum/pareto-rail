import type { EventBus } from '../events';

const BPM = 120;
const BEAT = 60 / BPM;
const SIXTEENTH = BEAT / 4;
const SCHEDULE_AHEAD = 0.16;
const SCHEDULER_MS = 25;

export function createAudio(bus: EventBus) {
  let ctx: AudioContext | null = null;
  let intervalId = 0;
  let nextTickTime = 0;
  let sixteenthIndex = 0;

  const start = async () => {
    if (!ctx) {
      ctx = new AudioContext();
      nextTickTime = ctx.currentTime + 0.05;
      intervalId = window.setInterval(scheduleBeat, SCHEDULER_MS);
    }
    if (ctx.state === 'suspended') await ctx.resume();
  };

  const installGestureStart = () => {
    const wake = () => void start();
    window.addEventListener('pointerdown', wake, { once: true });
    window.addEventListener('keydown', wake, { once: true });
  };

  bus.on('lock', () => blip(520, 0.045, 0.04, 'triangle'));
  bus.on('fire', () => {
    if (!ctx) return;
    blip(240, 0.075, 0.08, 'sawtooth', quantizeToSixteenth(ctx.currentTime));
  });
  bus.on('kill', () => blip(880, 0.11, 0.09, 'square'));

  function scheduleBeat() {
    if (!ctx) return;
    while (nextTickTime < ctx.currentTime + SCHEDULE_AHEAD) {
      const isBeat = sixteenthIndex % 4 === 0;
      if (isBeat) {
        const beatNumber = Math.floor(sixteenthIndex / 4);
        kick(nextTickTime);
        emitBeatAt(nextTickTime, beatNumber, beatNumber % 4 === 0);
      }
      if (sixteenthIndex % 2 === 1) hat(nextTickTime);
      nextTickTime += SIXTEENTH;
      sixteenthIndex += 1;
    }
  }

  function emitBeatAt(time: number, beatNumber: number, isDownbeat: boolean) {
    if (!ctx) return;
    const delay = Math.max(0, (time - ctx.currentTime) * 1000);
    window.setTimeout(() => bus.emit('beat', { beatNumber, isDownbeat, audioTime: time }), delay);
  }

  function quantizeToSixteenth(time: number) {
    return Math.ceil(time / SIXTEENTH) * SIXTEENTH;
  }

  function kick(time: number) {
    if (!ctx) return;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(110, time);
    osc.frequency.exponentialRampToValueAtTime(42, time + 0.11);
    gain.gain.setValueAtTime(0.18, time);
    gain.gain.exponentialRampToValueAtTime(0.001, time + 0.13);
    osc.connect(gain).connect(ctx.destination);
    osc.start(time);
    osc.stop(time + 0.14);
  }

  function hat(time: number) {
    if (!ctx) return;
    const buffer = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 0.035), ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i += 1) data[i] = Math.random() * 2 - 1;
    const noise = ctx.createBufferSource();
    const gain = ctx.createGain();
    noise.buffer = buffer;
    gain.gain.setValueAtTime(0.035, time);
    gain.gain.exponentialRampToValueAtTime(0.001, time + 0.035);
    noise.connect(gain).connect(ctx.destination);
    noise.start(time);
    noise.stop(time + 0.04);
  }

  function blip(frequency: number, duration: number, volume: number, type: OscillatorType, when?: number) {
    if (!ctx) return;
    const time = when ?? ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(frequency, time);
    osc.frequency.exponentialRampToValueAtTime(Math.max(20, frequency * 0.5), time + duration);
    gain.gain.setValueAtTime(volume, time);
    gain.gain.exponentialRampToValueAtTime(0.001, time + duration);
    osc.connect(gain).connect(ctx.destination);
    osc.start(time);
    osc.stop(time + duration + 0.01);
  }

  return {
    start,
    installGestureStart,
    dispose() {
      if (intervalId) window.clearInterval(intervalId);
      void ctx?.close();
      ctx = null;
    },
  };
}
