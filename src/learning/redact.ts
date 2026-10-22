import { SECRET_SHAPE } from "../reviewer/reviewSource";

/**
 * Everything stored in .learnings/ passes through here first. The goal is that
 * a learning record is safe to commit, review in a PR and share across
 * projects: no credentials, no hosts, no addresses - while keeping enough of
 * the code to show what the fix was.
 *
 * This is PATTERN-BASED and therefore best effort. It removes the secret
 * shapes, e-mail addresses, URL hosts, host-like names, query-string secrets
 * and the values typed into password-like fields that it can recognise. It
 * cannot recognise a person's name or free text inside a string literal.
 * Records are reviewed in the pull request that adds them, and
 * `storeStatements: false` in .learnings/config.json keeps only the kind of
 * edit and no code at all.
 */
const MAX = 240;
/** Regexes run on at most this much text: a huge inline blob must not make capture slow. */
const SCAN_LIMIT = 4000;

const SECRETY = "(?:pass(?:word|wd|wort|phrase|code)?|pwd|kennwort|contrase\\w*|mot ?de ?passe|secret|token|api[-_ ]?key|apikey|credential|private[-_ ]?key|access[-_ ]?key|session|cookie|(?<![A-Za-z])(?:pw|pin|otp|auth)(?![A-Za-z]))";
// vendor token shapes that SECRET_SHAPE (the reviewer's) does not cover
const TOKEN_SHAPES = [
  /\bAIza[0-9A-Za-z_-]{20,}\b/g, // Google API key
  /\b(?:sk|rk|pk)_(?:live|test)_[0-9A-Za-z]{10,}\b/g, // Stripe
  /\bgithub_pat_[0-9A-Za-z_]{20,}\b/g,
  /\bgh[pousr]_[0-9A-Za-z]{20,}\b/g,
  /\bnpm_[0-9A-Za-z]{20,}\b/g,
  /\bxox[abprs]-[0-9A-Za-z-]{10,}\b/g, // Slack
  /hooks\.slack\.com\/services\/[A-Za-z0-9/]+/g,
  /\b(?:AccountKey|SharedAccessKey|Password|Pwd)=[^;'"`\s]+/gi, // connection strings
  /\bey[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{5,}\b/g, // JWT
  /\b(?=[A-Za-z0-9+/_=-]*\d)(?=[A-Za-z0-9+/_=-]*[A-Za-z])[A-Za-z0-9+/_=-]{40,}\b/g, // any long mixed token
];
const TLDS = "com|net|org|io|dev|internal|corp|local|lan|intranet|cloud|co|in|uk|de|us|edu|gov|biz|info|app|ai";

export function redact(input: string | undefined, max = MAX): string | undefined {
  if (input === undefined) return undefined;
  let t = input.slice(0, SCAN_LIMIT).replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
  t = t.replace(new RegExp(SECRET_SHAPE.source, "g"), "<secret>");
  for (const r of TOKEN_SHAPES) t = t.replace(r, "<secret>");
  // Authorization-style values: Bearer / Basic / Token <value>, any case
  t = t.replace(/\b(Bearer|Basic|Token)\s+[A-Za-z0-9._~+/=-]{6,}/gi, "$1 <secret>");
  // query-string secrets: ?access_token=..., &password=...
  t = t.replace(new RegExp(`([?&][\\w-]*${SECRETY}[\\w-]*=)[^&\\s'"\`)]+`, "gi"), "$1<redacted>");
  // a value typed into a password-like field: locator('#pw').fill('x'), getByLabel('Passwort').fill('x')
  t = t.replace(new RegExp(`(${SECRETY}[^;\\n]{0,80}?\\.(?:fill|type|pressSequentially)\\()(['"\`])[^'"\`]*\\2`, "gi"), "$1$2<redacted>$2");
  // page.fill('#password', 'x'): the selector, not the locator, names the field
  t = t.replace(new RegExp(`(\\.(?:fill|type)\\(\\s*['"\`][^'"\`]*${SECRETY}[^'"\`]*['"\`]\\s*,\\s*)(['"\`])[^'"\`]*\\2`, "gi"), "$1$2<redacted>$2");
  // password = '...', { pass: '...' }
  t = t.replace(new RegExp(`(\\b\\w*${SECRETY}\\w*['"]?\\s*[:=]\\s*)(['"\`])[^'"\`]*\\2`, "gi"), "$1$2<redacted>$2");
  // e-mail addresses
  if (t.includes("@")) t = t.replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, "<email>");
  // URL hosts (keep the path, it is often the point of the fix)
  t = t.replace(/\b(https?:\/\/)[^/\s'"`)]+/gi, "$1<host>");
  t = t.replace(/(^|[\s'"`(=/])\/\/(?!\/)[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, "$1//<host>");
  // host-like names without a scheme
  t = t.replace(new RegExp(`\\b(?:[a-z0-9-]+\\.)+(?:${TLDS})\\b`, "gi"), "<host>");
  // IPv4 addresses, long digit runs, spaced card numbers, phone-like groups
  t = t.replace(/\b\d{1,3}(?:\.\d{1,3}){3}\b/g, "<ip>");
  t = t.replace(/\b(?:\d[ -]?){12,19}\b/g, "<number>");
  t = t.replace(/\+?\b\d{2,4}[ -]\d{3,5}[ -]\d{3,5}\b/g, "<number>");
  return t.length > max ? t.slice(0, max - 1) + "…" : t;
}

/** Safe for use as a single-line fragment in generated markdown. */
export const oneLine = (s: string | undefined, max = 120): string => (redact(s, max) ?? "").replace(/[`<>]/g, "'");
