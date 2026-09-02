import { useState } from 'react';
import { clearDisplacedSource, type SourceSlot } from './persistentState';

// Offers back the draft a shared link replaced.
//
// Deliberately a quiet inline strip rather than a modal: arriving on a shared
// link should stay frictionless -- the classroom case is an instructor sending
// a problem and a student clicking it -- so this states what happened and gets
// out of the way. It is only ever shown when there is genuinely something to
// restore, so it cannot become background noise.
//
// `entries` rather than a single slot because one share payload can displace
// two slots at once: a `sort-comparator` link carries both the comparator
// source and the values to run it on, and offering those back separately would
// make a student restore half their work and wonder where the rest went.
export interface DisplacedEntry {
  slot: SourceSlot;
  displaced: string | null;
  onRestore: (value: string) => void;
}

export function DisplacedDraftNotice({ label, entries }: { label: string; entries: DisplacedEntry[] }) {
  const [resolved, setResolved] = useState(false);
  const pending = entries.filter((e) => e.displaced !== null);
  if (resolved || pending.length === 0) return null;

  // Both paths clear the backup: restoring puts the draft back in the editor
  // (where the normal debounce persists it again), and dismissing is the
  // user saying they do not want it. Leaving the key behind either way would
  // make the notice reappear on the next reload having already been answered.
  const finish = () => {
    for (const e of pending) clearDisplacedSource(e.slot);
    setResolved(true);
  };

  return (
    <div className="displaced-notice" role="status">
      <span className="displaced-notice-text">
        A shared link replaced the {label} you had saved here.
      </span>
      <button
        onClick={() => {
          for (const e of pending) e.onRestore(e.displaced!);
          finish();
        }}
      >
        Restore my {label}
      </button>
      <button className="link-button" onClick={finish}>
        Dismiss
      </button>
    </div>
  );
}
