/**
 * Shared MCP tool response envelope. Every tool handler wraps its result the
 * same way: JSON-stringify the payload into a single text content block, and
 * on thrown error return `{ error: message }` with `isError: true`.
 */

export type ToolResult = {
  content: [{ type: 'text'; text: string }]
  isError?: true
}

function toolResult(data: unknown, isError?: true): ToolResult {
  const result: ToolResult = { content: [{ type: 'text', text: JSON.stringify(data) }] }
  if (isError) result.isError = true
  return result
}

/** Run a handler body, wrapping its resolved value as a tool result and any thrown error as `{ error }`. */
export async function guarded(fn: () => Promise<unknown>): Promise<ToolResult> {
  try {
    return toolResult(await fn())
  } catch (e) {
    return toolResult({ error: e instanceof Error ? e.message : String(e) }, true)
  }
}
