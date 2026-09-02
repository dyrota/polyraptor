import { useState } from 'react';

// What to actually ask the agent, in the place an agent's work will appear.
//
// The empty states used to name raw tool ids -- "ask your agent to author one
// (search_author_maze / search_author_n_queens / ...)". That tells you the
// wiring exists but not what to do with it, and nobody types a tool name at a
// chat window. Someone arriving with an agent attached spends their first
// minute deciding what to ask; these are four things worth asking, phrased the
// way you would actually say them.
//
// Chosen to span the tool surface rather than to be impressive: one built-in
// problem plus a cross-algorithm comparison, one authored heuristic, one
// authored comparator, one playback scrub. The middle two are the ones that
// land hardest, because a verdict about code you just wrote is the thing this
// app can do that a video of an algorithm cannot.
const STARTER_PROMPTS = [
  'Author an 8-queens board and race A* against breadth-first on it.',
  'Write a heuristic for this maze that overestimates the real distance, then verify it and show me the counterexample.',
  "Make a comparator that treats values within 0.5 of each other as equal, sort with it, then check whether it's actually a valid ordering.",
  'Make a 40-value dataset, run bubble sort, and step me through the first 20 comparisons.',
];

export function StarterPrompts() {
  const [copied, setCopied] = useState<number | null>(null);

  async function copy(text: string, i: number) {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // Clipboard access is denied in some contexts; a prompt still lets
      // someone take the text, which is the whole point of the control.
      window.prompt('Copy this prompt:', text);
    }
    setCopied(i);
    setTimeout(() => setCopied(null), 1500);
  }

  return (
    <div className="starter-prompts">
      <p className="starter-prompts-lead">Try asking your agent:</p>
      <ul>
        {STARTER_PROMPTS.map((prompt, i) => (
          <li key={prompt}>
            <button type="button" onClick={() => copy(prompt, i)} title="Copy this prompt">
              <span className="starter-prompt-text">{prompt}</span>
              <span className="starter-prompt-copy" aria-hidden="true">{copied === i ? 'copied' : 'copy'}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
