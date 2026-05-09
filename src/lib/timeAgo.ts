export function timeAgo(isoTimestamp: string): string {
  const days = Math.floor((Date.now() - new Date(isoTimestamp).getTime()) / (1000 * 60 * 60 * 24));
  if (days === 0) return "today";
  if (days === 1) return "1d ago";
  return `${days}d ago`;
}
