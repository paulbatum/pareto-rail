import { uniform } from 'three/tsl';

// Shared shader knobs, written by the runtime every frame.
export const vitalityU = uniform(0.12); //  0 dim, sickly → 1 clean, golden: how much of the animal has come back to life
export const infectionU = uniform(1); //    1 parasites everywhere → 0 clean (drives violet stains)
export const pulseU = uniform(0); //        the jelly's heartbeat: 1 on the lub, decaying
export const cleanseU = uniform(0); //      the final clean-water wash (pull-back)
export const flashU = uniform(0); //        gold-white screen flash
export const hurtU = uniform(0); //         violet edge flash when the hull is hit
export const clarityU = uniform(0); //     0 murk … 1 the water clears (vista and the final reveal)
export const gloomU = uniform(0); //       0 open water … 1 the parent's chamber: violet-dark, ominous
