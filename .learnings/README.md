# .learnings

The project's shared memory of how generated scripts get fixed. Read the
**fix-knowledge-base** skill (`.github/skills/fix-knowledge-base/SKILL.md`) first.

- `events/` - one small JSON file per capture (what kind of edit, the redacted statement before and after, a salted author hash). Written by `npm run learn-capture` (the git hook or CI). Committed; never edit by hand.
- `patterns/` - patterns a named person approved with `npm run learn-approve`. Committed; reviewed in a pull request. `npm run learn-publish` turns them into each skill's `references/learned-patterns.md`.
- `config.json` - thresholds (a pattern needs `minEvents` edits in `minFiles` files by `minAuthors` engineers), which files are learned from, and the author-hash salt.

Records are redacted (secret shapes, e-mail addresses, hosts, values typed into password-like fields) but redaction is pattern-based: it cannot recognise a person's name inside a string. Review them in the pull request. `storeStatements: false` keeps only the kind of edit. If a record ever contains something it should not, delete that file; `BAT_LEARN_SALT` keeps the author-hash salt out of the repository.
