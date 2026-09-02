import { useEffect, useRef, useState } from 'react';

// Keeps each Python editor's contents across reloads.
//
// Without this, a reload silently destroyed everything a student had written --
// the single worst failure mode for actual classroom use, and one with no
// recovery, since nothing here is saved to a server by design. localStorage is
// the right store precisely because this app has no backend: the work belongs
// to the browser tab it was written in.
//
// Storage is treated as a convenience that may simply not exist. Private
// windows, blocked site data, and quota exhaustion all make these calls THROW
// rather than return null, so every access is guarded -- a student in a private
// window gets an app that works and forgets, never an app that fails to load.
const NAMESPACE = 'polyraptor:v1:';

// Writing on every keystroke would hammer a synchronous, main-thread API while
// someone is typing. A short debounce keeps it off the critical path without
// risking meaningful loss.
const WRITE_DEBOUNCE_MS = 400;

export type SourceSlot =
  | 'search-problem'
  | 'search-algorithm'
  | 'search-heuristic'
  | 'sort-problem'
  | 'sort-algorithm'
  | 'sort-comparator'
  | 'sort-comparator-values';

function readStored(slot: SourceSlot): string | null {
  try {
    return window.localStorage.getItem(NAMESPACE + slot);
  } catch {
    return null;
  }
}

function writeStored(slot: SourceSlot, value: string): void {
  try {
    window.localStorage.setItem(NAMESPACE + slot, value);
  } catch {
    // Quota exceeded, or storage blocked entirely. Losing persistence is
    // acceptable; taking the editor down over it is not.
  }
}

export function clearStoredSource(slot: SourceSlot): void {
  try {
    window.localStorage.removeItem(NAMESPACE + slot);
  } catch {
    /* nothing to do */
  }
}

// ---- displaced drafts ------------------------------------------------------
// A shared link wins over whatever you had saved in that slot, which is the
// right precedence -- someone was just handed this specific code and expects
// to see it -- but it used to mean the draft underneath was destroyed on
// arrival, silently and with no way back. Verified rather than assumed: type
// into the search Problem editor, leave, open a `search-problem` share link,
// and the stored draft is the shared source 400ms later, with no copy anywhere
// in storage. "Reset to template" gives you the template, not your work, and
// the `?shared=` param is stripped once consumed so the URL can't be re-read
// either.
//
// So the displaced draft is set aside under its own key before the shared
// value takes over, and the panel offers it back. This is the same shape of
// answer as "Reset to template" above, for the same reason: once edits survive
// reloads, anything that replaces them needs a way back.
const DISPLACED_SUFFIX = ':displaced';

function readDisplaced(slot: SourceSlot): string | null {
  try {
    return window.localStorage.getItem(NAMESPACE + slot + DISPLACED_SUFFIX);
  } catch {
    return null;
  }
}

function writeDisplaced(slot: SourceSlot, value: string): void {
  try {
    window.localStorage.setItem(NAMESPACE + slot + DISPLACED_SUFFIX, value);
  } catch {
    /* storage full or blocked -- the draft is still on screen, just not backed up */
  }
}

export function clearDisplacedSource(slot: SourceSlot): void {
  try {
    window.localStorage.removeItem(NAMESPACE + slot + DISPLACED_SUFFIX);
  } catch {
    /* nothing to do */
  }
}

// Precedence: a shared link wins (someone was just handed this specific code
// and expects to see it), then whatever was last typed here, then the template.
export function usePersistedSource(
  slot: SourceSlot,
  sharedValue: string | undefined,
  template: string
): [string, (next: string) => void, () => void, string | null] {
  const [value, setValue] = useState(() => sharedValue ?? readStored(slot) ?? template);

  // What a shared link is about to displace, if anything -- computed here in
  // the initializer rather than in an effect because the notice that offers it
  // back is a CHILD, and a child's render runs before the parent's effects. An
  // effect would set this after the notice had already decided there was
  // nothing to show.
  //
  // Last-wins when a second link arrives: the stored value is always "what was
  // on screen until this link replaced it", which is the thing the notice
  // offers back and the most recent work at risk. Preferring the oldest backup
  // instead would protect a draft the user has already been offered once while
  // discarding everything they did afterwards.
  const [displaced] = useState<string | null>(() => {
    const previous = readStored(slot);
    const replacedByShare =
      sharedValue !== undefined && previous !== null && previous !== sharedValue && previous !== template;
    // A leftover from an earlier visit is still offered: the notice survives
    // reloads until it is acted on, so someone who missed it on arrival can
    // still recover the next day.
    return replacedByShare ? previous : readDisplaced(slot);
  });

  useEffect(() => {
    if (displaced !== null) writeDisplaced(slot, displaced);
  }, [slot, displaced]);

  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Read by the pagehide flush below, which must see the newest value without
  // re-subscribing its listener on every keystroke.
  const latest = useRef(value);
  latest.current = value;

  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => writeStored(slot, value), WRITE_DEBOUNCE_MS);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [slot, value]);

  // Flush immediately when the page goes away. The debounce above means an edit
  // made in the last 400ms before a close, reload, or tab switch would otherwise
  // be silently dropped -- which is precisely when someone finishes a thought
  // and leaves. `pagehide` fires on navigation and on mobile backgrounding;
  // `visibilitychange` covers tab switches, where `unload` is unreliable and
  // does not fire at all on bfcache restores.
  useEffect(() => {
    const flush = () => writeStored(slot, latest.current);
    const onHidden = () => {
      if (document.visibilityState === 'hidden') flush();
    };
    window.addEventListener('pagehide', flush);
    document.addEventListener('visibilitychange', onHidden);
    return () => {
      window.removeEventListener('pagehide', flush);
      document.removeEventListener('visibilitychange', onHidden);
    };
  }, [slot]);

  // Explicit escape hatch back to the starting template. Necessary *because* of
  // persistence: once edits survive reloads, a student who has mangled the
  // template past recognition otherwise has no way back to a working example.
  const reset = () => {
    clearStoredSource(slot);
    setValue(template);
  };

  return [value, setValue, reset, displaced];
}
