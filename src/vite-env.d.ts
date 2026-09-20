/// <reference types="vite/client" />

/** Full commit SHA of the deployed build, injected by Vite. Empty when unavailable. */
declare const __COMMIT_HASH__: string;

/** Every benchmark level.json in one module, keyed `./<id>/level.json`. Shapes are
    unvalidated here; validateBenchmarkAssets checks them. */
declare module 'virtual:benchmark-descriptors' {
  const descriptors: Readonly<Record<string, unknown>>;
  export default descriptors;
}
