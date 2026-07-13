import { mapVerdict, type BenchmarkApi, type BenchmarkDataClass, type BenchmarkTheme, type MatchupAssignment, type MatchupVote, type NextMatchupRequest, type PlayCounts, type RecordPlayRequest, type RevealPayload, type SubmitVoteRequest, type VoteVerdict } from './types';

export const DOWNPOUR_THEME: BenchmarkTheme = {
  id: 'downpour',
  title: 'Downpour',
  summary: 'A rain-lashed neon courier run through a megacity.',
  prompt: 'Race as a hunted courier drone through a rain-lashed neon megacity at night.',
};

export interface FixtureEntrant {
  entrantId: string;
  playableRef: string;
  levelId: string;
  modelName: string;
  snapshotLabel: string;
  workflowName: string;
  generationCost: number;
  thumbnailPath: string;
  dataClass: BenchmarkDataClass;
  playable: boolean;
}

/** Exactly the five passing Downpour rehearsal entries. The failed xgz7 entry
 * is intentionally absent, and this list is only exposed by development mode. */
export const DOWNPOUR_FIXTURE_ENTRANTS: readonly FixtureEntrant[] = [
  ['7snm', 'downpour-7snm', 'gpt-5.6-sol', 'rehearsal-7snm', 'delegated', 2.554578],
  ['hlht', 'downpour-hlht', 'gpt-5.6-terra', 'rehearsal-hlht', 'solo', 1.281275],
  ['ou7e', 'downpour-ou7e', 'gpt-5.6-sol', 'rehearsal-ou7e', 'delegated', 1.651145],
  ['f2e6', 'downpour-f2e6', 'claude-sonnet-5', 'rehearsal-f2e6', 'solo', 15.3103113],
  ['wpxk', 'downpour-wpxk', 'claude-fable-5-opus', 'rehearsal-wpxk', 'delegated', 45.86639475],
].map(([suffix, levelId, modelName, snapshotLabel, workflowName, generationCost]) => ({
  entrantId: `downpour-${suffix}`,
  playableRef: `asset-${suffix}`,
  levelId, modelName, snapshotLabel, workflowName, generationCost,
  thumbnailPath: `/benchmark/thumbnails/asset-${suffix}.png`, dataClass: 'rehearsal', playable: true,
})) as readonly FixtureEntrant[];

export interface FixtureCatalog {
  themes: readonly BenchmarkTheme[];
  entrants: readonly FixtureEntrant[];
}

/** Production construction has no rehearsal catalog. Callers must opt into
 * development explicitly, making leakage into an eligible pool impossible. */
export function createFixtureCatalog(mode: 'development' | 'production' = 'production'): FixtureCatalog {
  return mode === 'development' ? { themes: [DOWNPOUR_THEME], entrants: DOWNPOUR_FIXTURE_ENTRANTS } : { themes: [], entrants: [] };
}

export function validateFixtureCatalog(catalog: FixtureCatalog, mode: 'development' | 'production'): void {
  if (mode === 'production' && catalog.entrants.some((entrant) => entrant.dataClass !== 'eligible')) {
    throw new Error('Rehearsal entries cannot be present in a production catalog');
  }
  if (mode === 'development' && catalog.entrants.length !== 5) throw new Error('Development Downpour fixture must contain exactly five entrants');
  if (catalog.entrants.some((entrant) => !entrant.playable)) throw new Error('Fixture catalog contains an unplayable entrant');
}

function pairId(themeId: string, a: string, b: string): string { return `${themeId}:${a}__${b}`; }

export class FixtureBenchmarkApi implements BenchmarkApi {
  readonly catalog: FixtureCatalog;
  private readonly counts = new Map<string, PlayCounts>();
  private readonly votes = new Map<string, MatchupVote>();
  private readonly assignments = new Map<string, MatchupAssignment>();

  constructor(catalog = createFixtureCatalog('production'), mode: 'development' | 'production' = catalog.entrants.some((entrant) => entrant.dataClass === 'rehearsal') ? 'development' : 'production') {
    this.catalog = catalog;
    validateFixtureCatalog(catalog, mode);
  }

  /** Rehydrate a locally persisted round after a browser refresh. */
  restoreAssignment(assignment: MatchupAssignment, participantId: string, playCounts: PlayCounts = { a: 0, b: 0 }) {
    this.assignments.set(assignment.matchupId, assignment);
    this.counts.set(participantKey(participantId, assignment.matchupId), { ...playCounts });
  }

