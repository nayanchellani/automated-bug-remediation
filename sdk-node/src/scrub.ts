/**
 * PII scrubber: cleans emails, bearer tokens, and query-string secrets.
 * Pure string function with no Node or DOM dependencies, shared by the Node and browser entries.
 */
export function scrub(text: string): string {
  if (!text) return text
  try {
    return text
      // Emails
      .replace(/[a-zA-Z0-9_.+-]+@[a-zA-Z0-9-]+\.[a-zA-Z0-9-.]+/g, '[EMAIL]')
      // Bearer tokens & JWTs
      .replace(/Bearer\s+[A-Za-z0-9\-_.~+/]+=*/gi, 'Bearer [REDACTED]')
      .replace(/ey[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g, '[JWT]')
      // Common secret query params or keys: token=..., secret=..., password=..., api_key=...
      .replace(/([?&](?:token|access_token|secret|password|api_key|apiKey|key)=)([^& \t\r\n]+)/gi, '$1[REDACTED]')
      // JSON / object key secrets: "password": "...", "secret": "..."
      .replace(/(["']?(?:token|access_token|secret|password|api_key|apiKey)["']?\s*[:=]\s*["'])([^"']+)(["'])/gi, '$1[REDACTED]$3')
  } catch {
    return text
  }
}
