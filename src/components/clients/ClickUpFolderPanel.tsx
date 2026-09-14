import { useState } from "react";
import { useSaveClient, useClickUpFolders } from "@/hooks/useClients";
import { useSettings } from "@/hooks/useSettings";
import { Button } from "@/components/ui/button";
import { PanelSection } from "@/components/clients/PanelSection";
import { Combobox } from "@/components/ui/combobox";
import { UNLINKED } from "@/components/clients/NewClientDialog";

// Which ClickUp client this is. A "client" over there is a Folder in the
// configured Clients space, so that is the whole list this picker can offer.
// Folders in any other space will never appear here.
export function ClickUpFolderPanel({
  clientId,
  clickupFolderId,
}: {
  clientId: string;
  clickupFolderId: string | null;
}) {
  const { save, isPending } = useSaveClient();
  const { data: settings } = useSettings();
  const { data: folders, isLoading, error } = useClickUpFolders();
  const [value, setValue] = useState(clickupFolderId ?? UNLINKED);

  const next = value === UNLINKED ? null : value;
  const dirty = next !== clickupFolderId;
  const options = [
    { value: UNLINKED, label: "— Unlinked —" },
    ...(folders ?? []).map((f) => ({ value: f.id, label: f.name })),
  ];

  return (
    <PanelSection
      title="Folder"
      description="The folder this client's work is created in. Changing it sends every future task somewhere else. The lists below still point at the old folder until you sync."
    >
      <div className="flex items-center gap-3">
        {error ? (
          <p className="text-body-small text-destructive">
            Couldn't load folders. Check the Clients space in Settings.
          </p>
        ) : isLoading ? (
          <p className="text-body-small text-m-on-surface-variant">Loading…</p>
        ) : !settings?.clickup_clients_space_id ? (
          <p className="text-body-small text-m-on-surface-variant">
            Configure a Clients space in Settings first.
          </p>
        ) : (
          <>
            <Combobox
              className="max-w-md flex-1"
              options={options}
              value={value}
              onChange={setValue}
              placeholder="Pick a folder…"
            />
            <Button
              size="sm"
              disabled={!dirty || isPending}
              onClick={() => save(clientId, { clickup_folder_id: next })}
            >
              {isPending ? "Saving…" : "Save"}
            </Button>
          </>
        )}
      </div>
    </PanelSection>
  );
}
