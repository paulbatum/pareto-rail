/** MSAA samples for the scene pass: the renderer's count, or 0 once the drawing buffer exceeds `maxPixels`. */
export function sceneSampleCount(rendererSamples: number, width: number, height: number, maxPixels: number | undefined) {
  if (maxPixels === undefined) return rendererSamples;
  return width * height > maxPixels ? 0 : rendererSamples;
}
