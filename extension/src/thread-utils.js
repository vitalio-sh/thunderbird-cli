/**
 * Pure utility functions for email thread resolution.
 * Extracted from background.js so they can be unit-tested outside Thunderbird.
 */

/**
 * Parse a named header from an RFC 2822 message string.
 * Handles header folding (multi-line headers joined by CRLF + whitespace).
 */
export function parseHeader(raw, name) {
  const headerSection = raw.split(/\r?\n\r?\n/)[0] ?? "";
  const unfolded = headerSection.replace(/\r?\n[ \t]+/g, " ");
  const m = unfolded.match(new RegExp(`^${name}:[ \t]*(.+)`, "im"));
  return m ? m[1].trim() : "";
}

/** Strip angle brackets from a single Message-ID token: <id@host> → id@host */
export function stripAngleBrackets(s) {
  return s.trim().replace(/^<|>$/g, "").trim();
}

/**
 * Extract all Message-ID tokens from a References header value.
 * Strips angle brackets from each.
 */
export function parseReferences(refsHeader) {
  return (refsHeader.match(/<[^>]+>/g) ?? []).map(stripAngleBrackets);
}

/**
 * Normalize an email subject for thread search.
 * Strips any number of leading reply/forward prefixes and [list-name] tags.
 *
 * Examples:
 *   "Re: WG: [All-ipp-intern] Call for Participants" → "Call for Participants"
 *   "AW: Fwd: Re: Topic"                            → "Topic"
 */
export function normalizeSubject(subject) {
  return subject
    .trim()
    .replace(/^((Re|WG|AW|Fwd?|FW|Sv|Vs|Ref):\s*|\[[^\]]*\]\s*)*/gi, "")
    .trim();
}

/**
 * Build the set of Message-ID strings to query for upstream thread members.
 * Returns IDs without angle brackets.
 */
export function buildThreadIds(raw) {
  const refs = parseReferences(parseHeader(raw, "References"));
  const inReply = stripAngleBrackets(parseHeader(raw, "In-Reply-To"));
  const msgHdrId = stripAngleBrackets(parseHeader(raw, "Message-ID"));
  return new Set([...refs, inReply, msgHdrId].filter(Boolean));
}
