import type { Actor } from './activityLog';

// Names what is actually on screen, in both families.
//
// Without this the panel could contradict itself, and routinely did: an agent
// calls sort_author_python_comparator and sort_run_algorithm, the canvas fills
// with a three-value comparator problem sorted by radix -- while the Built-in
// controls above it still read "random_integers / 30 / bubble_sort", because
// those are local UI state and have nothing to do with the active problem. The
// controls describe what the NEXT click will do; nothing described what the
// last one had already done.
//
// That gap matters more here than it would in most apps. This one's whole
// premise is that an agent mutates the page you are watching, so "what am I
// looking at, and did I make it or did the agent?" is the question the page
// most needs to answer on its own. The activity log beside it can be scrolled
// back to work that out; a label cannot be missed.
export function ActiveProblemBar({
  kind,
  detail,
  problemId,
  origin,
}: {
  kind: string;
  detail?: string;
  problemId: string;
  origin?: Actor;
}) {
  return (
    <div className="active-problem">
      <span className="active-problem-kind">{kind}</span>
      {detail && <span className="active-problem-detail">{detail}</span>}
      {origin && (
        <span className={`active-problem-origin origin-${origin}`}>
          {origin === 'agent' ? 'created by the agent' : 'created by you'}
        </span>
      )}
      {/* The id is what every tool call and log entry refers to, so it earns a
          place here -- but it is reference material, not the headline, hence
          last and muted. */}
      <code className="active-problem-id" title="problem_id">{problemId}</code>
    </div>
  );
}
