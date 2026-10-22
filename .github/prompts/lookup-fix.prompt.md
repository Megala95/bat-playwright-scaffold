---
description: Look up what is already known about a failing or flaky script - catalog diagnosis plus the fixes engineers here have applied before.
argument-hint: the problem in your words, or the pasted error message
---

Run `npm run lookup-fix -- "${input:problem}"` and summarise the top results for me:
what the failure most likely is, the fix to try first, and any "learned here" fixes
(what engineers on this project actually did). Check each suggestion against the evidence
(error text, trace, DOM) before applying it, and say which one you would try first and why.
If nothing matches, say so - do not guess a fix from memory.
