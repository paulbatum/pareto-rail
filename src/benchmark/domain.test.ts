/* Runnable with Node's type stripping and kept dependency-free so the domain
 * can be verified without a browser or a test framework. */
// @ts-ignore Node's assert types are intentionally not a production dependency.
import assert from 'node:assert/strict';
import { createDevelopmentFixtureApi, createFixtureCatalog } from './fixtures';
import { CatalogBenchmarkApi, completedMatchupsFromVotes, exposureCountsFromVotes, playCountsFor, revealFromVote } from './catalog-api';
import { compareIds, nextScheduledMatchup, pairId, parsePairId } from './scheduler';
import { mapVerdict, type ComparisonState, type MatchupAssignment, type MatchupVote, type RelativeOutcome, type VoteVerdict } from './types';
import { findCatalogEntrant, findCatalogTheme, rankCatalog, schedulingPool, type RankCatalog, type RankCatalogConfiguration, type RankCatalogEntrant, type RankCatalogTheme, type SchedulingPool } from './catalog';
import { configurationGroupResolver } from './identity';
import { selectPersonalCurveCatalog } from '../app/rank';
import { CustomMatchController } from '../app/match';
import { drawCandidateLevelIds, matchableThemeIds, matchupForModel, modelPickerEntries, modelSlug } from '../app/model-match';
import { parseRoute, routePath } from '../app/router';
import { cardQuery } from '../../middleware';
import { validateRankVoteBody } from '../../server/rank-vote-validation';
import type { RemoteVotePayload } from './remote-recorder';
import { ComparisonStateMachine } from './state';
import { BENCHMARK_PARTICIPANT_ID_KEY, BENCHMARK_STORAGE_VERSION, BenchmarkLocalStore, createMemoryStorage, type StorageEnvelope } from './storage';
import { recomputePersonalCurve, type PersonalHistoryEntry } from './personal-curve';
import { COST_AXIS, OUTPUT_TOKENS_AXIS, layoutCurveChart, ratedCurvePoints } from '../app/components/curve-layout';

declare const process: { argv: string[]; exitCode?: number } | undefined;

type Judged = { matchupId: string; relative: RelativeOutcome; aLevelId?: string };

function assignment(): MatchupAssignment {
  return { matchupId: 'm', theme: { id: 't', title: 'T', summary: 'S', prompt: 'P' }, a: { playableRef: 'a' }, b: { playableRef: 'b' }, assignedAt: 'now' };
}

export async function runBenchmarkDomainTests(): Promise<void> {
  assert.deepEqual(mapVerdict('a-better'), { verdict: 'a-better', relative: 'a' });
  assert.deepEqual(mapVerdict('b-better'), { verdict: 'b-better', relative: 'b' });
  assert.equal(mapVerdict('both-good').sentiment, 'positive');
  assert.equal(mapVerdict('both-bad').sentiment, 'negative');

  testPersonalCurve();
  testIslandPlacement();
  testFeaturedIslandIsMain();
  testConnectionPromotes();
  testSelfHealingSchedule();
  testStorageVersioning();
  testPairIdCanonicalization();
  testStorageUndo();
  testSchedulerCoverage();
  testFeaturedFirstMatchup();
  testFeaturedThemePreference();
  testFeaturedThemeCoverage();
  testNewcomerAnchoring();
  testCoverageSpreadsAcrossThemes();
  testCatchUpScheduling();
  testNewThemeCoverage();
  testEachPairServedOnceThenExhausts();
  testServedSideOrderCanonicalization();
  testParticipantSequencesDiverge();
  testThemeBalance();
  testConvergenceAndStability();
  testNewcomerStaysOffFrontier();
  testSameConfigurationPairs();
  testRetiredEntrantsNotScheduled();
  testSchedulingPoolExcludesRetired();
  testRetiredThemesNeverScheduledButRevealable();
  testHistoricalVoteJudgedNeverReserved();
  testFeaturedOpener();
  await testPoolMatchupServesValidPair();
  testSchedulerIgnoresUnknownHistory();
  testCatalogDerivedHistory();
  testRetiredEntrantReveal();
  testPersonalCurveCatalogExcludesRetired();
  testProviderVariantsShareOnePoint();
  testUnpricedEntrantsRank();
  await testReloadPreservesMatchupAndPlayState();
  await testCatalogChangesRefreshReveals();
  testVoteValidationIsCatalogWide();
  await testApisAndStateMachine();
  testMatchRouteParsing();
  testSocialCardQuery();
  testModelMatchupDraw();
  testCustomMatchController();
  testCustomMatchPlaysPersist();
  testUnrankedThemeVoteIsNotCounted();
  testStoredVoteWithoutSourceReadsAsRanked();
}

/** A tiny catalog: two shared-theme entrants (`lv-a`, `lv-b`) and one in a
 * second theme (`lv-c`), enough to exercise the custom-match controller. */
function customMatchCatalog(): RankCatalog {
  return {
    generatedAt: 'test',
    themes: [
      { id: 'th', title: 'Theme', summary: 'S', prompt: 'P' },
      { id: 'th2', title: 'Theme two', summary: 'S2', prompt: 'P2' },
    ],
    entrants: [
      { levelId: 'lv-a', themeId: 'th', configurationId: 'c1', modelName: 'M1', workflowName: 'solo', generationCost: 1 },
      { levelId: 'lv-b', themeId: 'th', configurationId: 'c2', modelName: 'M2', workflowName: 'solo', generationCost: 2 },
      { levelId: 'lv-c', themeId: 'th2', configurationId: 'c3', modelName: 'M3', workflowName: 'solo', generationCost: 3 },
    ],
  };
}

function testCustomMatchPlaysPersist(): void {
  const catalog = customMatchCatalog();
  const storage = createMemoryStorage();
  // Match plays share the normal benchmark envelope (default key), so a fresh
  // store over the same storage reads what the match wrote.
  const store = () => new BenchmarkLocalStore(storage);
  const posted: RemoteVotePayload[] = [];
  const outbox = { record: (payload: RemoteVotePayload) => { posted.push(payload); } };
  const playAndVote = (controller: CustomMatchController, verdict: VoteVerdict, scoreA: number, scoreB: number) => {
    controller.launch('a');
    controller.completeRun('a', scoreA);
    controller.launch('b');
    controller.completeRun('b', scoreB);
    controller.submit(verdict);
  };

  const first = new CustomMatchController('lv-a', 'lv-b', catalog, store(), outbox);
  playAndVote(first, 'a-better', 100, 250);

  // Plays go to the shared levelRuns and the verdict to the shared history,
  // tagged with the flow it came from.
  const persisted = store().snapshot;
  assert.equal(persisted.levelRuns.find((run) => run.levelId === 'lv-a')?.score, 100);
  assert.equal(persisted.levelRuns.find((run) => run.levelId === 'lv-b')?.score, 250);
  assert.equal(persisted.history.length, 1);
  assert.equal(persisted.history[0]!.matchupId, pairId('th', 'lv-a', 'lv-b'));
  assert.equal(persisted.history[0]!.source, 'custom');

  assert.equal(posted.length, 1, 'the custom verdict was not posted to the vote API');
  assert.equal(posted[0]!.source, 'custom');
  assert.equal(posted[0]!.themeId, 'th');
  assert.equal(posted[0]!.matchupId, pairId('th', 'lv-a', 'lv-b'));
  assert.deepEqual(posted[0]!.bestScores, { a: 100, b: 250 });
  assert.ok(posted[0]!.idempotencyKey?.includes(persisted.history[0]!.submittedAt), 'the idempotency key does not name this submission');

  // A fresh controller for the same pair resumes at ready-to-vote from the shared runs.
  const resumed = new CustomMatchController('lv-a', 'lv-b', catalog, store(), outbox);
  const resumedState: ComparisonState | null = resumed.state;
  assert.equal(resumedState?.kind, 'ready-to-vote');
  assert.equal(resumed.bestScore('lv-b'), 250);

  // The same pair judged again keeps one vote: the newer verdict replaces the older.
  playAndVote(resumed, 'b-better', 110, 260);
  const afterRepeat = store().snapshot;
  assert.equal(afterRepeat.history.length, 1, 'a repeat match left two votes on one matchup');
  assert.equal(afterRepeat.history[0]!.verdict, 'b-better');
  assert.equal(posted.length, 2, 'the repeat verdict was not posted');
  assert.notEqual(posted[1]!.idempotencyKey, posted[0]!.idempotencyKey, 'the repeat reused the first submission key');

  // A cross-theme pair has no matchup id to record under, so its verdict is not stored.
  const cross = new CustomMatchController('lv-a', 'lv-c', catalog, store(), outbox);
  playAndVote(cross, 'a-better', 120, 130);
  assert.equal(store().snapshot.history.length, 1, 'a cross-theme verdict was stored');
  assert.equal(posted.length, 2, 'a cross-theme verdict was posted');
}

/** A vote on a theme that is not admitted to ranking is stored, and left out of
 * every curve fitted from local history. */
function testUnrankedThemeVoteIsNotCounted(): void {
  const catalog = customMatchCatalog();
  const experimental: RankCatalog = {
    ...catalog,
    themes: catalog.themes.map((theme) => (theme.id === 'th' ? { ...theme, experimental: true } : theme)),
  };
  const storage = createMemoryStorage();
  const store = () => new BenchmarkLocalStore(storage);
  const posted: RemoteVotePayload[] = [];

  const controller = new CustomMatchController('lv-a', 'lv-b', experimental, store(), { record: (payload) => { posted.push(payload); } });
  assert.equal(controller.recordsVotes, true);
  assert.equal(controller.themeIsUnranked, true);
  controller.launch('a');
  controller.completeRun('a', 100);
  controller.launch('b');
  controller.completeRun('b', 250);
  controller.submit('a-better');

  const history = store().snapshot.history;
  assert.equal(history.length, 1, 'the vote was not stored');
  assert.equal(posted.length, 1, 'the vote was not posted');
  assert.equal(completedMatchupsFromVotes(experimental, history).length, 0, 'an unranked-theme vote reached the personal curve');
}

/** Votes stored before custom matches were recorded carry no source. */
function testStoredVoteWithoutSourceReadsAsRanked(): void {
  const storage = createMemoryStorage();
  const legacy = { matchupId: 'th:lv-a__lv-b', aEntrantId: 'lv-a', bEntrantId: 'lv-b', verdict: 'a-better', relative: 'a', playCounts: { a: 1, b: 1 }, submittedAt: 'then' };
  storage.setItem('legacy-source', JSON.stringify({ version: BENCHMARK_STORAGE_VERSION, data: { participantId: 'p', history: [legacy], levelRuns: [] } }));
  const store = new BenchmarkLocalStore(storage, 'legacy-source');
  assert.equal(store.snapshot.history[0]!.source, 'rank');
}

