/**
 * Types for the rollout analysis packages under `benchmark/analysis/<level-id>/`.
 * The package format is documented in docs/analysis-package-format.md; these
 * types mirror the JSON emitted by scripts/analysis/extract-trace.mjs plus the
 * model-authored editorial layer.
 */

// ---- run.json -------------------------------------------------------------

export type AnalysisGate = {
  id: string;
  command: string;
  status: string;
  exitCode: number | null;
  wallTimeSeconds: number | null;
};

export type AnalysisModelCost = {
  modelName: string;
  costUsd: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
};

export type AnalysisTokenTotal = {
  inputTokens: number;
  outputTokens: number;
  cacheReadInputTokens: number;
  cacheCreationInputTokens: number;
  costUSD: number;
};

export type AnalysisRun = {
  runId: string;
  slotId: string;
  levelId: string;
  levelTitle: string;
  theme: { id: string; path: string };
  configurationId: string;
  blinded: boolean;
  models: {
    orchestrator: string;
    orchestratorEffort?: string;
    delegate?: string | null;
    delegateEffort?: string | null;
    usageKeys: string[];
  };
  harness: { name: string; version: string };
  timing: { startedAt: string; finishedAt: string; wallTimeSeconds: number; numTurns: number };
  cost: { currency: string; status: string; totalUsd: number; perModel: AnalysisModelCost[] };
  tokenTotals: Record<string, AnalysisTokenTotal>;
  gates: AnalysisGate[];
  disposition: { status: string; reason?: string };
  finalMessage: string;
};

// ---- trace.json / subagents/agent-<id>.json --------------------------------

export type TraceEventKind =
  | 'user-message'
  | 'thinking'
  | 'assistant-text'
  | 'tool-call'
  | 'tool-result'
  | 'subagent-spawn'
  | 'subagent-result';

export type TraceEventUsage = {
  inputTokens: number;
  outputTokens: number;
  cacheReadInputTokens: number;
  cacheCreationInputTokens: number;
};

/** One timeline entry. The extractor emits a single record shape whose optional
 * fields are populated per kind; a discriminated union would misrepresent that
 * looseness, so optionality carries the variance here. */
export type TraceEvent = {
  id: string;
  ts: string;
  tSeconds: number;
  kind: TraceEventKind;
  usage?: TraceEventUsage;
  model?: string;
  // user-message / thinking / assistant-text
  text?: string;
  truncated?: boolean;
  byteLength?: number;
  // tool-call
  tool?: string;
  toolUseId?: string;
  summary?: string;
  inputs?: Record<string, unknown>;
  // tool-result
  isError?: boolean;
  ok?: boolean;
  resultText?: string;
  // subagent-spawn / subagent-result
  agentId?: string;
  description?: string;
  subagentType?: string;
  prompt?: string;
  status?: string;
};

export type AnalysisTrace = {
  runId: string;
  levelId: string;
  generatedAt: string;
  runStart: string;
  source: string;
  sessionId: string;
  eventCount: number;
  events: TraceEvent[];
};

export type SubagentTranscript = {
  header: {
    agentId: string;
    agentType: string;
    description: string;
    spawnDepth: number;
    spawnToolUseId: string;
    model: string;
    prompt: string;
    durationSeconds?: number;
    usage?: TraceEventUsage;
    resultText?: string;
  };
  runStart: string;
  eventCount: number;
  events: TraceEvent[];
};

// ---- files.json -----------------------------------------------------------

export type FileEdit = {
  eventId: string;
  agent: string;
  operation: string;
  tSeconds: number;
  deltaSummary: { lines?: number | null; bytes?: number | null; added?: number | null; removed?: number | null };
};

export type AnalysisFileHistory = {
  file: string;
  inFinalPayload: boolean;
  editCount: number;
  firstTouchedTSeconds: number;
  lastTouchedTSeconds: number;
  agents: string[];
  history: FileEdit[];
};

