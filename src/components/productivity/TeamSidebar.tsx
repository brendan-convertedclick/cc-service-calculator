// src/components/productivity/TeamSidebar.tsx
import { Users } from "lucide-react";
import { MEMBER_COLORS } from "@/hooks/useProductivity";
import type { Database } from "@/types/db";

type TeamMember = Database["public"]["Tables"]["team_members"]["Row"];

interface Props {
  members: TeamMember[];
  selectedUserId: number | null; // null = whole team
  onSelect: (userId: number | null) => void;
  pointsByMember: Record<number, number>; // clickup_user_id → total points
}

function initials(name: string): string {
  return name
    .split(" ")
    .map((w) => w[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);
}

export function TeamSidebar({ members, selectedUserId, onSelect, pointsByMember }: Props) {
  const isTeam = selectedUserId === null;

  const totalPoints = Object.values(pointsByMember).reduce((s, v) => s + v, 0);

  return (
    <aside className="w-44 shrink-0 border-r border-m-outline-variant bg-m-surface px-2 py-4 flex flex-col gap-0.5 sticky top-0 h-screen overflow-y-auto">
      <p className="px-3 mb-2 text-label-small font-semibold uppercase tracking-widest text-m-on-surface-variant">
        Team
      </p>

      {/* Whole team row */}
      <button
        type="button"
        onClick={() => onSelect(null)}
        className={`flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-label-large transition-colors ${
          isTeam
            ? "bg-m-primary-container font-semibold text-m-on-primary-container"
            : "text-m-on-surface-variant hover:bg-m-surface-container hover:text-m-on-surface"
        }`}
      >
        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-m-surface-container-high text-m-on-surface-variant">
          <Users className="h-3.5 w-3.5" />
        </span>
        <span className="flex-1 truncate">Whole team</span>
        <span className="text-label-small tabular-nums opacity-60">{totalPoints}</span>
      </button>

      {/* Member rows */}
      {members.map((member, idx) => {
        const isActive = selectedUserId === member.clickup_user_id;
        const color = MEMBER_COLORS[idx % MEMBER_COLORS.length];
        const pts = member.clickup_user_id ? (pointsByMember[member.clickup_user_id] ?? 0) : 0;
        return (
          <button
            key={member.id}
            type="button"
            onClick={() => member.clickup_user_id && onSelect(member.clickup_user_id)}
            disabled={!member.clickup_user_id}
            className={`flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-label-large transition-colors ${
              isActive
                ? "bg-m-primary-container font-semibold text-m-on-primary-container"
                : "text-m-on-surface-variant hover:bg-m-surface-container hover:text-m-on-surface"
            } disabled:opacity-40 disabled:cursor-not-allowed`}
          >
            <span
              className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-[10px] font-bold text-white"
              style={{ background: color }}
            >
              {initials(member.full_name)}
            </span>
            <span className="flex-1 truncate">{member.full_name.split(" ")[0]}</span>
            <span className="text-label-small tabular-nums opacity-60">{pts}</span>
          </button>
        );
      })}
    </aside>
  );
}