function testMatchRouteParsing(): void {
  const parse = (search: string) => parseRoute({ pathname: '/match', search } as Location);
  assert.deepEqual(parse('?a=lv-x&b=lv-y'), { kind: 'match', a: 'lv-x', b: 'lv-y', model: undefined, vs: undefined, playSide: undefined });
  assert.deepEqual(parse('?a=lv-x&b=lv-y&play=b'), { kind: 'match', a: 'lv-x', b: 'lv-y', model: undefined, vs: undefined, playSide: 'b' });
  // `model` names one side and leaves the pair to the page's draw.
  assert.deepEqual(parse('?model=ox-alpha'), { kind: 'match', a: undefined, b: undefined, model: 'ox-alpha', vs: undefined, playSide: undefined });
  // `vs` names the other side, leaving the theme and the two levels to the draw.
  assert.deepEqual(parse('?model=ox-alpha&vs=other-model'), { kind: 'match', a: undefined, b: undefined, model: 'ox-alpha', vs: 'other-model', playSide: undefined });
  // `play` is only honoured for the two sides; anything else is dropped.
  const droppedPlay = parse('?a=lv-x&b=lv-y&play=c');
  assert.equal(droppedPlay.kind === 'match' ? droppedPlay.playSide : 'unreachable', undefined);
  // Missing params still resolve to the match route so the page can explain the shape.
  assert.deepEqual(parse(''), { kind: 'match', a: undefined, b: undefined, model: undefined, vs: undefined, playSide: undefined });
  assert.equal(routePath({ kind: 'match', a: 'lv-x', b: 'lv-y' }), '/match');
}

/** Which match links the edge middleware gives a social card, and the query it
 * builds. Both link shapes get one; anything else falls through to the site's
 * default card. */
function testSocialCardQuery(): void {
  const query = (search: string) => cardQuery(new URLSearchParams(search));
  assert.equal(query('a=lv-x&b=lv-y'), 'a=lv-x&b=lv-y');
  // Extra parameters ride along on a shared link without changing the card.
  assert.equal(query('a=lv-x&b=lv-y&play=a'), 'a=lv-x&b=lv-y');
  assert.equal(query('model=ox-alpha'), 'model=ox-alpha');
  assert.equal(query('model=ox-alpha&vs=ox-beta'), 'model=ox-alpha&vs=ox-beta');
  // Half a pair, a malformed id, and a bare /match name no card.
  assert.equal(query('a=lv-x'), null);
  assert.equal(query('a=LV-X&b=lv-y'), null);
  assert.equal(query(''), null);
  // A malformed opponent names no model, so the page refuses the link too.
  assert.equal(query('model=ox-alpha&vs=Ox Beta'), null);
}

function testModelMatchupDraw(): void {
  assert.equal(modelSlug('GPT-5.6 Sol'), 'gpt-5-6-sol');
  assert.equal(modelSlug('Ox Alpha'), 'ox-alpha');

  const entrant = (levelId: string, themeId: string, modelName: string): RankCatalogEntrant =>
    ({ levelId, themeId, configurationId: `${modelSlug(modelName)}-solo`, modelName, workflowName: 'solo', generationCost: 1 });
  const catalog: RankCatalog = {
    generatedAt: 'test',
    themes: [{ id: 'th-a', title: 'A', summary: 'S', prompt: 'P' }, { id: 'th-b', title: 'B', summary: 'S', prompt: 'P' }],
    entrants: [
      entrant('lv-mine-a', 'th-a', 'Ox Alpha'),
      entrant('lv-theirs-a', 'th-a', 'Other Model'),
      // th-b holds the model alone, so it can never be drawn.
      entrant('lv-mine-b', 'th-b', 'Ox Alpha'),
      entrant('lv-unplayable', 'th-b', 'Other Model'),
    ],
  };
  const playable = new Set(['lv-mine-a', 'lv-theirs-a', 'lv-mine-b']);
  const draw = (random: () => number) => matchupForModel('ox-alpha', { catalog, playable, random });

  // The only theme holding both is th-a, and the last draw decides the sides.
  assert.deepEqual(draw(() => 0), { a: 'lv-mine-a', b: 'lv-theirs-a' });
  assert.deepEqual(draw(() => 0.9), { a: 'lv-theirs-a', b: 'lv-mine-a' });
  assert.equal(matchupForModel('no-such-model', { catalog, playable, random: () => 0 }), null);
  // With the opponent unplayable, th-b has nothing to offer either.
  assert.equal(matchupForModel('ox-alpha', { catalog, playable: new Set(['lv-mine-b']), random: () => 0 }), null);

  testNamedOpponentDraw();
}

/** `&vs=<slug>` pins the other side of the draw. */
function testNamedOpponentDraw(): void {
  const entrant = (levelId: string, themeId: string, modelName: string): RankCatalogEntrant =>
    ({ levelId, themeId, configurationId: `${modelSlug(modelName)}-solo`, modelName, workflowName: 'solo', generationCost: 1 });
  const catalog: RankCatalog = {
    generatedAt: 'test',
    themes: [{ id: 'th-a', title: 'A', summary: 'S', prompt: 'P' }, { id: 'th-b', title: 'B', summary: 'S', prompt: 'P' }],
    entrants: [
      entrant('lv-alpha-a', 'th-a', 'Ox Alpha'),
      entrant('lv-beta-a', 'th-a', 'Ox Beta'),
      entrant('lv-gamma-a', 'th-a', 'Ox Gamma'),
      // th-b holds Alpha and Gamma but no Beta.
      entrant('lv-alpha-b', 'th-b', 'Ox Alpha'),
      entrant('lv-alpha-b2', 'th-b', 'Ox Alpha'),
      entrant('lv-gamma-b', 'th-b', 'Ox Gamma'),
    ],
  };
  const playable = new Set(catalog.entrants.map((item) => item.levelId));
  const versus = (opponent: string, random: () => number) => matchupForModel('ox-alpha', { catalog, playable, opponent, random });

  // th-a is the only theme holding both, so Gamma never enters the draw.
  assert.deepEqual(versus('ox-beta', () => 0), { a: 'lv-alpha-a', b: 'lv-beta-a' });
  assert.deepEqual(versus('ox-beta', () => 0.9), { a: 'lv-beta-a', b: 'lv-alpha-a' });
  // An unknown opponent slug leaves no theme to draw from.
  assert.equal(versus('no-such-model', () => 0), null);
  // Both slugs naming one model draws two of its own levels, which only th-b has.
  assert.deepEqual(versus('ox-alpha', () => 0), { a: 'lv-alpha-b', b: 'lv-alpha-b2' });

  // The themes a draw can use, which the model builder reads to block a pair it
  // could not resolve.
  assert.deepEqual(matchableThemeIds('ox-alpha', { catalog, playable, opponent: 'ox-beta' }), ['th-a']);
  assert.deepEqual(matchableThemeIds('ox-alpha', { catalog, playable, opponent: 'ox-gamma' }), ['th-a', 'th-b']);
  assert.deepEqual(matchableThemeIds('ox-alpha', { catalog, playable, opponent: 'ox-alpha' }), ['th-b']);
  assert.deepEqual(matchableThemeIds('ox-beta', { catalog, playable, opponent: 'ox-gamma' }), ['th-a']);
  assert.deepEqual(matchableThemeIds('ox-beta', { catalog, playable: new Set(['lv-beta-a']) }), []);

  // The builder's model list counts playable levels only.
  assert.deepEqual(modelPickerEntries(playable, catalog), [
    { slug: 'ox-alpha', modelName: 'Ox Alpha', levelCount: 3, themeCount: 2 },
    { slug: 'ox-beta', modelName: 'Ox Beta', levelCount: 1, themeCount: 1 },
    { slug: 'ox-gamma', modelName: 'Ox Gamma', levelCount: 2, themeCount: 2 },
  ]);
  assert.deepEqual(modelPickerEntries(new Set(['lv-beta-a']), catalog), [
    { slug: 'ox-beta', modelName: 'Ox Beta', levelCount: 1, themeCount: 1 },
  ]);

  // The social card's pool, ordered one level per theme before a second from
  // any: th-a holds two candidates and th-b three, so the first four the card
  // takes span both themes and both models.
  assert.deepEqual(drawCandidateLevelIds('ox-alpha', { catalog, playable, opponent: 'ox-gamma' }),
    ['lv-alpha-a', 'lv-alpha-b', 'lv-gamma-a', 'lv-alpha-b2', 'lv-gamma-b']);
  // One theme, one level each: the pool admits a single matchup, which the card
  // renders as the pair composite rather than a grid.
  assert.deepEqual(drawCandidateLevelIds('ox-alpha', { catalog, playable, opponent: 'ox-beta' }), ['lv-alpha-a', 'lv-beta-a']);
  // Without an opponent the pool is the model's levels and everyone else's.
  assert.deepEqual(drawCandidateLevelIds('ox-beta', { catalog, playable }), ['lv-alpha-a', 'lv-beta-a', 'lv-gamma-a']);
  assert.deepEqual(drawCandidateLevelIds('no-such-model', { catalog, playable }), []);
}

function testCustomMatchController(): void {
  const catalog = customMatchCatalog();
  // Its own store and a stub outbox, so this case neither shares history with
  // another case nor reaches for the network.
  const isolated = () => new BenchmarkLocalStore(createMemoryStorage());
  const outbox = { record: () => {} };

  assert.deepEqual(new CustomMatchController(undefined, 'lv-a', catalog).error, { kind: 'missing' });
  assert.deepEqual(new CustomMatchController('lv-a', 'lv-a', catalog).error, { kind: 'same', id: 'lv-a' });
  assert.deepEqual(new CustomMatchController('lv-a', 'nope', catalog).error, { kind: 'unknown', ids: ['nope'] });

  const shared = new CustomMatchController('lv-a', 'lv-b', catalog, isolated(), outbox);
  assert.equal(shared.valid, true);
  assert.equal(shared.sharedTheme?.id, 'th');
  assert.equal(shared.assignment?.theme.id, 'th');
  // A same-theme pair carries the canonical matchup id, so this vote lands on the
  // matchup a ranked comparison of the same pair would.
  assert.equal(shared.assignment?.matchupId, pairId('th', 'lv-a', 'lv-b'));
  assert.equal(shared.recordsVotes, true);

  // A full match runs entirely in memory: play both, vote, reveal.
  shared.launch('a');
  shared.completeRun('a', 100);
  shared.launch('b');
  shared.completeRun('b', 250);
  const readyState: ComparisonState | null = shared.state;
  assert.equal(readyState?.kind, 'ready-to-vote');
  assert.equal(shared.bestScore('lv-a'), 100);
  shared.submit('a-better');
  const revealState: ComparisonState | null = shared.state;
  assert.ok(revealState && revealState.kind === 'reveal');
  assert.equal(revealState.reveal.vote.verdict, 'a-better');
  assert.equal(revealState.reveal.a.levelId, 'lv-a');
  assert.equal(revealState.reveal.b.generationCost, 2);

  // Cross-theme falls back to the synthetic placeholder but keeps each side's real theme available.
  const cross = new CustomMatchController('lv-a', 'lv-c', catalog, isolated(), outbox);
  assert.equal(cross.valid, true);
  assert.equal(cross.sharedTheme, null);
  assert.equal(cross.assignment?.theme.id, 'custom');
  assert.equal(cross.themeForSide('a')?.id, 'th');
  assert.equal(cross.themeForSide('b')?.id, 'th2');
  assert.equal(cross.recordsVotes, false);
}

