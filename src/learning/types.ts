import { SkillArea } from "../utils/skillAreas";

/**
 * What an engineer's edit was. Every kind belongs to exactly one skill area
 * (the skill whose guidance should have prevented the manual fix), has a
 * direction, and is documented in kinds.ts.
 */
export type EventKind =
  // locators
  | "locator-upgraded" //   e.g. css -> role: a more stable strategy
  | "locator-replaced" //   same strategy, new value: the old selector went stale
  | "locator-downgraded" // e.g. role -> xpath: a less stable strategy
  | "locator-fallback-added" // hybrid locator: a fallback / .or() alternative was added
  | "locator-fallback-removed"
  | "locator-scoped" //     .first()/.nth() replaced by a scoped locator
  // synchronization
  | "sync-sleep-replaced"
  | "sync-sleep-removed"
  | "sync-wait-added"
  | "sync-sleep-added"
  | "sync-timeout-raised"
  | "sync-force-added"
  | "sync-force-removed"
  // assertions and verifications
  | "assertion-added"
  | "verification-added" // an assertion added right after an action that changes the page
  | "assertion-strengthened"
  | "assertion-weakened"
  | "assertion-removed"
  | "expectation-updated"
  // test data
  | "data-externalized"
  | "data-hardcoded"
  | "data-guard-added";

/** improvement = worth learning from; regression = a shortcut to coach against, never to teach; neutral = counted, not promoted. */
export type Direction = "improvement" | "regression" | "neutral";

export type FileKind = "spec" | "page" | "locators" | "other";

export interface LearningEvent {
  /** Content fingerprint: the same edit captured twice (hook, then CI) has the same id and is counted once. */
  id: string;
  kind: EventKind;
  /** Narrows the kind, e.g. "css->role" or "waitForResponse". Part of the pattern key. */
  subkind?: string;
  area: SkillArea;
  direction: Direction;
  file: string;
  fileKind: FileKind;
  line?: number;
  /** Redacted, truncated source of the statement before / after. */
  before?: string;
  after?: string;
  /** Stable element key for locator edits (JSON element name or the selector), used to find unstable elements. */
  target?: string;
  /** Why, in the engineer's words (commit subject or --why), redacted. */
  why?: string;
  /** The failure this edit resolved, when it could be linked to a heal-report. */
  resolves?: { entryId: string; classification: string; title: string };
}

export interface FileReview {
  file: string;
  /** Reviewer rules that stopped firing / started firing because of this change. */
  fixed: string[];
  introduced: string[];
}

export type CaptureSource = "staged" | "worktree" | "commit" | "range";

export interface CaptureRecord {
  schema: 1;
  capturedAt: string;
  source: CaptureSource;
  commit?: string;
  /** Not recorded any more (branch names can carry names and ticket text); kept optional so old records still load. */
  branch?: string;
  /** Short salted hash of the committer e-mail: counts distinct engineers without storing who they are. */
  author: string;
  /** Short hash of the repository identity, so a central store can tell projects apart. */
  repo: string;
  files: FileReview[];
  events: LearningEvent[];
}

export interface PatternEvidence {
  events: number;
  files: number;
  authors: number;
  repos: number;
  firstSeen: string;
  lastSeen: string;
}

export interface Pattern {
  schema: 1;
  /** Equals the cluster key: kind[:subkind]. */
  id: string;
  type: "pattern" | "anti-pattern";
  title: string;
  area: SkillArea;
  kind: EventKind;
  subkind?: string;
  /** When this applies. */
  problem: string;
  /** What to do (pattern) or what to avoid and do instead (anti-pattern). */
  guidance: string;
  example?: { before?: string; after?: string };
  evidence: PatternEvidence;
  /** Catalog entries (failure types) engineers resolved with this fix, with counts. */
  resolves: Record<string, number>;
  status: "approved" | "retired";
  approvedAt: string;
  approvedBy: string;
}

export interface LearningConfig {
  /** Candidate thresholds. */
  minEvents: number;
  minFiles: number;
  minAuthors: number;
  /** A regression must recur this often before it is reported as a coaching signal. */
  watchEvents: number;
  /** Regex sources for files to learn from / skip. */
  include: string[];
  exclude: string[];
  /** Salt for author hashes. The hash is pseudonymous, not anonymous: in a private repository set BAT_LEARN_SALT (it overrides this) so the salt is not committed. */
  salt: string;
  /** false = keep only the kind of edit, no statements (before/after/target). For projects whose code must not be copied anywhere. */
  storeStatements: boolean;
}
