// src/components/results/groupIcons.tsx
//
// The fixed set of icons a board group can wear (0192), keyed by the string
// stored in results_groups.icon / pipeline_group_styles.icon. A null or
// unknown key falls back to a default picked from the group's name, so a
// group nobody has styled still looks deliberate.

import {
  BarChart3,
  Briefcase,
  CalendarDays,
  FileText,
  Flag,
  Globe,
  GraduationCap,
  Image,
  Mail,
  Megaphone,
  Rocket,
  Search,
  Settings,
  Share2,
  Star,
  Target,
  Users,
  type LucideIcon,
} from "lucide-react";

export const GROUP_ICONS: Record<string, { label: string; Icon: LucideIcon }> = {
  megaphone: { label: "Megaphone", Icon: Megaphone },
  share: { label: "Share", Icon: Share2 },
  file: { label: "Document", Icon: FileText },
  calendar: { label: "Calendar", Icon: CalendarDays },
  target: { label: "Target", Icon: Target },
  briefcase: { label: "Briefcase", Icon: Briefcase },
  settings: { label: "Settings", Icon: Settings },
  search: { label: "Search", Icon: Search },
  chart: { label: "Chart", Icon: BarChart3 },
  users: { label: "People", Icon: Users },
  mail: { label: "Mail", Icon: Mail },
  image: { label: "Image", Icon: Image },
  globe: { label: "Globe", Icon: Globe },
  graduation: { label: "School", Icon: GraduationCap },
  star: { label: "Star", Icon: Star },
  rocket: { label: "Rocket", Icon: Rocket },
  flag: { label: "Flag", Icon: Flag },
};

const BY_NAME: [RegExp, string][] = [
  [/paid|ads|search/i, "megaphone"],
  [/social/i, "share"],
  [/content|guide|blog/i, "file"],
  [/event|open day/i, "calendar"],
  [/campaign|intake/i, "target"],
  [/account owner|owner/i, "briefcase"],
  [/running|operation/i, "settings"],
];

export function groupIcon(key: string | null | undefined, groupName: string): LucideIcon {
  if (key && GROUP_ICONS[key]) return GROUP_ICONS[key].Icon;
  const hit = BY_NAME.find(([re]) => re.test(groupName));
  return GROUP_ICONS[hit?.[1] ?? "flag"].Icon;
}