function testPersonalCurve(): void {
  const votes: PersonalHistoryEntry[] = [
    historyEntry('m1', 'a', 'b', 'a'),
    historyEntry('m2', 'a', 'c', 'b'),
    historyEntry('m3', 'b', 'c', 'a'),
    historyEntry('m4', 'a', 'b', 'tie'),
    historyEntry('m5', 'a', 'c', 'a'),
  ];
  const forward = recomputePersonalCurve(votes);
  const reverse = recomputePersonalCurve([...votes].reverse());
  assert.deepEqual(
    forward.points.map((point) => [point.configurationId, point.rating]),
    reverse.points.map((point) => [point.configurationId, point.rating]),
    'Bradley-Terry ratings are independent of vote order',
  );

  const undefeated = recomputePersonalCurve([historyEntry('win', 'winner', 'loser', 'a')]);
  assert.ok(Number.isFinite(undefeated.points.find((point) => point.configurationId === 'winner')?.rating));
  assert.ok((undefeated.points.find((point) => point.configurationId === 'winner')?.rating ?? 0) > (undefeated.points.find((point) => point.configurationId === 'loser')?.rating ?? 0));

  const tieGoodEntry = historyEntry('tie-good', 'a', 'b', 'tie');
  const tieBadEntry = { ...tieGoodEntry, vote: { ...tieGoodEntry.vote, matchupId: 'tie-bad', verdict: 'both-bad' as const, sentiment: 'negative' as const } };
  const tieGood = recomputePersonalCurve([tieGoodEntry]);
  const tieBad = recomputePersonalCurve([tieBadEntry]);
  assert.deepEqual(tieGood.points.map((point) => point.rating), tieBad.points.map((point) => point.rating), 'both-good and both-bad use the same ordinal tie result');

  const catalog = makeSchedulerCatalog(3, 1);
  const withUnseen = recomputePersonalCurve([historyEntry('seen', 'configuration-0', 'configuration-1', 'a')], { catalog: catalog.entrants });
  assert.equal(withUnseen.points.length, 3);
  assert.equal(withUnseen.points.find((point) => point.configurationId === 'configuration-2')?.rating, undefined);
  assert.equal(withUnseen.points.find((point) => point.configurationId === 'configuration-2')?.status, 'pending');
  assert.equal(withUnseen.points.find((point) => point.configurationId === 'configuration-0')?.wins, 1);
  assert.equal(withUnseen.points.find((point) => point.configurationId === 'configuration-1')?.losses, 1);
}

function testIslandPlacement(): void {
  const catalog = makeSchedulerCatalog(4, 2, false, [0, 1]);
  // Enough comparisons that the count bar is cleared by everyone, isolating
  // connectivity as the only reason a configuration can go unranked.
  const curve = recomputePersonalCurve(repeatHistory(coldStartHistory(), 3), { catalog: catalog.entrants });
  assert.equal(curve.establishedCount, 2);
  assert.equal(curve.points.find((point) => point.configurationId === 'configuration-0')?.status, 'established');
  assert.equal(curve.points.find((point) => point.configurationId === 'configuration-2')?.status, 'provisional', 'an island never compared against the main body cannot be ranked against it');
  assert.equal(curve.points.find((point) => point.configurationId === 'configuration-3')?.status, 'provisional');
  assert.ok(curve.points.filter((point) => point.frontier).every((point) => point.status === 'established'), 'the frontier is drawn through ranked configurations only');
}

function testFeaturedIslandIsMain(): void {
  // The featured island wins the tie even when the other island holds the
  // lexicographically smallest configuration id.
  const catalog = makeSchedulerCatalog(4, 2, false, [2, 3]);
  const curve = recomputePersonalCurve(repeatHistory([
    historyEntry('theme-a-featured', 'configuration-2', 'configuration-3', 'a'),
    historyEntry('theme-b-featured', 'configuration-2', 'configuration-3', 'a'),
    historyEntry('theme-a-other', 'configuration-0', 'configuration-1', 'a'),
    historyEntry('theme-b-other', 'configuration-0', 'configuration-1', 'a'),
  ], 3), { catalog: catalog.entrants });
  assert.equal(curve.points.find((point) => point.configurationId === 'configuration-2')?.status, 'established', 'the featured island is the main body');
  assert.equal(curve.points.find((point) => point.configurationId === 'configuration-0')?.status, 'provisional', 'the unfeatured island stays unranked');
  assert.equal(curve.points.find((point) => point.configurationId === 'configuration-1')?.status, 'provisional', 'the unfeatured island stays unranked');
}

function testConnectionPromotes(): void {
  const catalog = makeSchedulerCatalog(4, 2, false, [0, 1]);
  const curve = recomputePersonalCurve([
    ...repeatHistory(coldStartHistory(), 3),
    historyEntry('cross-island', 'configuration-1', 'configuration-2', 'a'),
  ], { catalog: catalog.entrants });
  assert.equal(curve.establishedCount, 4);
  assert.equal(curve.points.find((point) => point.configurationId === 'configuration-2')?.status, 'established');
  assert.equal(curve.points.find((point) => point.configurationId === 'configuration-3')?.status, 'established');
}

function testSelfHealingSchedule(): void {
  const catalog = makeSchedulerCatalog(4, 2, false, [0, 1]);
  // Two comparison islands: {0,1} and {2,3} judged within themselves in both themes.
  const judged: Judged[] = [
    { matchupId: pairId('theme-a', 'theme-a-0', 'theme-a-1'), relative: 'a', aLevelId: 'theme-a-0' },
    { matchupId: pairId('theme-b', 'theme-b-0', 'theme-b-1'), relative: 'a', aLevelId: 'theme-b-0' },
    { matchupId: pairId('theme-a', 'theme-a-2', 'theme-a-3'), relative: 'a', aLevelId: 'theme-a-2' },
    { matchupId: pairId('theme-b', 'theme-b-2', 'theme-b-3'), relative: 'a', aLevelId: 'theme-b-2' },
  ];
  const next = scheduleOne(catalog, judged, {}, []);
  assert.ok(next);
  const configurationIds = [next!.levelIdA, next!.levelIdB].map((levelId) => catalog.entrants.find((entrant) => entrant.levelId === levelId)!.configurationId);
  const solo = new Set(['configuration-0', 'configuration-1']);
  const delegated = new Set(['configuration-2', 'configuration-3']);
  assert.equal(
    (solo.has(configurationIds[0]!) && delegated.has(configurationIds[1]!))
      || (solo.has(configurationIds[1]!) && delegated.has(configurationIds[0]!)),
    true,
    'playoff reconnects the solo and delegated comparison islands',
  );
}

/** Replay a history several times over, so configurations clear the relative
 * comparison bar without changing the shape of the comparison graph. */
function repeatHistory(entries: readonly PersonalHistoryEntry[], times: number): PersonalHistoryEntry[] {
  return Array.from({ length: times }, (_, round) => entries.map((entry) => ({
    ...entry,
    vote: { ...entry.vote, matchupId: `${entry.vote.matchupId}-${round}` },
  }))).flat();
}

function coldStartHistory(): PersonalHistoryEntry[] {
  return [
    historyEntry('theme-a-featured', 'configuration-0', 'configuration-1', 'a'),
    historyEntry('theme-b-featured', 'configuration-0', 'configuration-1', 'a'),
    historyEntry('theme-a-delegated', 'configuration-2', 'configuration-3', 'a'),
    historyEntry('theme-b-delegated', 'configuration-2', 'configuration-3', 'a'),
  ];
}

function testStorageVersioning(): void {
  assert.equal(BENCHMARK_STORAGE_VERSION, 3);
  const storage = createMemoryStorage();
  storage.setItem('legacy', JSON.stringify({ participantId: 'old', completedMatchups: [], history: [], themeHistory: [], revealedEntrants: [] }));
  assert.notEqual(new BenchmarkLocalStore(storage, 'legacy').participantId, 'old', 'unversioned data is discarded');
  storage.removeItem?.(BENCHMARK_PARTICIPANT_ID_KEY);
  storage.setItem('old-envelope', JSON.stringify({ version: 2, data: { participantId: 'old', completedMatchups: [], history: [], themeHistory: [], revealedEntrants: [] } }));
  const salvaged = new BenchmarkLocalStore(storage, 'old-envelope');
  assert.equal(salvaged.participantId, 'old', 'stale envelopes preserve the participant id');
  assert.equal(storage.getItem(BENCHMARK_PARTICIPANT_ID_KEY), 'old', 'stale envelope participant id is persisted separately');
  storage.setItem('old-kind', JSON.stringify({ version: 2, data: { participantId: 'old', unfinishedMatchup: { kind: 'a-complete', assignment: assignment(), playCounts: { a: 1, b: 0 } }, completedMatchups: [], history: [], themeHistory: [], levelExposureCounts: {}, revealedEntrants: [] } }));
  assert.deepEqual(new BenchmarkLocalStore(storage, 'old-kind').snapshot.history, []);

  const dedicatedWinsStorage = createMemoryStorage();
  dedicatedWinsStorage.setItem('dedicated-wins', JSON.stringify({ version: 2, data: { participantId: 'envelope-participant', completedMatchups: [], history: [], themeHistory: [], revealedEntrants: [] } }));
  dedicatedWinsStorage.setItem(BENCHMARK_PARTICIPANT_ID_KEY, 'dedicated-participant');
  assert.equal(new BenchmarkLocalStore(dedicatedWinsStorage, 'dedicated-wins').participantId, 'dedicated-participant', 'dedicated participant id wins over the envelope');

  const freshStorage = createMemoryStorage();
  const fresh = new BenchmarkLocalStore(freshStorage, 'fresh');
  assert.ok(fresh.participantId);
  assert.equal(freshStorage.getItem(BENCHMARK_PARTICIPANT_ID_KEY), fresh.participantId, 'a fresh participant id is persisted separately');
  assert.equal(new BenchmarkLocalStore(freshStorage, 'fresh').participantId, fresh.participantId);

  const currentStorage = createMemoryStorage();
  const current = new BenchmarkLocalStore(currentStorage, 'current');
  current.save({ participantId: 'current-participant' });
  const envelope = JSON.parse(currentStorage.getItem('current')!) as StorageEnvelope;
  assert.equal(envelope.version, 3);
  assert.deepEqual(Object.keys(envelope.data).sort(), ['history', 'levelRuns', 'participantId']);
  assert.equal(currentStorage.getItem(BENCHMARK_PARTICIPANT_ID_KEY), 'current-participant');
  assert.equal(new BenchmarkLocalStore(currentStorage, 'current').participantId, 'current-participant');
}

