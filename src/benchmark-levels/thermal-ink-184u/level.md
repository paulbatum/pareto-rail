# Thermal Ink

Circle a giant mutant octopus wrapped around two wrecks in a drowned industrial harbor. When its ink swallows the lamps, press **I** or tap the infrared button: cold machinery recedes, living tissue turns white-hot, and vulnerable cores remain red. Sever eight arms and destroy the central core during the final blackout.

## Visual language
Tobacco water, ochre fog, corroded gantries, dirty cream hull plating, snapped cables, and sodium lamps. The octopus has tapered curling arms, paired sucker rows, a breathing oily mantle, and slit eyes. Infrared changes material visibility and target acquisition rather than applying a screen tint. Lock brackets, signal rings, and metallic fragments remain legible without bloom.

## Musical language
96 BPM, 24 bars, exactly 60 seconds. A slow kick and syncopated sub/saw bass support sparse inharmonic metal strikes and a recurring minor-key melody. Infrared reduces percussion noise and focuses the melody into a brighter triangle voice. Locks and fire snap to the transport; kills perform a harmony-relative melodic lane. Core destruction ducks the backing and plays a descending resolution.

## Mechanical signature
One continuous boss encounter. Opposite arm pairs become targets across four phrases. Three machinery-born spawn types move differently: crabs scuttle and hop, cable eels sweep sideways, and diving bells pulse forward while sinking. All eight arm nodes must be severed before the six-hit core opens at 53.125 seconds. Five ink passages interrupt optical targeting. The run uses score pressure rather than hull damage; surviving arms and an intact core are reported as a failed harbor clearance.

## What to read
- `index.ts`: runtime, infrared button, sensor readout, and level metadata.
- `gameplay.ts`: rail, timed ink, arm sockets, spawn phrases, core gating, and scoring.
- `audio.ts`: harmony, arrangement, quantized action voices, and thermal mix.
- `visuals/index.ts`: palette, heat visibility, event effects, and destruction animation.
- `visuals/models.ts` and `visuals/harbor.ts`: procedural geometry.

## What to study here
The sensor changes what the player can acquire: normal vision loses targets inside dense ink, while infrared reveals living tissue through it. The same world-space boss sockets control both the visual arm layout and lockable arm nodes. Destroyed arms fall below the harbor surface instead of disappearing on impact.

## Status & notes
The shot grid inherits the runner's tempo-adaptive volley rhythm and 32nd-note action quantization. The generous 0.15 NDC lock radius accommodates moving targets while the camera circles. The encounter deliberately has no hull damage or right-click lock undo. A human WebGPU playtest should check the sensor transition, final six-lock volley, low passes around hulls, and perceived audio balance.
