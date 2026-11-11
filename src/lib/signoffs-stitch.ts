/** Where a client lands after "Sign in with Stitch": their personal review link,
 *  marked `via=stitch` so an ended session reads as a Stitch matter, with the
 *  item they clicked in Stitch (if any) pre-selected. */
export function reviewPathFor(token: string, item: string | null): string {
  const base = `/review/${token}?via=stitch`;
  return item ? `${base}&item=${encodeURIComponent(item)}` : base;
}