function testPairIdCanonicalization(): void {
  for (const theme of rankCatalog.themes) {
    const entrants = rankCatalog.entrants.filter((entrant) => entrant.themeId === theme.id);
    for (let firstIndex = 0; firstIndex < entrants.length; firstIndex += 1) {
      for (let secondIndex = firstIndex + 1; secondIndex < entrants.length; secondIndex += 1) {
        const first = entrants[firstIndex]!.levelId;
        const second = entrants[secondIndex]!.levelId;
        const localeOrdered = [first, second].sort((left, right) => left.localeCompare(right));
        assert.equal(compareIds(first, second), Math.sign(first.localeCompare(second)), `${first} and ${second} changed ordering`);
        assert.equal(pairId(theme.id, first, second), `${theme.id}:${localeOrdered[0]}__${localeOrdered[1]}`, `${theme.id} pair id changed`);
      }
    }
  }
}

function testStorageUndo(): void {
  const store = new BenchmarkLocalStore(createMemoryStorage(), 'undo');
  const vote: MatchupVote = { matchupId: 'm', aEntrantId: 'a', bEntrantId: 'b', verdict: 'a-better', relative: 'a', playCounts: { a: 2, b: 1 }, submittedAt: 'now', source: 'rank' };
  store.save({ history: [vote] });
  const undone = store.undoLastVerdict();
  assert.equal(undone?.verdict, 'a-better');
  assert.equal(store.snapshot.history.length, 0);
}

function testSchedulerCoverage(): void {
  const catalog = makeSchedulerCatalog(4, 2);
  const { judged, exposures, themes, assignments } = simulateAssignments(catalog, 4);
  assert.equal(assignments.length, 4);
  assert.equal(new Set(assignments.flatMap((matchup) => [matchup.levelIdA, matchup.levelIdB])).size, 8, 'cold start covers every level');
  const firstByTheme = new Map<string, { themeId: string; levelIdA: string; levelIdB: string }>();
  for (const matchup of assignments) if (!firstByTheme.has(matchup.themeId)) firstByTheme.set(matchup.themeId, matchup);
  const openerPairs = [...firstByTheme.values()].map((matchup) => configurationPairFromMatchup(catalog, pairId(matchup.themeId, matchup.levelIdA, matchup.levelIdB)));
  assert.equal(new Set(openerPairs).size, catalog.themes.length, 'theme openers spread across distinct configuration pairs');
  const curve = curveFromJudged(catalog, judged);
  assert.equal(curve.points.filter((point) => point.comparisons > 0).length, 4, 'the four-vote cold-start graph reaches every configuration');
  assert.ok(Object.values(exposures).every((count) => count === 1));
}

function testFeaturedFirstMatchup(): void {
  const catalog = makeSchedulerCatalog(4, 3, false, [0, 1]);
  const isFeaturedPair = (matchup: { levelIdA: string; levelIdB: string }) =>
    [matchup.levelIdA, matchup.levelIdB].every((levelId) => catalog.entrants.find((entrant) => entrant.levelId === levelId)!.featured === true);
  const openerThemes = new Set<string>();
  for (const participantId of ['participant-a', 'participant-b', 'participant-c', 'participant-d', 'participant-e', 'participant-f']) {
    const { assignments } = simulateAssignments(catalog, 6, participantId);
    assert.equal(isFeaturedPair(assignments[0]!), true, `${participantId} did not open on the featured pairing`);
    openerThemes.add(assignments[0]!.themeId);
    const firstByTheme = new Map<string, { levelIdA: string; levelIdB: string }>();
    for (const matchup of assignments) if (!firstByTheme.has(matchup.themeId)) firstByTheme.set(matchup.themeId, matchup);
    assert.equal(firstByTheme.size, catalog.themes.length);
    const featuredOpeners = [...firstByTheme.values()].filter(isFeaturedPair).length;
    assert.equal(featuredOpeners, 1, 'the featured pairing opens one theme only, not every theme');
  }
  assert.ok(openerThemes.size > 1, 'the featured opener theme varies across participants');
}

function testFeaturedThemePreference(): void {
  const base = makeSchedulerCatalog(4, 3, false, [0, 1]);
  const featured: SchedulingPool = { ...base, themes: base.themes.map((theme) => theme.id === 'theme-b' ? { ...theme, featured: true } : theme) };
  for (let index = 0; index < 20; index += 1) {
    const opener = nextScheduledMatchup(featured, `featured-theme-${index}`, { judged: [] });
    assert.equal(opener?.themeId, 'theme-b', 'the opener comes from the featured theme');
  }
  // A featured theme that holds no featured pairing does not hold the opener
  // back: the featured configurations outrank the theme preference.
  const withoutPair: SchedulingPool = { ...featured, entrants: base.entrants.filter((entrant) => !(entrant.themeId === 'theme-b' && entrant.featured === true)) };
  for (let index = 0; index < 20; index += 1) {
    const opener = nextScheduledMatchup(withoutPair, `unfeatured-theme-${index}`, { judged: [] });
    assert.notEqual(opener?.themeId, 'theme-b');
    const entrants = [opener!.levelIdA, opener!.levelIdB].map((levelId) => withoutPair.entrants.find((entrant) => entrant.levelId === levelId)!);
    assert.equal(entrants.every((entrant) => entrant.featured === true), true, 'the opener is still a featured pairing');
  }
}

function testFeaturedThemeCoverage(): void {
  const catalog = makeSchedulerCatalog(4, 1, false, [0, 1]);
  const simulated = simulateAssignments(catalog, 3);
  assert.equal(simulated.assignments[0]?.themeId, 'theme-a');
  assert.ok(simulated.exposures['theme-a-0'] > 0);
  assert.ok(simulated.exposures['theme-a-1'] > 0);
  assert.ok(simulated.exposures['theme-a-2'] > 0);
  assert.ok(simulated.exposures['theme-a-3'] > 0, 'coverage continues after the featured opener');
}

function testNewcomerAnchoring(): void {
  const established = makeSchedulerCatalog(4, 2);
  const simulated = simulateAssignments(established, 4);
  const catalog = makeSchedulerCatalog(6, 2);
  const history = [...simulated.judged];
  const exposures = { ...simulated.exposures };
  const themeHistory = [...simulated.themes];
  const newcomerLevels = new Set(catalog.entrants.filter((entrant) => entrant.configurationId === 'configuration-4' || entrant.configurationId === 'configuration-5').map((entrant) => entrant.levelId));
  const establishedPlaced = new Set(curveFromJudged(catalog, history).points.filter((point) => point.status !== 'pending').map((point) => point.configurationId));
  const debutSeen = new Set<string>();
  let guard = 0;
  while (debutSeen.size < newcomerLevels.size && guard++ < 20) {
    const next = scheduleOne(catalog, history, exposures, themeHistory);
    assert.ok(next);
    const sides = [next!.levelIdA, next!.levelIdB];
    const unseen = sides.filter((levelId) => (exposures[levelId] ?? 0) === 0);
    assert.equal(unseen.length, 1, 'newcomer coverage is anchored to a seen level');
    assert.ok(newcomerLevels.has(unseen[0]!));
    debutSeen.add(unseen[0]!);
    appendJudgment(catalog, next!, history, exposures, themeHistory);
  }
  assert.equal(debutSeen.size, newcomerLevels.size);

  const newcomerVotes = new Map<string, number>();
  while ([...newcomerVotes.values()].some((count) => count < 2) || newcomerVotes.size < 2) {
    const next = scheduleOne(catalog, history, exposures, themeHistory);
    assert.ok(next);
    const configIds = [next!.levelIdA, next!.levelIdB].map((levelId) => catalog.entrants.find((entrant) => entrant.levelId === levelId)!.configurationId);
    for (const configurationId of configIds) if (configurationId === 'configuration-4' || configurationId === 'configuration-5') newcomerVotes.set(configurationId, (newcomerVotes.get(configurationId) ?? 0) + 1);
    appendJudgment(catalog, next!, history, exposures, themeHistory);
    if (history.length > 80) throw new Error('newcomer simulation did not converge');
  }
  const curve = curveFromJudged(catalog, history);
  assert.equal(curve.points.find((point) => point.configurationId === 'configuration-4')?.status === 'pending', false);
  assert.equal(curve.points.find((point) => point.configurationId === 'configuration-5')?.status === 'pending', false);
  for (const configurationId of establishedPlaced) assert.notEqual(curve.points.find((point) => point.configurationId === configurationId)?.status, 'pending');
}

function testCoverageSpreadsAcrossThemes(): void {
  // Theme demand is capped at the two unseen levels a wholly fresh pairing
  // needs, so a large theme cannot outrank a small one on entrant count alone.
  // Without the cap the eight-entrant theme wins every opening comparison and
  // the configurations that appear only in the small theme are never compared.
  const uneven = unevenThemePool();
  const openings = new Map<string, number>();
  const smallOnly = new Set(['configuration-8', 'configuration-9']);
  const smallOnlySeen = new Set<string>();
  for (let index = 0; index < 24; index += 1) {
    const first = nextScheduledMatchup(uneven, `participant-${index}`, {});
    assert.ok(first);
    openings.set(first!.themeId, (openings.get(first!.themeId) ?? 0) + 1);
    for (const levelId of [first!.levelIdA, first!.levelIdB]) {
      const configurationId = uneven.entrants.find((entrant) => entrant.levelId === levelId)!.configurationId;
      if (smallOnly.has(configurationId)) smallOnlySeen.add(configurationId);
    }
  }
  assert.deepEqual([...openings.keys()].sort(), ['theme-big', 'theme-small'], 'opening comparisons reach the small theme, not only the largest');
  assert.deepEqual([...smallOnlySeen].sort(), ['configuration-8', 'configuration-9'], 'configurations that appear only in a small theme get compared');

  // Equal claims are ordered per participant, so visitors in the same position
  // do not all open in whichever theme sorts first by id.
  const even = makeSchedulerCatalog(4, 3);
  const evenOpenings = new Set(Array.from({ length: 24 }, (_, index) => nextScheduledMatchup(even, `participant-${index}`, {})!.themeId));
  assert.equal(evenOpenings.size, even.themes.length, 'equally sized themes all host some opening comparison');
}

function unevenThemePool(): SchedulingPool {
  const entrant = (themeId: string, index: number): RankCatalogEntrant => ({
    levelId: `${themeId}-${index}`,
    themeId,
    configurationId: `configuration-${index}`,
    modelName: `Model ${index}`,
    workflowName: 'solo',
    generationCost: index + 1,
  });
  return {
    themes: ['theme-big', 'theme-small'].map((id) => ({ id, title: id, summary: 'S', prompt: 'P' })),
    entrants: [
      ...Array.from({ length: 8 }, (_, index) => entrant('theme-big', index)),
      ...Array.from({ length: 2 }, (_, index) => entrant('theme-small', 8 + index)),
    ],
  };
}

