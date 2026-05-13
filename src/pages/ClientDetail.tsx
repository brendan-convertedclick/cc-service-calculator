import { useParams, Link } from "react-router-dom";
import { ChevronLeft } from "lucide-react";
import { useClients } from "@/hooks/useClients";
import { SenderRulesPanel } from "@/components/clients/SenderRulesPanel";
import { Button } from "@/components/ui/button";

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
      <h2 className="text-lg font-semibold">Sender rules</h2>
      <SenderRulesPanel
        clientId={client.id}
        primaryDomain={client.primary_domain ?? null}
      />
    </div>
  );
}
