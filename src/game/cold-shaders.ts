/* `?coldshaders=1`: makes every render entry point's WGSL unique to this page load, so no shader
   cache (Chrome's or the GPU driver's) has seen it, and the level compiles as it would for a
   first-time visitor. A comment would be stripped before hashing; a dead branch on a new
   builtin input survives into the compiled output without changing what is drawn. */
export function nonceShader(code: string, seed: number): string {
  const edits: Array<[number, number, string, number, string]> = [];
  const re = /@(vertex|fragment)\s*\n?\s*fn\s+\w+\s*\(/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(code))) {
    const stage = m[1];
    let depth = 1;
    let j = re.lastIndex;
    while (depth > 0 && j < code.length) {
      if (code[j] === '(') depth++;
      else if (code[j] === ')') depth--;
      j++;
    }
    const params = code.slice(re.lastIndex, j - 1);
    const brace = code.indexOf('{', j);
    const ret = code.slice(j, brace).replace(/^\s*->\s*/, '').replace(/@\w+\s*\([^)]*\)\s*/g, '').replace(/@\w+\s*/g, '').trim();
    const builtin = stage === 'vertex' ? 'vertex_index' : 'position';
    if (!ret || new RegExp(`builtin\\(\\s*${builtin}\\s*\\)`).test(params)) continue;
    const param = stage === 'vertex' ? '@builtin(vertex_index) nonceIn : u32' : '@builtin(position) nonceIn : vec4<f32>';
    const test = stage === 'vertex' ? `nonceIn == ${4000000000 + seed}u` : `nonceIn.x < ${-1000000 - seed}.0`;
    edits.push([m.index + m[0].length, j - 1, params.trim() ? `${params}, ${param}` : param, brace + 1, `\n\tif (${test}) { return ${ret}(); }\n`]);
  }
  for (const [paramStart, paramEnd, newParams, bodyStart, body] of edits.reverse()) {
    code = code.slice(0, bodyStart) + body + code.slice(bodyStart);
    code = code.slice(0, paramStart) + newParams + code.slice(paramEnd);
  }
  return code;
}

export function installColdShaders(): void {
  const proto = globalThis.GPUDevice?.prototype;
  if (!proto) return;
  const original = proto.createShaderModule;
  if ((original as { cold?: boolean }).cold) return;
  const seed = Math.floor(Math.random() * 1_000_000_000);
  const patched = function (this: GPUDevice, descriptor: GPUShaderModuleDescriptor) {
    return original.call(this, { ...descriptor, code: nonceShader(descriptor.code, seed) });
  };
  (patched as { cold?: boolean }).cold = true;
  proto.createShaderModule = patched;
  console.info(`coldshaders: shader sources nonced with seed ${seed}`);
}
