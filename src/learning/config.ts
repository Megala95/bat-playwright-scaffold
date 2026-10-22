import fs from "fs";
import path from "path";
import { LearningConfig } from "./types";

export const LEARN_DIR = ".learnings";
export const EVENTS_DIR = `${LEARN_DIR}/events`;
export const PATTERNS_DIR = `${LEARN_DIR}/patterns`;

export const DEFAULT_CONFIG: LearningConfig = {
  minEvents: 3,
  minFiles: 2,
  minAuthors: 2,
  watchEvents: 3,
  include: ["^tests/", "^src/pages/", "^src/locators/", "^output/automation/"],
  exclude: ["^tests/meta/", "^tests/fixtures/", "node_modules/", "\\.d\\.ts$"],
  salt: "bat-learning",
  storeStatements: true,
};

/** .learnings/config.json overrides the defaults field by field; a broken file is reported, not ignored. */
export function loadConfig(root: string): LearningConfig {
  const p = path.join(root, LEARN_DIR, "config.json");
  if (!fs.existsSync(p)) return { ...DEFAULT_CONFIG, salt: process.env.BAT_LEARN_SALT || DEFAULT_CONFIG.salt };
  let raw: Partial<LearningConfig>;
  try {
    raw = JSON.parse(fs.readFileSync(p, "utf-8"));
  } catch (e) {
    throw new Error(`${LEARN_DIR}/config.json is not valid JSON: ${(e as Error).message}`);
  }
  const cfg = { ...DEFAULT_CONFIG, ...raw };
  if (process.env.BAT_LEARN_SALT) cfg.salt = process.env.BAT_LEARN_SALT;
  if (typeof cfg.storeStatements !== "boolean") throw new Error(`${LEARN_DIR}/config.json: "storeStatements" must be true or false`);
  for (const k of ["minEvents", "minFiles", "minAuthors", "watchEvents"] as const) {
    if (!Number.isInteger(cfg[k]) || cfg[k] < 1) throw new Error(`${LEARN_DIR}/config.json: "${k}" must be an integer >= 1`);
  }
  for (const k of ["include", "exclude"] as const) {
    if (!Array.isArray(cfg[k])) throw new Error(`${LEARN_DIR}/config.json: "${k}" must be an array of regular expressions`);
    for (const r of cfg[k]) {
      try { new RegExp(r); } catch { throw new Error(`${LEARN_DIR}/config.json: "${k}" has an invalid regular expression: ${r}`); }
    }
  }
  return cfg;
}

export const isLearnable = (file: string, cfg: LearningConfig) =>
  cfg.include.some((r) => new RegExp(r).test(file)) && !cfg.exclude.some((r) => new RegExp(r).test(file));