function testCatchUpScheduling(): void {
  // A configuration added to an already-judged catalog starts far behind the
  // field. Once coverage has shown its levels once, the playoff phase has to
  // keep steering comparisons at it until its rating counts, rather than
  // spreading them evenly and leaving it permanently unranked.
  const established = makeSchedulerCatalog(4, 3);
  const simulated = simulateAssignments(established, 18);
  const catalog = makeSchedulerCatalog(6, 3);
  const history = [...simulated.judged];
  const exposures = { ...simulated.exposures };
  const themeHistory = [...simulated.themes];
  const newcomers = ['configuration-4', 'configuration-5'];
  assert.ok(curveFromJudged(catalog, history).points.filter((point) => newcomers.includes(point.configurationId)).every((point) => point.comparisons === 0));

  for (let guard = 0; guard < 60; guard += 1) {
    const curve = curveFromJudged(catalog, history);
    if (newcomers.every((id) => curve.points.find((point) => point.configurationId === id)?.status === 'established')) break;
    const next = scheduleOne(catalog, history, exposures, themeHistory);
    assert.ok(next, 'the schedule ran dry before the newcomers caught up');
    appendJudgment(catalog, next!, history, exposures, themeHistory);
  }

  const curve = curveFromJudged(catalog, history);
  for (const id of newcomers) {
    const point = curve.points.find((candidate) => candidate.configurationId === id)!;
    assert.equal(point.status, 'established', `${id} never reached a countable rating`);
    assert.ok(point.comparisons >= curve.comparisonsRequired);
  }
}

function testNewThemeCoverage(): void {
  const established = makeSchedulerCatalog(8, 2);
  const simulated = simulateAssignments(established, 12);
  assert.ok(curveFromJudged(established, simulated.judged).points.filter((point) => point.comparisons >= 2).length >= 6, 'the established pool is placed before the theme arrives');
  const catalog = makeSchedulerCatalog(8, 3);
  const history = [...simulated.judged];
  const exposures = { ...simulated.exposures };
  const themeHistory = [...simulated.themes];
  const newThemeLevels = new Set(catalog.entrants.filter((entrant) => entrant.themeId === 'theme-c').map((entrant) => entrant.levelId));
  let guard = 0;
  while ([...newThemeLevels].some((levelId) => (exposures[levelId] ?? 0) === 0) && guard++ < 20) {
    const next = scheduleOne(catalog, history, exposures, themeHistory);
    assert.ok(next, 'a fully unseen theme never stalls the scheduler');
    appendJudgment(catalog, next!, history, exposures, themeHistory);
  }
  assert.ok([...newThemeLevels].every((levelId) => (exposures[levelId] ?? 0) > 0), 'the new theme gets covered');
}

function testEachPairServedOnceThenExhausts(): void {
  const catalog = makeSchedulerCatalog(4, 2, false, [0, 1]);
  const judged: Judged[] = [];
  const seen = new Set<string>();
  const totalPairs = 12;
  for (let index = 0; index < totalPairs; index += 1) {
    const next = nextScheduledMatchup(catalog, 'exhaustion', { judged });
    assert.ok(next, `pair ${index} was available`);
    const id = pairId(next!.themeId, next!.levelIdA, next!.levelIdB);
    assert.equal(seen.has(id), false, `pair ${id} was served twice`);
    seen.add(id);
    appendJudgment(catalog, next!, judged, {}, []);
  }
  assert.equal(nextScheduledMatchup(catalog, 'exhaustion', { judged }), null, 'an exhausted catalog stops scheduling instead of repeating pairs');
}

function testServedSideOrderCanonicalization(): void {
  const catalog = makeSchedulerCatalog(4, 1);
  const theme = catalog.themes[0]!.id;
  const level = (index: number) => `${theme}-${index}`;
  // Ground truth: 0 beats 1 and 2; 2 and 1 beat 3. The undecided pairs are
  // 0-3 (lopsided) and 1-2 (near-even, most informative).
  const canonical: Judged[] = [
    { matchupId: pairId(theme, level(0), level(1)), relative: 'a', aLevelId: level(0) },
    { matchupId: pairId(theme, level(0), level(2)), relative: 'a', aLevelId: level(0) },
    { matchupId: pairId(theme, level(2), level(3)), relative: 'a', aLevelId: level(2) },
    { matchupId: pairId(theme, level(1), level(3)), relative: 'a', aLevelId: level(1) },
  ];
  // The same outcomes with some matchups served with flipped sides.
  const flipped: Judged[] = [
    { matchupId: pairId(theme, level(0), level(1)), relative: 'b', aLevelId: level(1) },
    canonical[1]!,
    { matchupId: pairId(theme, level(2), level(3)), relative: 'b', aLevelId: level(3) },
    canonical[3]!,
  ];
  const fromCanonical = nextScheduledMatchup(catalog, 'sides', { judged: canonical });
  const fromFlipped = nextScheduledMatchup(catalog, 'sides', { judged: flipped });
  assert.ok(fromCanonical);
  assert.equal(pairId(theme, fromCanonical!.levelIdA, fromCanonical!.levelIdB), pairId(theme, level(1), level(2)), 'the near-even pair is scheduled as most informative');
  assert.deepEqual(fromFlipped, fromCanonical, 'served side order does not change how outcomes are interpreted');
}

function testParticipantSequencesDiverge(): void {
  const catalog = makeSchedulerCatalog(6, 1);
  const sequences = ['participant-a', 'participant-b', 'participant-c', 'participant-d'].map((participantId) =>
    simulateAssignments(catalog, 3, participantId).judged.map((item) => item.matchupId).join('|'));
  assert.ok(new Set(sequences).size > 1, 'coverage visits the same pairs in the same order for every participant');
}

function testThemeBalance(): void {
  const catalog = makeSchedulerCatalog(4, 2);
  const simulated = simulateAssignments(catalog, 12);
  const counts = new Map<string, number>();
  for (const item of simulated.judged) {
    const themeId = parsePairId(item.matchupId)?.themeId;
    assert.ok(themeId);
    counts.set(themeId, (counts.get(themeId) ?? 0) + 1);
  }
  assert.ok(Math.max(...counts.values()) - Math.min(...counts.values()) <= 1, `theme counts are balanced: ${JSON.stringify(Object.fromEntries(counts))}`);
}

function testConvergenceAndStability(): void {
  const catalog = makeSchedulerCatalog(4, 1);
  const trueOrder = ['configuration-3', 'configuration-2', 'configuration-1', 'configuration-0'];
  const history: PersonalHistoryEntry[] = [];
  for (let repeat = 0; repeat < 12; repeat += 1) {
    for (let i = 0; i < trueOrder.length; i += 1) for (let j = i + 1; j < trueOrder.length; j += 1) {
      history.push(historyEntry(`truth-${repeat}-${i}-${j}`, trueOrder[i]!, trueOrder[j]!, 'a', configCost(trueOrder[i]!), configCost(trueOrder[j]!)));
    }
  }
  const curve = recomputePersonalCurve(history, { catalog: catalog.entrants });
  const ranked = curve.points.filter((point) => point.rating !== undefined).sort((a, b) => b.rating! - a.rating!).map((point) => point.configurationId);
  assert.deepEqual(ranked, trueOrder);
  assert.ok(curve.points.filter((point) => point.frontier).every((point) => point.status === 'established'));
}

function testNewcomerStaysOffFrontier(): void {
  // The cheapest configuration on the chart can never be dominated, so frontier
  // membership alone would hand a newcomer the curve's anchor point. Here the
  // newcomer is both the cheapest and has lost every comparison, yet
  // regularization still leaves it rated above a well-measured weak
  // configuration. It belongs off the frontier until it has been compared as
  // often as the field.
  const veterans = ['configuration-1', 'configuration-2', 'configuration-3'];
  const history: PersonalHistoryEntry[] = [];
  for (let repeat = 0; repeat < 4; repeat += 1) {
    for (let i = 0; i < veterans.length; i += 1) for (let j = i + 1; j < veterans.length; j += 1) {
      history.push(historyEntry(`veteran-${repeat}-${i}-${j}`, veterans[i]!, veterans[j]!, 'b'));
    }
  }
  history.push(historyEntry('newcomer-a', 'configuration-0', 'configuration-3', 'b'));
  history.push(historyEntry('newcomer-b', 'configuration-0', 'configuration-2', 'b'));

  const curve = recomputePersonalCurve(history);
  const newcomer = curve.points.find((point) => point.configurationId === 'configuration-0')!;
  const weakest = curve.points.find((point) => point.configurationId === 'configuration-1')!;
  assert.equal(newcomer.comparisons, 2);
  assert.ok(newcomer.meanCost! < weakest.meanCost!, 'the newcomer is the cheapest configuration');
  assert.ok(newcomer.rating! > weakest.rating!, 'regularization rates the barely-tested newcomer above a well-measured loser');
  assert.equal(newcomer.status, 'provisional');
  assert.equal(newcomer.frontier, false, 'a newcomer does not anchor the frontier on two comparisons');
  assert.equal(weakest.status, 'established');
  assert.ok(weakest.frontier, 'the cheapest ranked configuration anchors the frontier instead');

  // Comparisons the newcomer accumulates carry it over the bar. It has to
  // out-pace the field to get there, since every catch-up comparison also
  // counts for the veteran on the other side of it.
  const caughtUp = recomputePersonalCurve([
    ...history,
    ...[0, 1, 2].flatMap((round) => veterans.map((veteran, index) => historyEntry(`catch-up-${round}-${index}`, 'configuration-0', veteran, 'b'))),
  ]);
  assert.equal(caughtUp.points.find((point) => point.configurationId === 'configuration-0')?.status, 'established');
}

function testSameConfigurationPairs(): void {
  const catalog = makeSchedulerCatalog(2, 1, true);
  assert.equal(nextScheduledMatchup(catalog, 'same-config', { judged: [] }), null, 'same-configuration levels are never paired');
}

function testRetiredEntrantsNotScheduled(): void {
  const theme = { id: 'retired-theme', title: 'Retired', summary: 'S', prompt: 'P' };
  const catalog: SchedulingPool = {
    themes: [theme],
    entrants: [
      entrant('retired-theme-a1b2', 'configuration-a', true),
      entrant('retired-theme-c3d4', 'configuration-b'),
      entrant('retired-theme-e5f6', 'configuration-c'),
    ],
  };
  const next = nextScheduledMatchup(catalog, 'retired-test');
  assert.ok(next);
  assert.equal([next!.levelIdA, next!.levelIdB].includes('retired-theme-a1b2'), false, 'retired entrants must not be scheduled');

  function entrant(levelId: string, configurationId: string, retired = false): RankCatalogEntrant {
    return { levelId, themeId: theme.id, configurationId, modelName: configurationId, workflowName: 'solo', generationCost: 1, ...(retired ? { retired: true } : {}) };
  }
}

