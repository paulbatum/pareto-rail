// Level-scoped bridge between gameplay and visuals. The runner's events carry
// ids, not spawn data, so the window each thief has stripped is noted here by
// gameplay on first sight and taken here by visuals when the thief dies.

const stolenByEnemy = new Map<number, number>();

export function noteStolenWindow(enemyId: number, window: number): void {
  if (!stolenByEnemy.has(enemyId)) stolenByEnemy.set(enemyId, window);
}

export function takeStolenWindow(enemyId: number): number | undefined {
  const window = stolenByEnemy.get(enemyId);
  stolenByEnemy.delete(enemyId);
  return window;
}

export function peekStolenWindow(enemyId: number): number | undefined {
  return stolenByEnemy.get(enemyId);
}

export function resetStolenWindows(): void {
  stolenByEnemy.clear();
}
