import { KIND_BY_ID } from "./kinds";
import { oneLine, redact } from "./redact";
import { CaptureRecord, FileKind, FileReview, LearningEvent, Pattern } from "./types";

/**
 * Records and patterns are files in the repository: anyone can edit them, a
 * merge can mangle them, and an old version of the tool wrote older shapes.
 * Everything that reads them goes through here, so what the aggregator,
 * publisher and lookup see is always well-formed, single-line, redacted, and
 * has its kind, direction, area, type and wording taken from kinds.ts - never
 * from the file itself. A bad file is dropped, it never crashes a report.
 */

const SAFE_PATH = /^[A-Za-z0-9_.@\- /]{1,200}$/;
const FILE_KINDS = new Set<FileKind>(["spec", "page", "locators", "other"]);
const HASH = /^[a-f0-9]{4,40}$/;

export const safePath = (f: unknown): f is string => typeof f === "string" && SAFE_PATH.test(f) && !f.split("/").includes("..") && !f.startsWith("/");
export const safeSubkind = (s: unknown): string | undefined => (typeof s === "string" ? s.replace(/[^A-Za-z0-9_.\->+()$]/g, "").slice(0, 40) || undefined : undefined);
const str = (v: unknown, max: number): string | undefined => (typeof v === "string" ? redact(v, max) : undefined);
const isDate = (v: unknown): v is string => typeof v === "string" && !isNaN(new Date(v).getTime());
const num = (v: unknown, d = 0) => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? Math.floor(v) : d);

export function normalizeEvent(raw: unknown): LearningEvent | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const e = raw as Record<string, unknown>;
  const info = typeof e.kind === "string" ? KIND_BY_ID.get(e.kind as never) : undefined;
  if (!info || typeof e.id !== "string" || !HASH.test(e.id) || !safePath(e.file)) return undefined;
  const r = e.resolves as Record<string, unknown> | undefined;
  const resolves =
    r && typeof r.entryId === "string" && /^[a-z0-9-]{1,60}$/.test(r.entryId) && typeof r.classification === "string" && /^[a-z-]{1,40}$/.test(r.classification)
      ? { entryId: r.entryId, classification: r.classification, title: oneLine(typeof r.title === "string" ? r.title : "", 80) }
      : undefined;
  const subkind = safeSubkind(e.subkind);
  const target = str(e.target, 60), before = str(e.before, 240), after = str(e.after, 240), why = str(e.why, 160);
  return {
    id: e.id, kind: info.kind, ...(subkind ? { subkind } : {}), area: info.area, direction: info.direction, file: e.file,
    fileKind: FILE_KINDS.has(e.fileKind as FileKind) ? (e.fileKind as FileKind) : "other", ...(Number.isInteger(e.line) ? { line: e.line as number } : {}),
    ...(before !== undefined ? { before } : {}), ...(after !== undefined ? { after } : {}), ...(target ? { target } : {}), ...(why ? { why } : {}), ...(resolves ? { resolves } : {}),
  };
}

export function normalizeRecord(raw: unknown): CaptureRecord | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const r = raw as Record<string, unknown>;
  if (r.schema !== 1 || !Array.isArray(r.events) || !isDate(r.capturedAt)) return undefined;
  const events = r.events.map(normalizeEvent).filter((e): e is LearningEvent => !!e);
  const files: FileReview[] = (Array.isArray(r.files) ? r.files : [])
    .filter((f): f is Record<string, unknown> => !!f && typeof f === "object" && safePath((f as Record<string, unknown>).file))
    .map((f) => ({
      file: f.file as string,
      fixed: (Array.isArray(f.fixed) ? f.fixed : []).filter((x): x is string => typeof x === "string" && /^[A-Z]+-\d{3}$/.test(x)),
      introduced: (Array.isArray(f.introduced) ? f.introduced : []).filter((x): x is string => typeof x === "string" && /^[A-Z]+-\d{3}$/.test(x)),
    }));
  return {
    schema: 1, capturedAt: r.capturedAt, source: (["staged", "worktree", "commit", "range"] as const).includes(r.source as never) ? (r.source as CaptureRecord["source"]) : "commit",
    ...(typeof r.commit === "string" && HASH.test(r.commit) ? { commit: r.commit } : {}),
    author: typeof r.author === "string" && HASH.test(r.author) ? r.author : "unknown", repo: typeof r.repo === "string" && HASH.test(r.repo) ? r.repo : "unknown", files, events,
  };
}

export const titleOfKind = (kind: string, subkind?: string): string => {
  const t = KIND_BY_ID.get(kind as never)?.title ?? kind;
  return subkind ? `${t} (${subkind})` : t;
};

/** Returns undefined for a pattern file that is not valid; wording, type and area always come from kinds.ts. */
export function normalizePattern(raw: unknown): Pattern | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const p = raw as Record<string, unknown>;
  const kind = typeof p.id === "string" ? p.id.split(":")[0] : "";
  const info = KIND_BY_ID.get(kind as never);
  if (p.schema !== 1 || !info || typeof p.id !== "string" || (p.status !== "approved" && p.status !== "retired") || !isDate(p.approvedAt)) return undefined;
  const subkind = p.id.includes(":") ? safeSubkind(p.id.slice(p.id.indexOf(":") + 1)) : undefined;
  if (p.id !== (subkind ? `${kind}:${subkind}` : kind)) return undefined;
  const ev = (p.evidence ?? {}) as Record<string, unknown>;
  const ex = (p.example ?? undefined) as Record<string, unknown> | undefined;
  const resolves: Record<string, number> = {};
  for (const [k, v] of Object.entries((p.resolves ?? {}) as Record<string, unknown>)) if (/^[a-z0-9-]{1,60}$/.test(k)) resolves[k] = num(v);
  const before = ex ? str(ex.before, 240) : undefined, after = ex ? str(ex.after, 240) : undefined;
  return {
    schema: 1, id: p.id, type: info.direction === "regression" ? "anti-pattern" : "pattern", title: titleOfKind(info.kind, subkind), area: info.area, kind: info.kind, ...(subkind ? { subkind } : {}),
    problem: info.problem, guidance: info.guidance, ...(before !== undefined || after !== undefined ? { example: { ...(before !== undefined ? { before } : {}), ...(after !== undefined ? { after } : {}) } } : {}),
    evidence: {
      events: num(ev.events), files: num(ev.files), authors: num(ev.authors), repos: num(ev.repos),
      firstSeen: isDate(ev.firstSeen) ? ev.firstSeen : p.approvedAt, lastSeen: isDate(ev.lastSeen) ? ev.lastSeen : p.approvedAt,
    },
    resolves, status: p.status, approvedAt: p.approvedAt, approvedBy: oneLine(typeof p.approvedBy === "string" ? p.approvedBy : "", 60) || "unknown",
  };
}