function testSchedulingPoolExcludesRetired(): void {
  const pool = schedulingPool(rankCatalog);
  const poolThemeIds = new Set(pool.themes.map((theme) => theme.id));
  // The pool holds every non-retired theme.
  for (const themeId of ['mass-driver', 'skyhook', 'broadside', 'strandline']) {
    assert.ok(poolThemeIds.has(themeId), `${themeId} should be in the scheduling pool`);
  }
  // Retired themes are absent from the pool entirely, entrants included.
  for (const themeId of ['hull-run', 'mass-driver-detailed']) {
    assert.equal(poolThemeIds.has(themeId), false, `${themeId} is retired and must not be in the pool`);
    assert.equal(pool.entrants.some((entrant) => entrant.themeId === themeId), false, `${themeId} entrants must not be in the pool`);
  }
  // Experimental themes stay in the catalog for browsing but are never scheduled.
  for (const themeId of ['purse-pursuit', 'speedsolve']) {
    assert.ok(findCatalogTheme(rankCatalog, themeId)?.experimental, `${themeId} carries the experimental flag`);
    assert.equal(poolThemeIds.has(themeId), false, `${themeId} is experimental and must not be in the pool`);
    assert.equal(pool.entrants.some((entrant) => entrant.themeId === themeId), false, `${themeId} entrants must not be in the pool`);
  }
  // Every pooled entrant belongs to a pooled, non-retired theme, and is not itself retired.
  const poolLevelIds = pool.entrants.map((entrant) => entrant.levelId);
  assert.equal(new Set(poolLevelIds).size, poolLevelIds.length, 'the pool must not duplicate entrants');
  for (const entrant of pool.entrants) {
    assert.ok(poolThemeIds.has(entrant.themeId), `pooled entrant ${entrant.levelId} has an unpooled theme`);
    assert.notEqual(entrant.retired, true, `retired entrant ${entrant.levelId} must not be in the pool`);
  }
}

function testRetiredThemesNeverScheduledButRevealable(): void {
  const pool = schedulingPool(rankCatalog);
  const retiredThemes = new Set(['hull-run', 'mass-driver-detailed']);
  // Drive the pool scheduler to exhaustion for a participant; no served pair may
  // come from an unscheduled theme.
  const judged: Judged[] = [];
  for (let index = 0; index < 400; index += 1) {
    const next = nextScheduledMatchup(pool, 'retired-guard', { judged });
    if (!next) break;
    assert.equal(retiredThemes.has(next.themeId), false, `a retired theme (${next.themeId}) was scheduled`);
    judged.push({ matchupId: pairId(next.themeId, next.levelIdA, next.levelIdB), relative: 'a', aLevelId: next.levelIdA });
  }
  assert.ok(judged.length > 0, 'the pool served at least one matchup');

  // Retired levels and their content are gone, but a returning voter's stored
  // vote on a retired theme still reconstructs into a reveal.
  const a = findCatalogEntrant(rankCatalog, 'mass-driver-detailed-k4wz');
  const b = findCatalogEntrant(rankCatalog, 'mass-driver-detailed-uk78');
  assert.ok(a && b, 'retired-theme entrants remain resolvable in the catalog');
  assert.ok(findCatalogTheme(rankCatalog, 'mass-driver-detailed')?.retired, 'mass-driver-detailed carries the retired flag');
  const vote: MatchupVote = {
    matchupId: pairId('mass-driver-detailed', a!.levelId, b!.levelId),
    aEntrantId: a!.levelId,
    bEntrantId: b!.levelId,
    verdict: 'a-better',
    relative: 'a',
    playCounts: { a: 1, b: 1 },
    submittedAt: 'now',
    source: 'rank',
  };
  const derived = completedMatchupsFromVotes(rankCatalog, [vote]);
  assert.equal(derived.length, 1, 'a vote on a retired theme still counts as judged history');
  assert.equal(revealFromVote(rankCatalog, vote)?.a.levelId, a!.levelId, 'a retired-theme vote remains revealable');
}

function testHistoricalVoteJudgedNeverReserved(): void {
  // A returning voter's past decision on a mass-driver pair. (The published
  // mass-driver entrants are 7rkv/bczy/vyxj/wo4m; the pair below is real.)
  const a = findCatalogEntrant(rankCatalog, 'mass-driver-7rkv');
  const b = findCatalogEntrant(rankCatalog, 'mass-driver-bczy');
  assert.ok(a && b, 'mass-driver entrants are in the catalog');
  const matchupId = pairId('mass-driver', a!.levelId, b!.levelId);
  const vote: MatchupVote = {
    matchupId,
    aEntrantId: a!.levelId,
    bEntrantId: b!.levelId,
    verdict: 'a-better',
    relative: 'a',
    playCounts: { a: 1, b: 1 },
    submittedAt: 'now',
    source: 'rank',
  };
  assert.equal(completedMatchupsFromVotes(rankCatalog, [vote]).length, 1, 'a mass-driver pair vote counts as judged');

  const pool = schedulingPool(rankCatalog);
  const judged: Judged[] = [{ matchupId, relative: 'a', aLevelId: a!.levelId }];
  for (let index = 0; index < 60; index += 1) {
    const next = nextScheduledMatchup(pool, 'returning-voter', { judged });
    if (!next) break;
    const id = pairId(next.themeId, next.levelIdA, next.levelIdB);
    assert.notEqual(id, matchupId, 'the already-judged pair is never re-served');
    judged.push({ matchupId: id, relative: 'a', aLevelId: next.levelIdA });
  }
}

function testFeaturedOpener(): void {
  const pool = schedulingPool(rankCatalog);
  // The featured opener is participant-salted across all featured pairs, but for
  // a given participant it is deterministic: the same visitor always opens on the
  // same pair, so a reload never reshuffles their first impression.
  const opener = nextScheduledMatchup(pool, 'participant-1', { judged: [] });
  assert.ok(opener);
  const again = nextScheduledMatchup(pool, 'participant-1', { judged: [] });
  assert.equal(
    pairId(opener!.themeId, opener!.levelIdA, opener!.levelIdB),
    pairId(again!.themeId, again!.levelIdA, again!.levelIdB),
    'a fresh participant opens on the same featured pair every time',
  );

  // Whatever theme hosts a participant's opener, it is always a featured pair and
  // never migrates onto a retired theme.
  const retiredThemes = new Set(['hull-run', 'mass-driver-detailed']);
  for (let index = 0; index < 60; index += 1) {
    const first = nextScheduledMatchup(pool, `opener-participant-${index}`, { judged: [] });
    assert.ok(first);
    assert.equal(retiredThemes.has(first!.themeId), false, 'the featured opener never comes from a retired theme');
    assert.equal(findCatalogTheme(rankCatalog, first!.themeId)?.featured === true, true, 'the featured opener comes from a featured theme');
    const ea = findCatalogEntrant(rankCatalog, first!.levelIdA);
    const eb = findCatalogEntrant(rankCatalog, first!.levelIdB);
    assert.equal(ea?.featured === true && eb?.featured === true, true, 'the opener is a featured pairing');
  }
}

async function testPoolMatchupServesValidPair(): Promise<void> {
  // The served assignment resolves to a real catalog theme and pair, drawn from
  // the scheduling pool, with no version marker on the assignment.
  const store = new BenchmarkLocalStore(createMemoryStorage(), 'served-pair');
  store.save({ participantId: 'participant-1' });
  const api = new CatalogBenchmarkApi(rankCatalog, store);
  const matchup = await api.nextMatchup({ participantId: 'participant-1' });
  assert.ok(matchup);
  assert.equal('benchmarkVersion' in matchup!, false, 'the assignment carries no benchmark version');
  const parsed = parsePairId(matchup!.matchupId);
  assert.ok(parsed);
  assert.equal(matchup!.theme.id, parsed!.themeId, 'the served theme matches the pair id');
  const a = findCatalogEntrant(rankCatalog, matchup!.a.playableRef);
  const b = findCatalogEntrant(rankCatalog, matchup!.b.playableRef);
  assert.ok(a && b, 'both served levels resolve in the catalog');
  assert.equal(a!.themeId, matchup!.theme.id);
  assert.equal(b!.themeId, matchup!.theme.id);
  // The API serves exactly what the scheduler chose for this participant.
  const scheduled = nextScheduledMatchup(schedulingPool(rankCatalog), 'participant-1', { judged: [] });
  assert.ok(scheduled);
  assert.equal(matchup!.theme.id, scheduled!.themeId, 'the served theme is the scheduled one');
  assert.equal(matchup!.matchupId, pairId(scheduled!.themeId, scheduled!.levelIdA, scheduled!.levelIdB), 'the served pair is the scheduled one');
}

function testSchedulerIgnoresUnknownHistory(): void {
  const active = makeSchedulerCatalog(2, 1, false, [], 'active');
  const foreign = makeSchedulerCatalog(2, 1, false, [], 'foreign');
  const next = nextScheduledMatchup(active, 'ignores-unknown-history', { judged: [] });
  assert.ok(next);
  assert.ok(active.entrants.some((entrant) => entrant.levelId === next!.levelIdA));
  assert.ok(active.entrants.some((entrant) => entrant.levelId === next!.levelIdB));
  assert.equal(foreign.entrants.some((entrant) => entrant.levelId === next!.levelIdA), false);
  assert.equal(foreign.entrants.some((entrant) => entrant.levelId === next!.levelIdB), false);
  // Judged history that names levels outside the pool is ignored, and the
  // scheduler still serves a valid pair from the active pool.
  const foreignMatchup = pairId(foreign.themes[0]!.id, foreign.entrants[0]!.levelId, foreign.entrants[1]!.levelId);
  const afterForeignHistory = nextScheduledMatchup(active, 'ignores-unknown-history', {
    judged: [{ matchupId: foreignMatchup, relative: 'a' }],
  });
  assert.ok(afterForeignHistory);
  assert.ok(active.entrants.some((entrant) => entrant.levelId === afterForeignHistory!.levelIdA));
  assert.ok(active.entrants.some((entrant) => entrant.levelId === afterForeignHistory!.levelIdB));
}

function testCatalogDerivedHistory(): void {
  const version = makeSchedulerCatalog(2, 1);
  const catalog = makeRankCatalog(version);
  const theme = version.themes[0]!;
  const a = version.entrants[0]!;
  const b = version.entrants[1]!;
  const vote: MatchupVote = { matchupId: pairId(theme.id, a.levelId, b.levelId), aEntrantId: a.levelId, bEntrantId: b.levelId, verdict: 'a-better', relative: 'tie', playCounts: { a: 1, b: 1 }, submittedAt: 'now', source: 'rank' };
  const derived = completedMatchupsFromVotes(catalog, [vote]);
  assert.equal(derived.length, 1);
  assert.equal(derived[0]!.vote.relative, 'a', 'relative outcome is derived from the stored verdict');
  assert.deepEqual(exposureCountsFromVotes(catalog, [vote]), { [a.levelId]: 1, [b.levelId]: 1 });

  const missing = { ...vote, matchupId: pairId(theme.id, 'retired-a', b.levelId) };
  assert.equal(completedMatchupsFromVotes(catalog, [missing]).length, 0, 'votes for retired levels are skipped at read time');
  const missingTheme = { ...vote, matchupId: pairId('retired-theme', a.levelId, b.levelId) };
  assert.equal(completedMatchupsFromVotes(catalog, [missingTheme]).length, 0, 'votes for retired themes are skipped at read time');
}