  async nextMatchup(request: NextMatchupRequest): Promise<MatchupAssignment | null> {
    const judged = new Set((request.judged ?? []).map((item) => item.matchupId));
    const theme = this.catalog.themes[0];
    if (!theme) return null;
    const entrants = this.catalog.entrants.filter((entrant) => entrant.playable);
    const pairs: [FixtureEntrant, FixtureEntrant][] = [];
    for (let i = 0; i < entrants.length; i += 1) for (let j = i + 1; j < entrants.length; j += 1) pairs.push([entrants[i], entrants[j]]);
    const selected = pairs.find(([a, b]) => !judged.has(pairId(theme.id, a.entrantId, b.entrantId))) ?? pairs[0];
    if (!selected) return null;
    const [a, b] = selected;
    const matchupId = pairId(theme.id, a.entrantId, b.entrantId);
    const assignment: MatchupAssignment = {
      matchupId,
      benchmarkVersion: 'fixture-downpour-v1',
      theme,
      a: { playableRef: a.playableRef, thumbnailPath: a.thumbnailPath },
      b: { playableRef: b.playableRef, thumbnailPath: b.thumbnailPath },
      assignedAt: new Date().toISOString(),
    };
    this.assignments.set(matchupId, assignment);
    return assignment;
  }

  async recordPlay(request: RecordPlayRequest): Promise<PlayCounts> {
    if (!this.assignments.has(request.matchupId) || !request.participantId) throw new Error('Unknown matchup or participant');
    const key = participantKey(request.participantId, request.matchupId);
    const counts = this.counts.get(key) ?? { a: 0, b: 0 };
    counts[request.side] += 1;
    this.counts.set(key, counts);
    return { ...counts };
  }

  async submitVote(request: SubmitVoteRequest): Promise<MatchupVote> {
    const assignment = this.assignments.get(request.matchupId);
    if (!assignment) throw new Error('Unknown matchup');
    if (!request.participantId) throw new Error('Participant is required');
    const key = participantKey(request.participantId, request.matchupId);
    const counts = this.counts.get(key) ?? { a: 0, b: 0 };
    if (counts.a < 1 || counts.b < 1 || request.playCounts.a < 1 || request.playCounts.b < 1) throw new Error('Both entrants must be played before voting');
    const prior = this.votes.get(key);
    if (prior) {
      if (prior.verdict !== request.verdict) throw new Error('A matchup already has a different vote');
      return prior;
    }
    const a = entrantForRef(this.catalog.entrants, assignment.a.playableRef);
    const b = entrantForRef(this.catalog.entrants, assignment.b.playableRef);
    const mapping = mapVerdict(request.verdict);
    const vote: MatchupVote = { matchupId: request.matchupId, aEntrantId: a.entrantId, bEntrantId: b.entrantId, verdict: request.verdict, relative: mapping.relative, sentiment: mapping.sentiment, playCounts: { ...counts }, submittedAt: new Date().toISOString() };
    this.votes.set(key, vote);
    return vote;
  }

  async reveal(matchupId: string, participantId = ''): Promise<RevealPayload> {
    const assignment = this.assignments.get(matchupId);
    const vote = participantId ? this.votes.get(participantKey(participantId, matchupId)) : undefined;
    if (!assignment || !vote) throw new Error('Reveal is available only after a vote');
    return { matchupId, a: revealForRef(this.catalog.entrants, assignment.a.playableRef), b: revealForRef(this.catalog.entrants, assignment.b.playableRef), vote };
  }
}

export function createDevelopmentFixtureApi(): FixtureBenchmarkApi {
  return new FixtureBenchmarkApi(createFixtureCatalog('development'), 'development');
}

function participantKey(participantId: string, matchupId: string): string { return `${participantId}::${matchupId}`; }

function entrantForRef(entrants: readonly FixtureEntrant[], ref: string): FixtureEntrant {
  const entrant = entrants.find((candidate) => candidate.playableRef === ref);
  if (!entrant) throw new Error('Unknown playable reference');
  return entrant;
}

function revealForRef(entrants: readonly FixtureEntrant[], ref: string) {
  const entrant = entrantForRef(entrants, ref);
  return { entrantId: entrant.entrantId, playableRef: entrant.playableRef, levelId: entrant.levelId, modelName: entrant.modelName, snapshotLabel: entrant.snapshotLabel, workflowName: entrant.workflowName, generationCost: entrant.generationCost, thumbnailPath: entrant.thumbnailPath, dataClass: entrant.dataClass };
}

export function playableLevelId(ref: string, catalog = createFixtureCatalog('production')): string {
  return entrantForRef(catalog.entrants, ref).levelId;
}

export function fixtureVerdicts(): readonly VoteVerdict[] { return ['a-better', 'b-better', 'both-good', 'both-bad']; }
