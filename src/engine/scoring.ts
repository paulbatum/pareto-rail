export type RunSummary = {
  score: number;
  kills: number;
  missed: number;
  totalEnemies: number;
  rank: string;
  details?: string[];
};

export function scoreForKill(volleySize: number) {
  const multiplier = 1 + Math.max(0, volleySize - 1) * 0.15;
  return Math.round(100 * multiplier);
}

export function rankForRun(score: number, kills: number, totalEnemies: number) {
  const clearRate = totalEnemies === 0 ? 0 : kills / totalEnemies;
  if (score >= 4200 && clearRate >= 0.9) return 'S';
  if (score >= 3200 && clearRate >= 0.75) return 'A';
  if (score >= 2200 && clearRate >= 0.55) return 'B';
  if (score >= 1200 && clearRate >= 0.35) return 'C';
  return 'D';
}