function testRetiredEntrantReveal(): void {
  const retired = rankCatalog.entrants.find((entrant) => entrant.retired)!;
  const live = rankCatalog.entrants.find((entrant) => entrant.themeId === retired.themeId && !entrant.retired)!;
  assert.ok(retired && live);
  const theme = rankCatalog.themes.find((candidate) => candidate.id === retired.themeId)!;
  const vote: MatchupVote = {
    matchupId: pairId(theme.id, retired.levelId, live.levelId),
    aEntrantId: retired.levelId,
    bEntrantId: live.levelId,
    verdict: 'a-better',
    relative: 'a',
    playCounts: { a: 1, b: 1 },
    submittedAt: 'now',
    source: 'rank',
  };
  const reveal = revealFromVote(rankCatalog, vote);
  assert.ok(reveal, 'a vote involving a retired entrant remains revealable');
  assert.equal(reveal!.a.levelId, retired.levelId);
  assert.ok(reveal!.a.run, 'retired entrant retains its generation record for reveal');
}

function testPersonalCurveCatalogExcludesRetired(): void {
  // The personal-curve base is the scheduling pool (non-retired entrants) plus any
  // configuration the participant actually judged. A configuration living only on
  // retired entrants stays out unless it was judged.
  const theme = { id: 'curve-theme', title: 'Curve', summary: 'S', prompt: 'P' };
  const entrant = (levelId: string, configurationId: string, generationCost: number, retired = false): RankCatalogEntrant => ({ levelId, themeId: theme.id, configurationId, modelName: configurationId, workflowName: 'solo', generationCost, ...(retired ? { retired: true } : {}) });
  const catalog: RankCatalog = {
    generatedAt: 'test',
    themes: [theme],
    entrants: [
      entrant('live-shared', 'shared', 40),
      entrant('retired-shared', 'shared', 10, true),
      entrant('retired-played', 'retired-played-config', 30, true),
      entrant('retired-never', 'retired-never-config', 50, true),
      entrant('live-active', 'active', 20),
      entrant('live-unplayed', 'active-unplayed', 60),
    ],
  };
  const history = [
    historyEntry('shared-vote', 'shared', 'active', 'a', 10, 20),
    historyEntry('retired-vote', 'retired-played-config', 'active', 'b', 30, 20),
  ];
  const selected = selectPersonalCurveCatalog(catalog, history);
  assert.equal(selected.some((item) => item.configurationId === 'retired-never-config'), false, 'an unplayed retired-only configuration was included');
  assert.equal(selected.some((item) => item.configurationId === 'retired-played-config'), true, 'a judged retired-only configuration was omitted');
  const curve = recomputePersonalCurve(history, { catalog: selected });
  assert.equal(curve.points.find((point) => point.configurationId === 'shared')?.meanCost, 25, 'shared configuration costs were not pooled across live and retired entrants');
  assert.equal(curve.points.find((point) => point.configurationId === 'active-unplayed')?.status, 'pending', 'unplayed active configuration was not shown as pending');
}

/** Two configurations that differ only in which provider served the model are one
 * intervention to a voter, so they are rated as one point and their costs pool.
 * Two that differ in reasoning effort are the comparison the benchmark exists to
 * make, so they stay apart. */
function testProviderVariantsShareOnePoint(): void {
  const configurations: RankCatalogConfiguration[] = [
    { id: 'sub', modelName: 'Model X', workflowName: 'solo', primaryModel: 'x', effort: 'max', workflowSummary: '' },
    { id: 'metered', modelName: 'Model X', workflowName: 'solo', primaryModel: 'x', effort: 'max', workflowSummary: '' },
    { id: 'low', modelName: 'Model X', workflowName: 'solo', primaryModel: 'x', effort: 'high', workflowSummary: '' },
  ];
  const groupIdFor = configurationGroupResolver(configurations);
  assert.equal(groupIdFor('sub'), groupIdFor('metered'), 'provider variants did not resolve to one rating group');
  assert.notEqual(groupIdFor('sub'), groupIdFor('low'), 'two reasoning efforts collapsed into one rating group');
  assert.equal(groupIdFor('absent'), 'absent', 'a configuration outside the catalog did not resolve to itself');

  const history = [
    historyEntry('m1', 'sub', 'low', 'a', 10, 4),
    historyEntry('m2', 'metered', 'low', 'a', 20, 4),
  ];
  const curve = recomputePersonalCurve(history, { groupIdFor });
  assert.equal(curve.points.length, 2, 'the provider variants were not pooled into one point');
  const pooled = curve.points.find((point) => point.configurationId === groupIdFor('sub'))!;
  assert.equal(pooled.comparisons, 2, 'both votes were not credited to the pooled point');
  assert.equal(pooled.wins, 2, 'the pooled point did not carry both wins');
  assert.equal(pooled.meanCost, 15, 'costs were not averaged across the pooled configurations');
}

/** A model published without a price is scheduled, voted on, and rated like any
 * other. Its point carries no mean cost, so the cost chart leaves it out and the
 * output-tokens chart carries it. */
function testUnpricedEntrantsRank(): void {
  const theme: RankCatalogTheme = { id: 'unpriced-theme', title: 'Unpriced', summary: 'S', prompt: 'P' };
  const entrant = (levelId: string, configurationId: string, generationCost?: number): RankCatalogEntrant => ({
    levelId,
    themeId: theme.id,
    configurationId,
    modelName: configurationId,
    workflowName: 'solo',
    ...(generationCost === undefined ? {} : { generationCost }),
    run: { generationWallTimeSeconds: 1, totalWallTimeSeconds: 1, result: 'submitted', orchestrationTreatment: 'solo', models: [{ modelName: configurationId, role: 'solo', inputTokens: 0, outputTokens: 1000 }] },
  });
  const catalog: RankCatalog = {
    generatedAt: 'test',
    themes: [theme],
    entrants: [entrant('unpriced-level', 'unpriced', undefined), entrant('priced-level', 'priced', 4)],
  };

  const pool = schedulingPool(catalog);
  assert.ok(pool.entrants.some((item) => item.levelId === 'unpriced-level'), 'an entrant with no cost must be in the scheduling pool');
  const served = nextScheduledMatchup(pool, 'unpriced-participant');
  assert.ok(served, 'the scheduler served no matchup');
  assert.ok([served!.levelIdA, served!.levelIdB].includes('unpriced-level'), 'the served pair must include the unpriced entrant');

  const history = [historyEntry('unpriced-vote', 'unpriced', 'priced', 'a', undefined, 4)];
  const curve = recomputePersonalCurve(history, { catalog: selectPersonalCurveCatalog(catalog, history) });
  const unpricedPoint = curve.points.find((point) => point.configurationId === 'unpriced')!;
  assert.equal(unpricedPoint.comparisons, 1, 'the vote on the unpriced entrant was not counted');
  assert.notEqual(unpricedPoint.rating, undefined, 'the unpriced entrant was not rated');
  assert.equal(unpricedPoint.meanCost, undefined, 'an unpriced contributor must leave the point without a mean cost');

  const rated = ratedCurvePoints(curve);
  const costPlotted = layoutCurveChart(rated, COST_AXIS).plotted.map((point) => point.configurationId);
  const tokenPlotted = layoutCurveChart(rated, OUTPUT_TOKENS_AXIS).plotted.map((point) => point.configurationId);
  assert.equal(costPlotted.includes('unpriced'), false, 'the cost chart plotted a point with no cost');
  assert.deepEqual(layoutCurveChart(rated, COST_AXIS).omittedLabels, ['unpriced'], 'the cost chart did not name what it omitted');
  assert.ok(tokenPlotted.includes('unpriced'), 'the output-tokens chart dropped a rated point');
  assert.deepEqual(layoutCurveChart(rated, OUTPUT_TOKENS_AXIS).omittedLabels, [], 'the output-tokens chart omitted a point it can place');

  // A rating group pooling a priced and an unpriced configuration reports no mean
  // cost rather than the mean of its priced half.
  const pooled = recomputePersonalCurve(
    [historyEntry('pooled-vote', 'half-priced', 'priced', 'a', undefined, 4)],
    {
      catalog: [
        { configurationId: 'half-priced', modelName: 'Half', workflowName: 'solo', generationCost: 6 },
        { configurationId: 'half-unpriced', modelName: 'Half', workflowName: 'solo' },
        { configurationId: 'priced', modelName: 'Priced', workflowName: 'solo', generationCost: 4 },
      ],
      groupIdFor: (configurationId) => (configurationId.startsWith('half-') ? 'half' : configurationId),
    },
  );
  assert.equal(pooled.points.find((point) => point.configurationId === 'half')?.meanCost, undefined, 'a pooled point reported a mean over its priced half');
  assert.equal(pooled.points.find((point) => point.configurationId === 'priced')?.meanCost, 4, 'a wholly priced point lost its mean cost');
}

async function testReloadPreservesMatchupAndPlayState(): Promise<void> {
  const catalog = makeRankCatalog(makeSchedulerCatalog(4, 1));
  const storage = createMemoryStorage();
  const firstStore = new BenchmarkLocalStore(storage, 'reload');
  const firstApi = new CatalogBenchmarkApi(catalog, firstStore);
  const participantId = firstStore.participantId;
  const first = await firstApi.nextMatchup({ participantId });
  assert.ok(first);
  firstStore.recordLevelRun(first!.a.playableRef, 42);

  const reloadedStore = new BenchmarkLocalStore(storage, 'reload');
  const reloadedApi = new CatalogBenchmarkApi(catalog, reloadedStore);
  const second = await reloadedApi.nextMatchup({ participantId: reloadedStore.participantId });
  assert.ok(second);
  assert.equal(second!.matchupId, first!.matchupId, 'the scheduler reproduces the same current matchup after reload');
  assert.deepEqual(playCountsFor(second!, reloadedStore.snapshot.levelRuns), { a: 1, b: 0 }, 'local runs pre-fill one side after reload');
}

