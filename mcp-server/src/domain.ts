/**
 * Domain normalisation helpers.
 *
 * `clients.primary_domain` has historically been stored in mixed forms — bare
 * hosts ("trellidor.co.za") as well as full URLs ("https://trellidor.co.za/").
 * All sender/client matching must compare bare lowercase hosts, so normalise
 * both sides at compare time rather than trusting the stored format.
 */

/** Reduce any URL or host string to a bare lowercase host (no scheme, www, path, or port). */
export function normalizeHost(input: string | null | undefined): string {
  if (!input) return ''
  return input
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '') // strip scheme
    .replace(/^www\./, '') // strip leading www.
    .replace(/\/.*$/, '') // strip path / trailing slash
    .replace(/:\d+$/, '') // strip port
}

/**
 * True when `senderHost` belongs to `clientHost` — exact match or a subdomain.
 * Both arguments must already be normalised hosts.
 */
export function hostMatches(senderHost: string, clientHost: string): boolean {
  if (!senderHost || !clientHost) return false
  return senderHost === clientHost || senderHost.endsWith('.' + clientHost)
}
