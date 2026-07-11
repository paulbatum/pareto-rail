export async function resolve(specifier, context, nextResolve) {
  if (specifier.startsWith('.') && !specifier.endsWith('.ts')) {
    try { return await nextResolve(`${specifier}.ts`, context); } catch { /* try the normal resolver */ }
  }
  return nextResolve(specifier, context);
}
