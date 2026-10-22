import { execFileSync } from "child_process";
import fs from "fs";
import path from "path";

/**
 * npm run learn-install-hook [-- --uninstall]
 *
 * Points this clone's git at .githooks/ (core.hooksPath). Per clone, opt-in:
 * nothing is installed behind an engineer's back, and the hook never blocks a
 * commit. Without the hook, CI captures the same edits from the pull request
 * (.github/workflows/learning.yml), just without the local-only ones.
 */
export function main(argv = process.argv.slice(2), cwd = process.cwd()): number {
  const run = (args: string[]) => execFileSync("git", args, { cwd, encoding: "utf-8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  try {
    const top = run(["rev-parse", "--show-toplevel"]);
    if (argv.includes("--uninstall")) {
      try { run(["config", "--unset", "core.hooksPath"]); } catch { /* already unset */ }
      console.log("learn-install-hook: removed (core.hooksPath unset).");
      return 0;
    }
    const hook = path.join(top, ".githooks", "pre-commit");
    if (!fs.existsSync(hook)) {
      console.error("learn-install-hook: .githooks/pre-commit not found in this repository.");
      return 2;
    }
    fs.chmodSync(hook, 0o755);
    let existing = "";
    try { existing = run(["config", "--get", "core.hooksPath"]); } catch { /* unset */ }
    if (existing && existing !== ".githooks") {
      console.error(`learn-install-hook: core.hooksPath is already "${existing}". Not changing it; call .githooks/pre-commit from your hook manager instead.`);
      return 2;
    }
    run(["config", "core.hooksPath", ".githooks"]);
    console.log("learn-install-hook: installed. Commits touching tests/, src/pages/ or src/locators/ now record learning events (BAT_LEARN=0 skips one commit).");
    return 0;
  } catch (e) {
    console.error(`learn-install-hook: ${(e as { stderr?: string }).stderr || (e as Error).message}`);
    return 2;
  }
}

if (require.main === module) process.exit(main());
