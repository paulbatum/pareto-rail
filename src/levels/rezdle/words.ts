let wordSet: Set<string> | null = null;
let loading: Promise<void> | null = null;

export function loadWords(): Promise<void> {
  loading ??= import('./word-data').then(({ default: data }) => {
    wordSet = new Set(data.trim().split('\n'));
  });
  return loading;
}

export function isWord(candidate: string): boolean {
  return wordSet?.has(candidate.toUpperCase()) ?? false;
}
