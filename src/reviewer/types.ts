export type Severity = "error" | "warning" | "info";
export type Category = "synchronization" | "test-data" | "locator" | "verification" | "hygiene" | "security";

export interface RuleInfo {
  id: string;
  category: Category;
  severity: Severity;
  title: string;
  /** Why this matters - shown to the person reading the report. */
  why: string;
}

export interface Finding {
  ruleId: string;
  category: Category;
  severity: Severity;
  file: string;
  line: number;
  column: number;
  message: string;
  /** What to change. Specific to the code that triggered the rule. */
  suggestion: string;
  snippet: string;
}

export interface ReviewReport {
  generatedAt: string;
  files: number;
  counts: { error: number; warning: number; info: number };
  byCategory: Record<string, number>;
  findings: Finding[];
}
