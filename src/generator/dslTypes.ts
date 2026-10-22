/**
 * A minimal, ILLUSTRATIVE DSL shape - just enough to drive generateSpec.ts
 * and give the generator regression test (tests/meta/generator-regression.spec.ts)
 * something concrete to check against.
 *
 * This is NOT a copy of the project's real `governance/dsl-schema.json` -
 * that file lives in the target autopilot-ui repo and wasn't shared into
 * this scaffold (see README, "Before you run this"). When wiring this
 * generator up to the real schema, adjust these types - and
 * generateSpec.ts's field reads - to match it; the golden-file regression
 * pattern in tests/meta/ stays the same either way, only the shape it
 * reads changes.
 */
export type DslActionStep =
  | { kind: "goto" }
  | {
      kind: "act";
      locatorKey: string;
      action: "fill" | "clear" | "pickDate" | "selectOption" | "check" | "uncheck" | "click";
      value?: string;
    }
  | {
      kind: "verify";
      locatorKey: string;
      action: "assertText" | "assertVisible";
      expected?: string;
      exact?: boolean;
    };

export interface DslTestCase {
  /** Also used as the generated test's title. */
  name: string;
  /** Appended to the describe block title, e.g. "@generated". */
  tag: string;
  /** Must name a Page Object class exported from src/pages/<pageObject>.ts. */
  pageObject: string;
  steps: DslActionStep[];
}
