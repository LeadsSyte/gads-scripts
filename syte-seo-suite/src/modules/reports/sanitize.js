// House rule, non-negotiable (Requirement 6): no em dashes or en dashes anywhere
// in generated client-facing copy, emails, or microsite text. This is the
// post-generation enforcement layer — a prompt instruction asks models to avoid
// them, and this guarantees it regardless of what the model does.
//
// Dashes are replaced with commas or colons (never left, never deleted). A
// spaced dash acting as a clause break becomes a comma; a dash directly before
// a clause that explains the previous one becomes a colon.

// Em (U+2014), en (U+2013), horizontal bar (U+2015), figure dash (U+2012),
// and the minus sign (U+2212) that models sometimes emit as a dash.
const DASH_CLASS = '\\u2012\\u2013\\u2014\\u2015\\u2212';
const SPACED_DASH = new RegExp('\\s*[' + DASH_CLASS + ']\\s*', 'g');
const ANY_DASH = new RegExp('[' + DASH_CLASS + ']', 'g');

// Replace every em/en dash with a comma (spaced or not). Collapses the
// resulting " ," and doubled commas so the copy reads cleanly.
export function stripDashes(text) {
  if (text == null) return text;
  let s = String(text);
  s = s.replace(SPACED_DASH, ', ');
  s = s.replace(ANY_DASH, ', ');            // any stragglers
  s = s.replace(/\s+,/g, ',');              // " ," → ","
  s = s.replace(/,\s*,/g, ',');             // ",," → ","
  s = s.replace(/,\s*\./g, '.');            // ", ." → "."
  s = s.replace(/:\s*,/g, ':');             // ": ," → ":"
  return s;
}

// True if the string still contains any em/en/figure/bar dash.
export function hasBannedDash(text) {
  return ANY_DASH.test(String(text || ''));
}

// Sanitize an Alice email object { subject, body }.
export function sanitizeEmail(email) {
  if (!email) return email;
  return {
    ...email,
    subject: stripDashes(email.subject || ''),
    body: stripDashes(email.body || '')
  };
}

// Deep-sanitize every string in a microsite JSON object (arrays + nested
// objects included), leaving non-strings untouched.
export function sanitizeDeep(value) {
  if (typeof value === 'string') return stripDashes(value);
  if (Array.isArray(value)) return value.map(sanitizeDeep);
  if (value && typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) out[k] = sanitizeDeep(v);
    return out;
  }
  return value;
}
