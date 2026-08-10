import { useState } from "react";
import { toast } from "sonner";
import { useClickUpChatChannels, useUpdateClient } from "@/hooks/useClients";
import { errorMessage } from "@/lib/utils";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
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
  const update = useUpdateClient();
  const [saving, setSaving] = useState(false);

  return (
    <Card>
      <CardHeader>
        <CardTitle>ClickUp Chat channel</CardTitle>
        <CardDescription>
          Where brief notifications for this client are posted. Leave unset to
          fall back to the internal Converted Click channel.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        {error ? (
          <div className="text-body-small text-m-error">
            Couldn't load ClickUp chat channels:{" "}
            {errorMessage(error)}
          </div>
        ) : null}
        <Select
          value={clickupChatChannelId ?? NONE}
          disabled={isLoading || saving}
          onValueChange={(v) => {
            const next = v === NONE ? null : v;
            if (next === (clickupChatChannelId ?? null)) return;
            setSaving(true);
            update.mutate(
              { id: clientId, patch: { clickup_chat_channel_id: next } },
              {
                onSuccess: () => toast.success("Saved"),
                onError: (e) =>
                  toast.error(`Update failed: ${errorMessage(e)}`),
                onSettled: () => setSaving(false),
              },
            );
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
      </CardContent>
    </Card>
  );
}
