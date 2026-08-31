// Feature-detected document.modelContext / navigator.modelContext registration.
// Ported from the proven pattern in phase0-check1/index.html (Phase 0
// checkpoint 1, verified working end to end) — do not redesign this, it's the
// one place this detection happens for the whole app.
//
// Per current WebMCP spec (May 27 2026 draft), the entry point moved from
// navigator.modelContext to document.modelContext; navigator.modelContext is
// deprecated as of Chromium 150 but kept here as a fallback for older builds.

export interface ToolDefinition<Args = Record<string, unknown>> {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  execute: (args: Args) => Promise<string>;
  annotations?: Record<string, boolean>;
}

interface ModelContextLike {
  registerTool: (tool: ToolDefinition<never>) => void;
}

function getModelContext(): ModelContextLike | null {
  const doc = document as unknown as { modelContext?: ModelContextLike };
  const nav = navigator as unknown as { modelContext?: ModelContextLike };
  const mc = doc.modelContext || nav.modelContext;
  return mc && typeof mc.registerTool === 'function' ? mc : null;
}

export function isWebMcpAvailable(): boolean {
  return getModelContext() !== null;
}

// Registers every tool eagerly at app mount (no per-tab AbortSignal scoping —
// this is a single-page app, so scoping tool availability to "which tab is
// active" only adds risk of "the tool wasn't available because you were on
// the wrong tab" for no real benefit, per the plan doc).
//
// Idempotent by design: React 18 StrictMode (development only) deliberately
// mounts effects, "cleans up," and mounts them again to catch exactly this
// class of bug. The native registerTool() throws InvalidStateError on a
// duplicate name with no tolerant re-register mode, so a second call here
// (from StrictMode's synthetic remount) must be a safe no-op. Deliberately
// NOT using the spec's AbortSignal-based unregister-on-cleanup mechanism —
// this session hit three separate cases of secondary sources describing
// WebMCP/Pyodide APIs that didn't match what's actually shipped, so this
// avoids leaning on another unverified API surface for something a simple
// guard solves completely: the app only ever mounts once for real (this is
// a single-page app with one root render), so "register once, ever" is
// exactly the right behavior in both dev and production.
let cachedResult: { registered: boolean; count: number } | null = null;

export function registerTools(tools: ToolDefinition<never>[]): { registered: boolean; count: number } {
  if (cachedResult) return cachedResult;

  const modelContext = getModelContext();
  if (!modelContext) {
    console.warn(
      'polyraptor: no document.modelContext/navigator.modelContext found. ' +
        'Open this page in ChatGPT\'s in-app browser, or Chrome with the WebMCP flag enabled.'
    );
    cachedResult = { registered: false, count: 0 };
    return cachedResult;
  }

  for (const tool of tools) {
    // readOnlyHint defaults to FALSE, not true. Nearly every tool here mutates
    // the live page — that is the entire thesis of this project — and the two
    // that genuinely don't (search_benchmark_compare, playback_get_state) opt
    // in explicitly. The old default advertised every authoring, running and
    // playback tool as side-effect-free, which is the exact opposite of what
    // they do, and invites an agent to call them speculatively or retry them
    // as if replaying were free.
    modelContext.registerTool({
      ...tool,
      annotations: { readOnlyHint: false, ...tool.annotations },
    });
  }

  cachedResult = { registered: true, count: tools.length };
  return cachedResult;
}
