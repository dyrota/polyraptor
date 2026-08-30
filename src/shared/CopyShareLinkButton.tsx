import { useState } from 'react';
import { buildShareUrl, type SharedPayload } from './shareLink';

// One tiny reusable button rather than repeating this six times (one per
// authoring sub-mode across both families) -- copy-then-briefly-confirm is
// the only behavior, no reason for it to vary per call site.
export function CopyShareLinkButton({ payload }: { payload: SharedPayload }) {
  const [copied, setCopied] = useState(false);

  async function handleClick() {
    const url = buildShareUrl(payload);
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      window.prompt('Copy this link:', url);
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return <button onClick={handleClick}>{copied ? 'Copied!' : 'Copy share link'}</button>;
}
