import { useClickUpChatChannels, useSaveClient } from "@/hooks/useClients";
import { errorMessage } from "@/lib/utils";
import { PanelSection } from "@/components/clients/PanelSection";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const NONE = "__none__";

export function ChatChannelPanel({
  clientId,
  clickupChatChannelId,
}: {
  clientId: string;
  clickupChatChannelId: string | null;
}) {
  const { data: channels = [], isLoading, error } = useClickUpChatChannels();
  const { save, isPending } = useSaveClient();

  return (
    <PanelSection
      title="Chat channel"
      description="Where this client's own replies, answers and sign-offs are posted, plus their brief extension notices. Leave it unset and they go to the internal Approval Requests channel instead. Anyone in the channel can read them, so pick one the client is meant to see."
    >
      <div className="space-y-2">
        {error ? (
          <div className="text-body-small text-m-error">
            Couldn't load ClickUp chat channels:{" "}
            {errorMessage(error)}
          </div>
        ) : null}
        <Select
          value={clickupChatChannelId ?? NONE}
          disabled={isLoading || isPending}
          onValueChange={(v) => {
            const next = v === NONE ? null : v;
            if (next === (clickupChatChannelId ?? null)) return;
            save(clientId, { clickup_chat_channel_id: next });
          }}
        >
          <SelectTrigger className="w-72">
            <SelectValue
              placeholder={isLoading ? "Loading channels…" : "Pick a channel…"}
            />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={NONE}>
              — None (falls back to Converted Click) —
            </SelectItem>
            {channels.map((c) => (
              <SelectItem key={c.id} value={c.id}>
                {c.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </PanelSection>
  );
}
