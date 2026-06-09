const SUPABASE_URL = process.env.SUPABASE_URL ?? ''
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''

/**
 * Fires auto-scope in the background after a new brief is created.
 * Never throws — failure is logged to stderr only.
 */
export function fireAutoScope(briefId: string): void {
  const url = `${SUPABASE_URL}/functions/v1/auto-scope`
  fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${SERVICE_KEY}`,
    },
    body: JSON.stringify({ brief_id: briefId }),
  }).catch((e: unknown) => {
    const msg = e instanceof Error ? e.message : String(e)
    console.error(`[conductor-mcp] auto-scope fire failed for ${briefId}: ${msg}`)
  })
}
