import { abs, clamp, float, fract, hash, max, mix, mx_fractal_noise_float, screenSize, smoothstep, time, uniform, vec2, vec3, vec4 } from 'three/tsl';
import type { LevelPostColorNode, LevelPostComposeInput } from '../../../engine/types';

// The frame itself changes with the player's senses.
//
// MURK: a sodium grade. Inside ink the frame is swallowed — everything is
// crushed toward black except the brightest lamp cores, which survive as dim
// stains — and ragged oil-black swirls crawl in from the edges.
//
// THERMAL: a stark charcoal display. The (already thermal-shaded) scene is
// reduced to luminance with a hard contrast curve; only red survives as color,
// so signal cores and the full lock burn out of a grey world. Ink stays as
// cold black drift, scanlines and sensor grain sit on top, and switching on
// wipes the display in from the top as a bright scan bar.

export const postUniforms = {
  ink: uniform(0),
  thermal: uniform(0),
  /** Scan wipe progress when the sight switches on: 0 → 1.2. */
  sweep: uniform(1.2),
  /** Warm flash (murk) / white flash (thermal). */
  flash: uniform(0),
  /** Ink spattered on the lens by a hit. */
  splat: uniform(0),
  /** Static burst as the sight drops out. */
  static: uniform(0),
  /** Progress through the current beat (0 on the beat), for the sensor refresh line. */
  pulse: uniform(1),
};

export function composeThermalInkOutput({ base, screenUV }: LevelPostComposeInput): LevelPostColorNode {
  const { ink, thermal, sweep, flash, splat } = postUniforms;
  const aspect = screenSize.x.div(screenSize.y);
  const centered = screenUV.sub(0.5).mul(vec2(aspect, 1));
  const radius = centered.length();

  // Oil-black swirl field: slow fractal noise advected by time.
  const swirl = mx_fractal_noise_float(vec3(centered.mul(2.4), time.mul(0.12)), 3, 2, 0.5).mul(0.5).add(0.5);
  const creep = mx_fractal_noise_float(vec3(centered.mul(5.5).add(vec2(time.mul(0.05), 0)), time.mul(0.3)), 2, 2, 0.5).mul(0.5).add(0.5);
  const edge = smoothstep(float(0.25), float(0.95), radius);
  const inkMask = clamp(ink.mul(float(1.05).add(swirl.mul(0.5)).add(edge.mul(0.5))).sub(creep.mul(0.15)), 0, 1);

  const color = base.rgb;

  // --- murk ---
  // A dirty sodium grade: lift the blacks toward tobacco, press the highs to amber.
  const graded = color.mul(vec3(1.04, 0.98, 0.86)).add(vec3(0.006, 0.004, 0.0));
  // Inside ink, crush everything; the hottest lamp cores leak through as stains.
  const stains = max(color.sub(0.9), vec3(0, 0, 0)).mul(0.1);
  const swallowed = graded.mul(float(1).sub(inkMask.mul(0.97))).add(stains.mul(inkMask));
  const murk = swallowed.add(vec3(1.0, 0.62, 0.28).mul(flash.mul(0.35)));

  // --- thermal ---
  const luma = color.dot(vec3(0.299, 0.587, 0.114));
  const redness = clamp(color.r.sub(max(color.g, color.b)).mul(1.2), 0, 2.5);
  const heat = clamp(luma.sub(redness.mul(0.25)), 0, 3);
  // Hard contrast: cold stays charcoal, anything warm snaps up toward white.
  const grey = smoothstep(float(0.02), float(1.1), heat).pow(1.35).mul(1.25).add(heat.mul(0.08));
  // Ink stays cold black, but as drifting wisps the heat shows between.
  const wisps = smoothstep(float(0.5), float(0.85), swirl.add(creep.mul(0.25)));
  const coldInk = float(1).sub(ink.mul(wisps).mul(0.8)).sub(inkMask.mul(0.1));
  const scan = float(0.9).add(screenUV.y.mul(screenSize.y).mul(1.5708).sin().abs().mul(0.1));
  // Pixel-cell seed (hash takes a scalar), re-rolled every frame.
  const pixel = screenUV.mul(screenSize).floor();
  const frameSeed = fract(time.mul(13.7)).mul(9973);
  const grain = hash(pixel.x.add(pixel.y.mul(4099)).add(frameSeed)).sub(0.5).mul(0.055);
  let display = vec3(grey, grey, grey.mul(1.02)).mul(coldInk).mul(scan).add(grain);
  display = display.add(vec3(redness.mul(1.3), redness.mul(0.07), redness.mul(0.04)));
  // Display frame: corner brackets of a sensor readout.
  const frameUV = abs(screenUV.sub(0.5)).mul(2);
  const inCorner = frameUV.x.greaterThan(0.86).and(frameUV.y.greaterThan(0.8));
  const onLine = frameUV.x.sub(0.93).abs().lessThan(0.003).or(frameUV.y.sub(0.9).abs().lessThan(0.005));
  const bracket = inCorner.and(onLine).select(float(0.55), float(0));
  display = display.add(vec3(bracket, bracket, bracket)).add(vec3(flash, flash, flash).mul(0.6));
  // The sensor refreshes on the beat: a faint line rolls down the display.
  const refresh = smoothstep(float(0.012), float(0), abs(float(1).sub(screenUV.y).sub(postUniforms.pulse.mul(1.1)))).mul(float(1).sub(postUniforms.pulse)).mul(0.18);
  display = display.add(vec3(refresh, refresh, refresh));

  // The wipe: thermal is revealed from the top as the scan bar passes.
  const fromTop = float(1).sub(screenUV.y);
  const revealed = smoothstep(fromTop.sub(0.04), fromTop, sweep);
  const bar = smoothstep(float(0.05), float(0), abs(sweep.sub(fromTop))).mul(smoothstep(float(1.15), float(0.9), sweep));
  const mixAmount = thermal.mul(revealed);
  let out = mix(murk, display, mixAmount).add(vec3(0.9, 0.95, 1.0).mul(bar.mul(thermal).mul(1.4)));

  // Static when the sight drops out.
  const block = screenUV.mul(screenSize.mul(0.5)).floor();
  const noise = hash(block.x.add(block.y.mul(2053)).add(fract(time.mul(31)).mul(7919)));
  out = out.add(vec3(noise, noise, noise).mul(postUniforms.static.mul(0.35)));

  // Ink spattered across the lens by a hull hit: heavy at the rim, draining
  // down and out as `splat` falls.
  const drain = float(1).sub(splat);
  const spatter = mx_fractal_noise_float(vec3(centered.x.mul(7.5), centered.y.mul(5).add(drain.mul(1.6)), float(7.1)), 2, 2.2, 0.45).mul(0.5).add(0.5);
  const rim = smoothstep(float(0.38), float(1.0), radius);
  const coverage = spatter.add(rim.mul(0.55)).sub(drain.mul(0.3));
  const spatterMask = smoothstep(float(0.74), float(0.78), coverage).mul(smoothstep(float(0), float(0.25), splat));
  const oily = smoothstep(float(0.71), float(0.74), coverage).sub(spatterMask).clamp(0, 1);
  out = out.mul(float(1).sub(spatterMask.mul(0.94))).add(vec3(0.045, 0.034, 0.05).mul(oily).mul(splat));

  return vec4(out, base.a);
}