async function testCatalogChangesRefreshReveals(): Promise<void> {
  const originalPool = makeSchedulerCatalog(2, 1);
  const original = makeRankCatalog({
    ...originalPool,
    entrants: originalPool.entrants.map((entrant, index) => ({ ...entrant, thumbnailPath: `/old-${index}.png` })),
  });
  const storage = createMemoryStorage();
  const store = new BenchmarkLocalStore(storage, 'thumbnail-refresh');
  const api = new CatalogBenchmarkApi(original, store);
  const participantId = store.participantId;
  const matchup = await api.nextMatchup({ participantId });
  assert.ok(matchup);
  await api.recordPlay({ matchupId: matchup!.matchupId, participantId, side: 'a' });
  await api.recordPlay({ matchupId: matchup!.matchupId, participantId, side: 'b' });
  await api.submitVote({ matchupId: matchup!.matchupId, participantId, verdict: 'a-better', playCounts: { a: 1, b: 1 } });

  const changedPool = {
    ...originalPool,
    entrants: originalPool.entrants.map((entrant, index) => ({ ...entrant, thumbnailPath: `/new-${index}.avif` })),
  };
  const changedCatalog = makeRankCatalog(changedPool);
  const reloaded = new BenchmarkLocalStore(storage, 'thumbnail-refresh');
  const derived = completedMatchupsFromVotes(changedCatalog, reloaded.snapshot.history);
  const savedVote = reloaded.snapshot.history[0]!;
  assert.equal(derived[0]!.reveal.a.levelId, savedVote.aEntrantId, 'reconstructed reveal preserves the original side order');
  assert.equal(derived[0]!.reveal.b.levelId, savedVote.bEntrantId, 'reconstructed reveal preserves the original side order');
  assert.equal(derived[0]!.reveal.a.thumbnailPath, changedPool.entrants.find((entrant) => entrant.levelId === savedVote.aEntrantId)?.thumbnailPath);
  assert.equal(derived[0]!.reveal.b.thumbnailPath, changedPool.entrants.find((entrant) => entrant.levelId === savedVote.bEntrantId)?.thumbnailPath);
}

function testVoteValidationIsCatalogWide(): void {
  const themeA = makeSchedulerCatalog(2, 1, false, [], 'a');
  const themeB = makeSchedulerCatalog(2, 1, false, [], 'b');
  const catalog = makeRankCatalog(themeA, themeB);
  const theme = themeA.themes[0]!;
  const a = themeA.entrants[0]!;
  const b = themeA.entrants[1]!;
  const otherEntrant = themeB.entrants.find((entrant) => entrant.themeId === themeB.themes[0]!.id)!;
  const base = { matchupId: pairId(theme.id, a.levelId, b.levelId), participantId: 'participant', themeId: theme.id, aLevelId: a.levelId, bLevelId: b.levelId, verdict: 'both-good', playCounts: { a: 1, b: 1 } };
  // benchmarkVersion is now optional and ignored: absent is valid, any non-empty
  // string is valid, and entrant resolution is catalog-wide.
  assert.equal(validateRankVoteBody(base, catalog).ok, true, 'vote without benchmarkVersion was rejected');
  assert.equal(validateRankVoteBody({ ...base, benchmarkVersion: 'rank-catalog-v1' }, catalog).ok, true, 'vote with a benchmarkVersion was rejected');
  assert.equal(validateRankVoteBody({ ...base, benchmarkVersion: 'rank-catalog-v9' }, catalog).ok, true, 'a stale benchmarkVersion was rejected');
  assert.equal(validateRankVoteBody({ ...base, benchmarkVersion: '' }, catalog).ok, false, 'a present-but-empty benchmarkVersion was accepted');
  assert.equal(validateRankVoteBody({ ...base, bLevelId: otherEntrant.levelId }, catalog).ok, false, 'a cross-theme entrant pairing was accepted');
}

async function testApisAndStateMachine(): Promise<void> {
  const machine = new ComparisonStateMachine(assignment());
  machine.startA(); machine.completeRun('a'); machine.startB(); machine.completeRun('b');
  machine.submit('both-good');
  assert.equal(machine.state.kind, 'submitting');
  assert.throws(() => machine.reveal({ matchupId: 'other', a: undefined as never, b: undefined as never, vote: undefined as never }));

  assert.equal(createFixtureCatalog('production').entrants.length, 0);
  const fixture = createDevelopmentFixtureApi();
  const first = await fixture.nextMatchup({ participantId: 'p1' });
  assert.ok(first);
  await assert.rejects(() => fixture.reveal(first!.matchupId, 'p1'), /vote/);
  await fixture.recordPlay({ matchupId: first!.matchupId, side: 'a', participantId: 'p1' });
  await fixture.recordPlay({ matchupId: first!.matchupId, side: 'b', participantId: 'p1' });
  const vote = await fixture.submitVote({ matchupId: first!.matchupId, participantId: 'p1', verdict: 'a-better', playCounts: { a: 1, b: 1 } });
  assert.equal((await fixture.submitVote({ matchupId: first!.matchupId, participantId: 'p1', verdict: 'a-better', playCounts: { a: 1, b: 1 } })).matchupId, vote.matchupId);
  await assert.rejects(() => fixture.submitVote({ matchupId: first!.matchupId, participantId: 'p1', verdict: 'b-better', playCounts: { a: 1, b: 1 } }), /different vote/);

  const version = makeSchedulerCatalog(4, 2);
  const catalog = makeRankCatalog(version);
  const storage = createMemoryStorage();
  const store = new BenchmarkLocalStore(storage, 'catalog-api');
  const api = new CatalogBenchmarkApi(catalog, store);
  const participantId = store.participantId;
  const next = await api.nextMatchup({ participantId });
  assert.ok(next);
  await api.recordPlay({ matchupId: next!.matchupId, participantId, side: 'a' });
  await api.recordPlay({ matchupId: next!.matchupId, participantId, side: 'b' });
  await api.submitVote({ matchupId: next!.matchupId, participantId, verdict: 'a-better', playCounts: { a: 1, b: 1 } });
  const reveal = await api.reveal(next!.matchupId, participantId);
  assert.equal(reveal.a.dataClass, 'eligible');
  assert.equal(store.snapshot.history.length, 1);
  assert.deepEqual(store.snapshot.levelRuns, [], 'matchup state is not written into local storage');
}

function simulateAssignments(catalog: SchedulingPool, count: number, participantId = 'test-participant'): { judged: Judged[]; exposures: Record<string, number>; themes: string[]; assignments: { themeId: string; levelIdA: string; levelIdB: string }[] } {
  const judged: Judged[] = [];
  const exposures: Record<string, number> = {};
  const themes: string[] = [];
  const assignments: { themeId: string; levelIdA: string; levelIdB: string }[] = [];
  for (let index = 0; index < count; index += 1) {
    const next = scheduleOne(catalog, judged, exposures, themes, participantId);
    assert.ok(next);
    assignments.push(next!);
    appendJudgment(catalog, next!, judged, exposures, themes);
  }
  return { judged, exposures, themes, assignments };
}

function scheduleOne(catalog: SchedulingPool, judged: readonly Judged[], exposures: Readonly<Record<string, number>>, themes: readonly string[], participantId = 'test-participant') {
  return nextScheduledMatchup(catalog, participantId, { judged });
}

function appendJudgment(catalog: SchedulingPool, matchup: { themeId: string; levelIdA: string; levelIdB: string }, judged: Judged[], exposures: Record<string, number>, themes: string[]): void {
  const a = catalog.entrants.find((entrant) => entrant.levelId === matchup.levelIdA)!;
  const b = catalog.entrants.find((entrant) => entrant.levelId === matchup.levelIdB)!;
  const aIndex = Number(a.configurationId.split('-').at(-1));
  const bIndex = Number(b.configurationId.split('-').at(-1));
  judged.push({ matchupId: pairId(matchup.themeId, matchup.levelIdA, matchup.levelIdB), relative: aIndex >= bIndex ? 'a' : 'b', aLevelId: matchup.levelIdA });
  exposures[a.levelId] = (exposures[a.levelId] ?? 0) + 1;
  exposures[b.levelId] = (exposures[b.levelId] ?? 0) + 1;
  themes.push(matchup.themeId);
}

function curveFromJudged(catalog: SchedulingPool, judged: readonly Judged[]) {
  const entrants = new Map(catalog.entrants.map((entrant) => [entrant.levelId, entrant]));
  const history = judged.flatMap((item): PersonalHistoryEntry[] => {
    const parsed = parsePairId(item.matchupId);
    const a = parsed ? entrants.get(parsed.levelA) : undefined;
    const b = parsed ? entrants.get(parsed.levelB) : undefined;
    return a && b ? [historyEntry(item.matchupId, a.configurationId, b.configurationId, item.relative, a.generationCost, b.generationCost)] : [];
  });
  return recomputePersonalCurve(history, { catalog: catalog.entrants });
}

function historyEntry(matchupId: string, aConfigurationId: string, bConfigurationId: string, relative: RelativeOutcome, aCost: number | undefined = costForId(aConfigurationId), bCost: number | undefined = costForId(bConfigurationId)): PersonalHistoryEntry {
  const vote: MatchupVote = {
    matchupId,
    aEntrantId: `${aConfigurationId}-level`,
    bEntrantId: `${bConfigurationId}-level`,
    verdict: relative === 'a' ? 'a-better' : relative === 'b' ? 'b-better' : 'both-good',
    relative,
    playCounts: { a: 1, b: 1 },
    submittedAt: '',
    source: 'rank',
  };
  const side = (configurationId: string, cost: number | undefined) =>
    ({ configurationId, modelName: configurationId, workflowName: 'solo', ...(cost === undefined ? {} : { generationCost: cost }) });
  return { vote, a: side(aConfigurationId, aCost), b: side(bConfigurationId, bCost) };
}

function makeSchedulerCatalog(configurations: number, themeCount: number, sameConfiguration = false, featuredConfigurations: readonly number[] = [], slotPrefix = ''): SchedulingPool {
  const themes: RankCatalogTheme[] = Array.from({ length: themeCount }, (_, index) => ({ id: `${slotPrefix ? `${slotPrefix}-` : ''}theme-${String.fromCharCode(97 + index)}`, title: `Theme ${index}`, summary: 'S', prompt: 'P' }));
  const entrants: RankCatalogEntrant[] = themes.flatMap((theme) => Array.from({ length: configurations }, (_, index) => ({
    levelId: `${theme.id}-${index}`,
    themeId: theme.id,
    configurationId: sameConfiguration ? 'shared' : `configuration-${index}`,
    modelName: sameConfiguration ? 'Shared' : `Model ${index}`,
    workflowName: 'solo',
    generationCost: index + 1,
    ...(featuredConfigurations.includes(index) ? { featured: true } : {}),
  })));
  return { themes, entrants };
}

function makeRankCatalog(...pools: readonly SchedulingPool[]): RankCatalog {
  const selected = pools.length > 0 ? pools : [makeSchedulerCatalog(2, 1)];
  return { generatedAt: 'test', themes: selected.flatMap((pool) => pool.themes), entrants: selected.flatMap((pool) => pool.entrants) };
}

function configurationPairFromMatchup(catalog: SchedulingPool, matchupId: string): string {
  const parsed = parsePairId(matchupId)!;
  const a = catalog.entrants.find((entrant) => entrant.levelId === parsed.levelA)!;
  const b = catalog.entrants.find((entrant) => entrant.levelId === parsed.levelB)!;
  return [a.configurationId, b.configurationId].sort().join('__');
}

function configCost(configurationId: string): number { return Number(configurationId.split('-').at(-1)) + 1; }
function costForId(configurationId: string): number { return configurationId.startsWith('configuration-') ? configCost(configurationId) : 1; }

if (process && process.argv[1] && import.meta.url === new URL(process.argv[1], 'file:').href) {
  runBenchmarkDomainTests().then(() => console.log('Benchmark domain tests passed.')).catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
}
