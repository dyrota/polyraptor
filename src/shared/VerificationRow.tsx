// One property's row in a verification card, shared by both families.
//
// The `vacuous` state is the reason this is a component rather than three
// spans: a property whose check never ran still has `holds === true` (nothing
// falsified it), and rendering that as a green "holds" would be the single
// most misleading thing either card could do. It gets its own muted "not
// checked" treatment instead, in both families, from one place.

export function fmtValue(value: unknown): string {
  if (Array.isArray(value)) return `(${value.join(', ')})`;
  if (value === null || value === undefined) return '—';
  if (typeof value === 'object') return JSON.stringify(value);
  if (typeof value === 'number') return round(value);
  return String(value);
}

export function round(n: number): string {
  if (!Number.isFinite(n)) return n > 0 ? '∞' : Number.isNaN(n) ? 'NaN' : '−∞';
  return Number.isInteger(n) ? String(n) : n.toFixed(3);
}

export function PropertyRow({
  label,
  holds,
  checked,
  detail,
  vacuous,
  unit = 'checked',
}: {
  label: string;
  holds: boolean;
  checked: number;
  detail?: string;
  vacuous?: boolean;
  unit?: string;
}) {
  const status = vacuous ? 'not checked' : holds ? 'holds' : 'violated';
  const cls = vacuous ? 'verify-row-skip' : holds ? 'verify-row-ok' : 'verify-row-bad';
  return (
    <div className={`verify-row ${cls}`}>
      <span className="verify-row-label">{label}</span>
      <span className="verify-row-status">{status}</span>
      <span className="verify-row-checked">{vacuous ? `0 ${unit}` : `${checked.toLocaleString()} ${unit}`}</span>
      {detail && <div className="verify-row-detail">{detail}</div>}
    </div>
  );
}
