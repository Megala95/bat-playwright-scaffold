import { test, expect } from "@playwright/test";
import fs from "fs";
import path from "path";
import { SKILL_AREAS } from "../../src/utils/skillAreas";

/**
 * Structural checks on the Copilot assets (.github/agents, skills, prompts), so
 * a renamed agent, a broken link or an over-long description fails in CI instead
 * of silently making Copilot ignore the file. They check structure, not whether
 * the instructions are good - that needs a human (or the skill-curator loop).
 */
const ROOT = path.join(__dirname, "..", "..");
const GH = path.join(ROOT, ".github");

function frontmatter(file: string): { data: Record<string, string>; body: string } {
  const text = fs.readFileSync(file, "utf-8");
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!m) throw new Error(`${file} has no frontmatter`);
  const data: Record<string, string> = {};
  for (const line of m[1].split(/\r?\n/)) {
    const kv = line.match(/^([A-Za-z-]+):\s*(.*)$/);
    if (kv) data[kv[1]] = kv[2].trim();
  }
  return { data, body: m[2] };
}

const agentFiles = fs.readdirSync(path.join(GH, "agents")).filter((f) => f.endsWith(".agent.md"));
const agentNames = agentFiles.map((f) => f.replace(/\.agent\.md$/, ""));
const skillDirs = fs.readdirSync(path.join(GH, "skills"), { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name);
const promptFiles = fs.readdirSync(path.join(GH, "prompts")).filter((f) => f.endsWith(".prompt.md"));

test.describe("agents @meta", () => {
  for (const file of agentFiles) {
    test(`${file}: name matches the file, has a description, handoffs exist`, () => {
      const { data } = frontmatter(path.join(GH, "agents", file));
      expect(data.name).toBe(file.replace(/\.agent\.md$/, ""));
      expect(data.description.length).toBeGreaterThan(20);
      const handoffs = (data.handoffs ?? "[]").replace(/[\[\]'" ]/g, "").split(",").filter(Boolean);
      for (const h of handoffs) expect(agentNames, `${file} hands off to unknown agent "${h}"`).toContain(h);
    });
  }

  test("the handoff chain reaches stabilizer from step-parser with no cycles", () => {
    const next = (n: string) =>
      (frontmatter(path.join(GH, "agents", `${n}.agent.md`)).data.handoffs ?? "[]").replace(/[\[\]'" ]/g, "").split(",").filter(Boolean);
    const seen: string[] = [];
    let cur = "step-parser";
    while (cur) {
      expect(seen, `cycle at ${cur}`).not.toContain(cur);
      seen.push(cur);
      cur = next(cur)[0];
    }
    expect(seen).toEqual(["step-parser", "locator-strategist", "script-generator", "script-reviewer", "stabilizer"]);
  });
});

test.describe("skills @meta", () => {
  for (const dir of skillDirs) {
    test(`${dir}: SKILL.md is valid and its links resolve`, () => {
      const file = path.join(GH, "skills", dir, "SKILL.md");
      const { data, body } = frontmatter(file);
      expect(data.name).toBe(dir);
      expect(data.description.length).toBeGreaterThan(40);
      expect(data.description.length, "description limit is 1024 chars").toBeLessThanOrEqual(1024);
      expect(fs.readFileSync(file, "utf-8").split("\n").length, "keep SKILL.md under ~500 lines; move detail to references/").toBeLessThanOrEqual(500);
      expect(body).toContain("## Changelog");
      for (const m of body.matchAll(/\]\((\.\/[^)#]+)(?:#[^)]*)?\)/g)) {
        expect(fs.existsSync(path.join(GH, "skills", dir, m[1])), `${dir}: broken link ${m[1]}`).toBe(true);
      }
    });
  }

  test("a skill that keeps its changelog in references/ links to a file that exists and has entries", () => {
    for (const dir of skillDirs) {
      const body = fs.readFileSync(path.join(GH, "skills", dir, "SKILL.md"), "utf-8");
      const link = body.split("## Changelog")[1]?.match(/\]\((\.\/references\/changelog\.md)\)/);
      if (!link) continue;
      const file = path.join(GH, "skills", dir, link[1]);
      expect(fs.existsSync(file), `${dir}: ${link[1]} missing`).toBe(true);
      expect(fs.readFileSync(file, "utf-8"), `${dir}: changelog has no dated entries`).toMatch(/^- \d{4}-\d{2}-\d{2}/m);
    }
  });

  test("failure-healing documents every verdict the healer can emit, in the stated priority order", () => {
    const types = fs.readFileSync(path.join(ROOT, "src", "healer", "types.ts"), "utf-8");
    const union = types.match(/export type Verdict =([^;]+);/)![1];
    const verdicts = [...union.matchAll(/"([a-z-]+)"/g)].map((m) => m[1]);
    expect(verdicts.length).toBeGreaterThan(3);
    const body = fs.readFileSync(path.join(GH, "skills", "failure-healing", "SKILL.md"), "utf-8");
    for (const v of verdicts) expect(body, `verdict "${v}" is not in the skill's table`).toContain(`| \`${v}\` |`);
    const priority = body.match(/\*\*Priority\.\*\*[^\n]*\n?[^\n]*\n/)?.[0] ?? "";
    const stated = [...priority.matchAll(/`([a-z-]+)`/g)].map((m) => m[1]).filter((v) => verdicts.includes(v));
    expect(stated, "priority line must list every verdict exactly once").toEqual(["broken-run", "no-results", "environment-suspect", "heal-tests", "flaky-only", "healthy"]);
    expect([...stated].sort()).toEqual([...verdicts].sort());
  });

  test("the verdict priority matches the code: a run that died before any test beats everything, a clean run is last", async () => {
    const { analyzeReport } = await import("../../src/healer/analyzeResults");
    const run = (r: object) => analyzeReport(r as never).verdict;
    expect(run({ errors: [{ message: "boom" }] })).toBe("broken-run");
    expect(run({})).toBe("no-results");
    const ok = { suites: [{ title: "a.ts", file: "a.ts", specs: [{ title: "t", file: "a.ts", tests: [{ status: "expected", results: [{ status: "passed" }] }] }] }] };
    expect(run(ok)).toBe("healthy");
    expect(run({ ...ok, errors: [{ message: "teardown failed" }] })).toBe("broken-run");
  });

  test("skills the user can invoke give an argument-hint when they take arguments", () => {
    for (const dir of ["failure-healing", "script-review"]) {
      expect(frontmatter(path.join(GH, "skills", dir, "SKILL.md")).data["argument-hint"], dir).toBeTruthy();
    }
  });

  test("every continuous-improvement skill area has a skill folder, except none are orphaned", () => {
    for (const area of SKILL_AREAS) expect(skillDirs, `no skill folder for area "${area}"`).toContain(area);
  });

  test("every skill area appears in the continuous-improvement skill's table", () => {
    const body = fs.readFileSync(path.join(GH, "skills", "continuous-improvement", "SKILL.md"), "utf-8");
    for (const area of SKILL_AREAS) expect(body, `area "${area}" missing from the table`).toContain(`\`${area}\``);
  });
});

test.describe("prompts @meta", () => {
  for (const file of promptFiles) {
    test(`${file}: has a description and refers only to agents that exist`, () => {
      const { data, body } = frontmatter(path.join(GH, "prompts", file));
      expect(data.description.length).toBeGreaterThan(20);
      for (const m of body.matchAll(/`#([a-z-]+)`/g)) expect(agentNames, `${file} refers to unknown agent #${m[1]}`).toContain(m[1]);
    });
  }
});

test.describe("scripts referenced by the assets exist in package.json @meta", () => {
  test("every `npm run <script>` mentioned in .github exists", () => {
    const scripts = Object.keys(JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf-8")).scripts);
    const walk = (d: string): string[] =>
      fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));
    for (const f of walk(GH).filter((x) => /\.(md|yml)$/.test(x))) {
      for (const m of fs.readFileSync(f, "utf-8").matchAll(/npm run ([a-z][a-z:-]*)/g)) {
        expect(scripts, `${path.relative(ROOT, f)} mentions "npm run ${m[1]}", which is not in package.json`).toContain(m[1]);
      }
    }
  });
});
