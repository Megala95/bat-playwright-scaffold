import fs from "fs";
import path from "path";
import { SKILL_AREAS, isSkillArea } from "./skillAreas";

/**
 * The write side of the continuous-improvement loop
 * (.github/skills/continuous-improvement/SKILL.md). Any agent - or a human
 * reviewing its output - calls this the moment a skill's guidance turned
 * out to be wrong, missing, or had to be corrected, so the signal is never
 * lost to "I'll log it later."
 *
 * Usage: npm run log-correction -- <skillArea> <testFileOrDslFile> "<note>"
 */
const LOG_FILE = path.join(__dirname, "..", "..", "skill-corrections.jsonl");

interface CorrectionEntry {
  timestamp: string;
  skillArea: string;
  file: string;
  note: string;
}

/**
 * `file` is logged verbatim and, in principle, could later be opened by
 * something that trusts this file (a report generator, a script-curator
 * agent). Since agents call this CLI autonomously, guard against a
 * malformed or adversarial-looking value up front rather than assuming
 * every caller passes a clean repo-relative path: no absolute paths, no
 * `..` segments, and only characters that a real repo path would actually
 * contain.
 */
const SAFE_FILE_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9_.\-/]*[A-Za-z0-9])?$/;

/** Exported for tests/meta/unit.spec.ts - this is the actual security boundary, worth covering directly. */
export function isSafeFileRef(file: string): boolean {
  if (path.isAbsolute(file)) return false;
  if (file.split(/[\\/]/).includes("..")) return false;
  return SAFE_FILE_PATTERN.test(file);
}

function main() {
  const [, , skillArea, file, note] = process.argv;

  if (!skillArea || !file || !note) {
    console.error('Usage: npm run log-correction -- <skillArea> <testFileOrDslFile> "<note>"');
    console.error(`Valid skillArea values: ${SKILL_AREAS.join(", ")}`);
    process.exit(1);
  }

  if (!isSafeFileRef(file)) {
    console.error(`"${file}" doesn't look like a safe, relative repo path.`);
    console.error("No absolute paths, no \"..\" segments - pass it as it appears in the repo,");
    console.error('e.g. "output/dsl/testcases/TC-1042.dsl.json".');
    process.exit(1);
  }

  if (!isSkillArea(skillArea)) {
    console.error(`"${skillArea}" is not a recognized skill area.`);
    console.error(`Valid values: ${SKILL_AREAS.join(", ")}`);
    console.error(
      "If this correction genuinely doesn't fit any of them, that's itself a signal - " +
        "raise it in the next improvement review rather than force-fitting a tag."
    );
    process.exit(1);
  }

  const entry: CorrectionEntry = {
    timestamp: new Date().toISOString(),
    skillArea,
    file,
    note,
  };

  fs.appendFileSync(LOG_FILE, JSON.stringify(entry) + "\n");
  console.log(`[log-correction] Logged (${skillArea}): ${note}`);
}

if (require.main === module) {
  main();
}
