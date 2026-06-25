// src/pages/SowList.tsx
//
// The Scope Composer landing page (/sow). Lists reusable templates and existing
// SOW documents, and creates new ones — the discoverable entry point into the
// two-pane builder.

import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { FilePlus2, FileText, LayoutTemplate, Pencil, Rocket } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  useCreateSowDocument,
  useSowDocuments,
  useSowTemplates,
} from "@/hooks/useSowComposer";
import type { SowTemplate } from "@/types/sow-composer";

const STATUS_TONE: Record<string, string> = {
  draft: "bg-m-surface-container text-m-on-surface-variant",
  final: "bg-m-primary-container text-m-on-primary-container",
  sent: "bg-m-secondary-container text-m-on-secondary-container",
};

export function SowList() {
  const navigate = useNavigate();
  const { data: templates = [], isLoading: tLoading } = useSowTemplates();
  const { data: documents = [], isLoading: dLoading } = useSowDocuments();
  const createDoc = useCreateSowDocument();

  const startFromTemplate = (tpl: SowTemplate) => {
    createDoc.mutate(
      { title: tpl.name, body: tpl.body, template_id: tpl.id },
      {
        onSuccess: (doc) => navigate(`/sow/docs/${doc.id}`),
        onError: (e) => toast.error(e instanceof Error ? e.message : "Could not create SOW"),
      },
    );
  };

  const newBlank = () => {
    createDoc.mutate(
      { title: "Untitled SOW", body: [] },
      {
        onSuccess: (doc) => navigate(`/sow/docs/${doc.id}`),
        onError: (e) => toast.error(e instanceof Error ? e.message : "Could not create SOW"),
      },
    );
  };

  return (
    <div className="max-w-6xl p-6">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-headline-medium">Scope Composer</h1>
          <p className="mt-1 text-body-medium text-m-on-surface-variant">
            Build a Scope of Work from reusable, variable-driven sections.
          </p>
        </div>
        <Button onClick={newBlank} disabled={createDoc.isPending} className="gap-1">
          <FilePlus2 className="h-4 w-4" />
          New blank SOW
        </Button>
      </div>

      {/* Templates */}
      <section className="mb-8">
        <div className="mb-3 flex items-center gap-2">
          <LayoutTemplate className="h-4 w-4 text-m-on-surface-variant" />
          <h2 className="text-title-medium text-m-on-surface">Templates</h2>
          <span className="text-label-medium text-m-on-surface-variant">
            author once · apply to any client
          </span>
        </div>
        {tLoading ? (
          <p className="text-body-medium text-m-on-surface-variant">Loading…</p>
        ) : templates.length === 0 ? (
          <p className="text-body-medium text-m-on-surface-variant">No templates yet.</p>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {templates.map((tpl) => (
              <Card key={tpl.id} className="border-m-outline-variant">
                <CardContent className="flex h-full flex-col gap-3 p-4">
                  <div className="flex-1">
                    <p className="line-clamp-2 text-title-small text-m-on-surface">{tpl.name}</p>
                    {tpl.master_sow_slug && (
                      <p className="mt-1 font-mono text-label-small text-m-on-surface-variant">
                        {tpl.master_sow_slug}
                      </p>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      size="sm"
                      className="flex-1 gap-1"
                      onClick={() => startFromTemplate(tpl)}
                      disabled={createDoc.isPending}
                    >
                      <Rocket className="h-3.5 w-3.5" />
                      Start SOW
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="gap-1"
                      onClick={() => navigate(`/sow/templates/${tpl.id}`)}
                    >
                      <Pencil className="h-3.5 w-3.5" />
                      Edit
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </section>

      {/* Documents */}
      <section>
        <div className="mb-3 flex items-center gap-2">
          <FileText className="h-4 w-4 text-m-on-surface-variant" />
          <h2 className="text-title-medium text-m-on-surface">Documents</h2>
        </div>
        {dLoading ? (
          <p className="text-body-medium text-m-on-surface-variant">Loading…</p>
        ) : documents.length === 0 ? (
          <Card className="border-m-outline-variant">
            <CardContent className="p-6 text-center text-body-medium text-m-on-surface-variant">
              No SOWs yet — start one from a template above, or create a blank SOW.
            </CardContent>
          </Card>
        ) : (
          <Card className="border-m-outline-variant">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Title</TableHead>
                  <TableHead className="w-28">Status</TableHead>
                  <TableHead className="w-40">Updated</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {documents.map((doc) => (
                  <TableRow
                    key={doc.id}
                    className="cursor-pointer"
                    onClick={() => navigate(`/sow/docs/${doc.id}`)}
                  >
                    <TableCell className="font-medium text-m-on-surface">{doc.title}</TableCell>
                    <TableCell>
                      <Badge className={STATUS_TONE[doc.status] ?? STATUS_TONE.draft}>
                        {doc.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-body-small text-m-on-surface-variant">
                      {new Date(doc.updated_at).toLocaleDateString("en-ZA", {
                        year: "numeric",
                        month: "short",
                        day: "numeric",
                      })}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>
        )}
      </section>
    </div>
  );
}
