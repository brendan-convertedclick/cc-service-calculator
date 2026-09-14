import { useParams, Link } from "react-router-dom";
import { ChevronLeft } from "lucide-react";
import { useClients } from "@/hooks/useClients";
import { ClientDetailsPanel } from "@/components/clients/ClientDetailsPanel";
import { SenderRulesPanel } from "@/components/clients/SenderRulesPanel";
import { ClickUpFolderPanel } from "@/components/clients/ClickUpFolderPanel";
import { ClickUpListsPanel } from "@/components/clients/ClickUpListsPanel";
import { ChatChannelPanel } from "@/components/clients/ChatChannelPanel";
import { XeroContactPanel } from "@/components/clients/XeroContactPanel";
import { ContactsPanel } from "@/components/clients/ContactsPanel";
import { ClientReviewPanel } from "@/components/clients/ClientReviewPanel";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export function ClientDetail() {
  const { id = "" } = useParams();
  const { data: clients = [], isLoading } = useClients();
  if (isLoading) {
    return (
      <div className="container mx-auto max-w-4xl p-6 text-sm text-muted-foreground">
        Loading…
      </div>
    );
  }
  const client = clients.find((c) => c.id === id);
  if (!client) {
    return (
      <div className="container mx-auto max-w-4xl p-6 text-sm text-muted-foreground">
        Client not found.{" "}
        <Link to="/clients" className="underline">
          Back to clients
        </Link>
      </div>
    );
  }
  return (
    <div className="container mx-auto max-w-4xl p-6 space-y-6">
      <div>
        <Button asChild variant="ghost" size="sm">
          <Link to="/clients">
            <ChevronLeft className="h-4 w-4" /> All clients
          </Link>
        </Button>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight">
          {client.name}
        </h1>
        <p className="text-sm text-muted-foreground">
          {client.primary_domain ?? "No primary domain set"}
        </p>
      </div>
      <ClientDetailsPanel key={client.id} client={client} />

      <Card>
        <CardHeader>
          <CardTitle>Sender rules</CardTitle>
        </CardHeader>
        <CardContent>
          <SenderRulesPanel
            clientId={client.id}
            primaryDomain={client.primary_domain ?? null}
          />
        </CardContent>
      </Card>

      {/* Folder first, then the lists inside it, then where the folder talks
          back. All three are the same link to the same place. */}
      <Card>
        <CardHeader>
          <CardTitle>ClickUp</CardTitle>
        </CardHeader>
        <CardContent>
          <ClickUpFolderPanel
            clientId={client.id}
            clickupFolderId={client.clickup_folder_id ?? null}
          />
          <ClickUpListsPanel
            clientId={client.id}
            clickupFolderId={client.clickup_folder_id ?? null}
          />
          <ChatChannelPanel
            clientId={client.id}
            clickupChatChannelId={client.clickup_chat_channel_id ?? null}
          />
        </CardContent>
      </Card>

      <XeroContactPanel client={client} />

      {/* Contacts first: a personal sign-off link is minted FOR a contact,
          so there is nothing to pick in the panel below until this has rows. */}
      <ContactsPanel clientId={client.id} clientName={client.name} />

      <ClientReviewPanel clientId={client.id} clientName={client.name} />
    </div>
  );
}
