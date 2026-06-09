import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { Plus, Trash2 } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useRetainers, useDeleteRetainer } from "@/hooks/useRetainers";
import { formatZar } from "@/lib/utils";
import { STATUS_LABEL } from "@/lib/project-status";

function statusLabel(status: string): string {
  return (STATUS_LABEL as Record<string, string>)[status] ?? status;
}

export function RetainersList() {
  const navigate = useNavigate();
  const { data: retainers = [] } = useRetainers();
  const deleteRetainer = useDeleteRetainer();

  return (
    <div className="max-w-6xl p-6">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-headline-medium">Retainers</h1>
        <Button onClick={() => navigate("/retainers/new")}>
          <Plus className="h-4 w-4" />
          New retainer
        </Button>
      </div>

      {retainers.length === 0 ? (
        <div className="text-body-medium text-m-on-surface-variant">
          No retainers yet. Create one with the “New retainer” button to set up monthly hours,
          a fee, and recurring services.
        </div>
      ) : (
        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Client</TableHead>
                  <TableHead>Name</TableHead>
                  <TableHead className="text-right">Monthly fee</TableHead>
                  <TableHead className="text-right">Hours target</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="w-px" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {retainers.map((r) => (
                  <TableRow
                    key={r.id}
                    onClick={() => navigate(`/projects/${r.id}`)}
                    className="cursor-pointer"
                  >
                    <TableCell className="text-body-medium text-m-on-surface">
                      {r.client_name}
                    </TableCell>
                    <TableCell className="text-body-medium text-m-on-surface">
                      {r.name}
                    </TableCell>
                    <TableCell className="text-right text-body-medium tabular-nums text-m-on-surface">
                      {r.retainer_monthly_fee_cents != null
                        ? formatZar(r.retainer_monthly_fee_cents)
                        : "—"}
                    </TableCell>
                    <TableCell className="text-right text-body-medium tabular-nums text-m-on-surface">
                      {r.retainer_hours_target ?? "—"}
                    </TableCell>
                    <TableCell>
                      <Badge>{statusLabel(r.status)}</Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        variant="ghost"
                        size="icon"
                        disabled={deleteRetainer.isPending}
                        aria-label={`Delete retainer ${r.name}`}
                        onClick={(e) => {
                          e.stopPropagation();
                          if (
                            confirm(
                              `Delete "${r.name}" for ${r.client_name}? This removes the retainer and its recurring services. The ClickUp list is left untouched.`,
                            )
                          ) {
                            deleteRetainer.mutate(r.id, {
                              onSuccess: () => toast.success("Retainer deleted"),
                              onError: (err) =>
                                toast.error(
                                  err instanceof Error ? err.message : "Failed to delete retainer",
                                ),
                            });
                          }
                        }}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
