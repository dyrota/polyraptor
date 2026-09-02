// Encodes exactly one authored-code slot as a URL query param so it can move
// from one person to another with no backend -- the "instructor gives
// students a problem" / "student receives an algorithm to fix" classroom
// scenario. Plain JSON in the query string, percent-encoded automatically by
// URLSearchParams (never manually, to avoid double-encoding), not base64:
// simpler, no UTF-8 footgun, and teaching-sized Python source comfortably
// fits a query string with no compression needed.
export type SharedKind = 'search-problem' | 'search-algorithm' | 'search-heuristic' | 'sort-problem' | 'sort-algorithm' | 'sort-comparator';

export interface SharedPayload {
  kind: SharedKind;
  source: string;
  values?: number[]; // only meaningful for 'sort-comparator'
}

export const SHARE_KIND_TAB: Record<SharedKind, 'search' | 'sort'> = {
  'search-problem': 'search',
  'search-algorithm': 'search',
  'search-heuristic': 'search',
  'sort-problem': 'sort',
  'sort-algorithm': 'sort',
  'sort-comparator': 'sort',
};

export function buildShareUrl(payload: SharedPayload): string {
  const url = new URL(window.location.href);
  url.search = '';
  url.searchParams.set('shared', JSON.stringify(payload));
  return url.toString();
}

// Reads and validates the `shared` param from the current URL. Deliberately
// permissive about what "invalid" means beyond basic shape -- a garbled or
// hand-edited link should just fall back to normal template-based authoring,
// not show an error page for what's ultimately a nice-to-have UX shortcut.
export function decodeSharedFromLocation(): SharedPayload | null {
  const raw = new URLSearchParams(window.location.search).get('shared');
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      typeof parsed.kind === 'string' &&
      parsed.kind in SHARE_KIND_TAB &&
      typeof parsed.source === 'string'
    ) {
      // `values` is optional, so its ABSENCE is fine -- but a present one that
      // isn't an array of numbers is not, and a blanket `parsed as SharedPayload`
      // waved it through. SortPanel does `shared.values.join(', ')` on render, so
      // a hand-edited link carrying a string there threw a TypeError mid-render
      // and dropped the whole app into the root error boundary: precisely the
      // "error page for what's ultimately a nice-to-have shortcut" this
      // decoder's permissiveness exists to avoid. Dropped rather than rejected,
      // since the source is still worth honouring and the values field just
      // falls back to its default.
      const values: number[] | undefined =
        Array.isArray(parsed.values) && parsed.values.every((v: unknown) => typeof v === 'number' && Number.isFinite(v))
          ? parsed.values
          : undefined;
      // Rebuilt field by field rather than returned wholesale, so nothing that
      // was never validated rides along under the SharedPayload name.
      return values === undefined
        ? { kind: parsed.kind, source: parsed.source }
        : { kind: parsed.kind, source: parsed.source, values };
    }
  } catch {
    // malformed -- fall through to null
  }
  return null;
}