export type AnalysisFiles = {
  runId: string;
  entrantBaseline: string;
  evaluatedCommit: string;
  finalPayloadFiles: { status: string; file: string }[];
  files: AnalysisFileHistory[];
};

// ---- snapshot-moments.json ------------------------------------------------

export type SnapshotMoment = {
  ordinal: number;
  eventId: string;
  agent: string;
  ts: string;
  tSeconds: number;
  command: string;
  exitStatus: string;
  stderrPresent: boolean;
  filesModifiedSincePrevious: { file: string; operations: number }[] | string[];
};

export type AnalysisSnapshotMoments = { runId: string; count: number; moments: SnapshotMoment[] };

// ---- snapshots.json -------------------------------------------------------

export type SnapshotImage = {
  path: string;
  depicts?: { module?: string; export?: string; yawDegrees?: number; [key: string]: unknown };
  bytes: number;
};

export type SnapshotReconstruction = {
  method: string;
  verified: string;
  originalLuminance?: number[];
  replayedLuminance?: number[];
  caveats?: string;
};

export type SnapshotIndexMoment = {
  ordinal: number;
  eventId: string;
  agent: string;
  tSeconds: number;
  command: string;
  images: SnapshotImage[];
  filesChangedSincePreviousMoment: string[];
  reconstruction: SnapshotReconstruction;
};

export type AnalysisSnapshots = {
  runId: string;
  level: string;
  protocol: string;
  entrantBaseline: string;
  reconstructionSummary: string;
  moments: SnapshotIndexMoment[];
  finalStateVerification: { method: string; allFilesMatch: boolean; files: { file: string; match: boolean }[] };
  environment: { node: string; renderer: string; threeVersion: string; fidelityNote: string };
};

// ---- sections.json --------------------------------------------------------

export type AnalysisSection = {
  id: string;
  title: string;
  startEventId: string;
  endEventId: string;
  startSeconds: number;
  endSeconds: number;
  agents: string[];
  kind: string;
  summary: string;
  keyEventIds: string[];
  subsections?: AnalysisSection[];
};

export type AnalysisSections = {
  runId: string;
  levelId: string;
  generatedBy: string;
  sectionCount: number;
  sections: AnalysisSection[];
};

// ---- annotations.json -----------------------------------------------------

export type AnnotationType =
  | 'decision'
  | 'insight'
  | 'mistake'
  | 'recovery'
  | 'delegation'
  | 'verification'
  | 'screenshot'
  | 'milestone'
  | 'budget'
  | 'quality-flag'
  | 'fix'
  | 'polish';

export type AnalysisAnnotation = {
  id: string;
  eventId: string;
  agent: string;
  tSeconds: number;
  type: AnnotationType | string;
  title: string;
  body: string;
};

export type AnalysisAnnotations = { runId: string; levelId: string; annotationCount: number; annotations: AnalysisAnnotation[] };

// ---- narrative.json -------------------------------------------------------

export type AnalysisNarrative = {
  runId: string;
  levelId: string;
  headline: string;
  verdict: string;
  timeline_story: { sectionId: string; text: string }[];
  delegation_analysis: string;
  stats_callouts: { stat: string; caption: string }[];
  open_questions: string[];
};

// ---- the assembled package ------------------------------------------------

export type AnalysisPackage = {
  id: string;
  run: AnalysisRun;
  trace: AnalysisTrace;
  subagents: SubagentTranscript[];
  files: AnalysisFiles;
  snapshotMoments: AnalysisSnapshotMoments;
  snapshots: AnalysisSnapshots;
  sections: AnalysisSections;
  annotations: AnalysisAnnotations;
  narrative: AnalysisNarrative;
};

/** Lightweight card data for the index page. */
export type AnalysisPackageSummary = {
  id: string;
  run: AnalysisRun;
  headline: string;
  verdict: string;
  thumbnail?: string;
  eventTotal?: number;
};
