export async function resolve(specifier, context, nextResolve) {
  if (specifier.startsWith('.')) {
    // Runtime-facing modules use explicit .js specifiers that point at .ts sources.
    if (specifier.endsWith('.js')) {
      try { return await nextResolve(specifier.replace(/\.js$/, '.ts'), context); } catch { /* try the normal resolver */ }
    } else if (!specifier.endsWith('.ts')) {
      try { return await nextResolve(`${specifier}.ts`, context); } catch { /* try the normal resolver */ }
    }
  }
  return nextResolve(specifier, context);
}
