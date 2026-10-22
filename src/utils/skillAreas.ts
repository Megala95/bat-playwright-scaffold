/**
 * The ten skill areas tracked by the continuous-improvement loop
 * (.github/skills/continuous-improvement/SKILL.md). Single source of truth
 * so log-correction and analyze-skills can't drift out of sync with each
 * other or with the skill folders actually on disk.
 */
export const SKILL_AREAS = [
  "dsl-governance",
  "locator-source-strategy",
  "locator-naming-convention",
  "framework-scaffolding",
  "assertion-strategy",
  "verification-strategy",
  "synchronization-strategy",
  "execution-stabilization",
  "failure-healing",
  "script-review",
] as const;

export type SkillArea = (typeof SKILL_AREAS)[number];

export function isSkillArea(value: string): value is SkillArea {
  return (SKILL_AREAS as readonly string[]).includes(value);
}
