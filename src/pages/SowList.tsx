// src/pages/SowList.tsx
//
// The Scope Composer landing page (/sow): a left filter rail, a templates grid
// with per-template CRUD actions, and a documents table. The cog opens the
// management surface (/sow/manage) for full variable + template CRUD.

import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import {
  Archive,
  Copy,
  FilePlus2,
  FileText,
  LayoutTemplate,
  MoreVertical,
  Pencil,
  Rocket,
  Search,
  Settings,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { MenuItem } from "@/components/ui/menu-item";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn, errorMessage } from "@/lib/utils";
import {
  useCreateSowDocument,
  useCreateSowTemplate,
  useDeleteSowDocument,
  useDeleteSowTemplate,
  useDuplicateSowTemplate,
  useSowDocuments,
  useSowTemplates,
  useUpdateSowTemplate,
} from "@/hooks/useSowComposer";
import type { SowTemplate } from "@/types/sow-composer";

const STATUS_TONE: Record<string, string> = {
  draft: "bg-m-surface-container text-m-on-surface-variant",
  final: "bg-m-primary-container text-m-on-primary-container",
  sent: "bg-m-secondary-container text-m-on-secondary-container",
};
const UNFILED = "Unfiled";

export function SowList() {
  const navigate = useNavigate();
  const { data: templates = [], isLoading: tLoading } = useSowTemplates();
  const { data: documents = [], isLoading: dLoading } = useSowDocuments();
  const createDoc = useCreateSowDocument();
  const createTpl = useCreateSowTemplate();
  const duplicateTpl = useDuplicateSowTemplate();
  const updateTpl = useUpdateSowTemplate();
  const deleteTpl = useDeleteSowTemplate();
  const deleteDoc = useDeleteSowDocument();

  const [search, setSearch] = useState("");
  const [area, setArea] = useState<string | null>(null); // department filter
  const [status, setStatus] = useState<string | null>(null);
  const [editing, setEditing] = useState<SowTemplate | null>(null);

  const q = search.trim().toLowerCase();

  // Areas (departments) with counts for the filter rail.
  const areas = useMemo(() => {
    const counts = new Map<string, number>();
    for (const t of templates) {
      const a = t.department ?? UNFILED;
      counts.set(a, (counts.get(a) ?? 0) + 1);
    }
    return [...counts.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [templates]);

  const filteredTemplates = useMemo(
    () =>
      templates.filter(
        (t) =>
          (!area || (t.department ?? UNFILED) === area) &&
          (!q || t.name.toLowerCase().includes(q)),
      ),
    [templates, area, q],
  );

  const filteredDocs = useMemo(
    () =>
      documents.filter(
        (d) => (!status || d.status === status) && (!q || d.title.toLowerCase().includes(q)),
      ),
    [documents, status, q],
  );

  const startFromTemplate = (tpl: SowTemplate) =>
    createDoc.mutate(
      { title: tpl.name, body: tpl.body, template_id: tpl.id },
      {
        onSuccess: (doc) => navigate(`/sow/docs/${doc.id}`),
        onError: (e) => toast.error(`Could not create SOW: ${errorMessage(e)}`),
      },
    );

  const newBlankDoc = () =>
    createDoc.mutate(
      { title: "Untitled SOW", body: [] },
      {
        onSuccess: (doc) => navigate(`/sow/docs/${doc.id}`),
        onError: (e) => toast.error(`Could not create SOW: ${errorMessage(e)}`),
      },
    );

  const newTemplate = () =>
    createTpl.mutate(
      { name: "Untitled template", department: area },
      {
        onSuccess: (tpl) => navigate(`/sow/templates/${tpl.id}`),
        onError: (e) => toast.error(`Could not create template: ${errorMessage(e)}`),
      },
    );

  const removeTemplate = (tpl: SowTemplate) => {
    if (!window.confirm(`Delete template "${tpl.name}"? This cannot be undone.`)) return;
    deleteTpl.mutate(tpl.id, {
      onSuccess: () => toast.success("Template deleted"),
      onError: (e) => toast.error(`Could not delete: ${errorMessage(e)}`),
    });
  };

  const removeDoc = (id: string, title: string) => {
    if (!window.confirm(`Delete SOW "${title}"?`)) return;
    deleteDoc.mutate(id, {
      onSuccess: () => toast.success("SOW deleted"),
      onError: (e) => toast.error(`Could not delete: ${errorMessage(e)}`),
    });
  };

  return (
    <div className="flex h-full">
      {/* ── Left filter rail ─────────────────────────────────────────────── */}
      <aside className="w-56 shrink-0 space-y-5 overflow-y-auto border-r border-m-outline-variant p-4">
        <div className="relative">
          <Search className="absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-m-on-surface-variant" />
          <Input
            aria-label="Search SOWs"
            placeholder="Search…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-10 pl-8"
          />
        </div>

        <div>
          <p className="mb-1.5 text-label-medium font-medium text-m-on-surface-variant">Area</p>
          <ul className="space-y-0.5">
            <FilterRow label="All areas" active={area === null} onClick={() => setArea(null)} count={templates.length} />
            {areas.map(([a, n]) => (
              <FilterRow key={a} label={a} active={area === a} onClick={() => setArea(a)} count={n} />
            ))}
          </ul>
        </div>

        <div>
          <p className="mb-1.5 text-label-medium font-medium text-m-on-surface-variant">
            Document status
          </p>
          <ul className="space-y-0.5">
            <FilterRow label="All" active={status === null} onClick={() => setStatus(null)} />
            {["draft", "final", "sent"].map((s) => (
              <FilterRow key={s} label={s} active={status === s} onClick={() => setStatus(s)} />
            ))}
          </ul>
        </div>
      </aside>

      {/* ── Main ─────────────────────────────────────────────────────────── */}
      <div className="min-w-0 flex-1 overflow-y-auto p-6">
        <div className="mb-6 flex items-center justify-between gap-3">
          <div>
            <h1 className="text-headline-medium">Scope Composer</h1>
            <p className="mt-1 text-body-medium text-m-on-surface-variant">
              Build a Scope of Work from reusable, variable-driven sections.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={newTemplate} disabled={createTpl.isPending} className="gap-1">
              <LayoutTemplate className="h-4 w-4" />
              New template
            </Button>
            <Button onClick={newBlankDoc} disabled={createDoc.isPending} className="gap-1">
              <FilePlus2 className="h-4 w-4" />
              New blank SOW
            </Button>
            <Button
              variant="outline"
              size="icon"
              aria-label="Manage SOWs & variables"
              data-testid="sow-manage-cog"
              onClick={() => navigate("/sow/manage")}
            >
              <Settings className="h-4 w-4" />
            </Button>
          </div>
        </div>

        {/* Templates */}
        <section className="mb-8">
          <div className="mb-3 flex items-center gap-2">
            <LayoutTemplate className="h-4 w-4 text-m-on-surface-variant" />
            <h2 className="text-title-medium text-m-on-surface">Templates</h2>
            <span className="text-label-medium text-m-on-surface-variant">
              {filteredTemplates.length} · author once · apply to any client
            </span>
          </div>
          {tLoading ? (
            <p className="text-body-medium text-m-on-surface-variant">Loading…</p>
          ) : filteredTemplates.length === 0 ? (
            <p className="text-body-medium text-m-on-surface-variant">No templates match.</p>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {filteredTemplates.map((tpl) => (
                <Card key={tpl.id} className="border-m-outline-variant">
                  <CardContent className="flex h-full flex-col gap-3 p-4">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <p className="line-clamp-2 text-title-small text-m-on-surface">{tpl.name}</p>
                        {tpl.department && (
                          <Badge variant="outline" className="mt-1 text-label-small">
                            {tpl.department}
                          </Badge>
                        )}
                      </div>
                      <Popover>
                        <PopoverTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 shrink-0"
                            aria-label={`Actions for ${tpl.name}`}
                          >
                            <MoreVertical className="h-4 w-4" />
                          </Button>
                        </PopoverTrigger>
                        <PopoverContent align="end" className="w-44 p-1">
                          <MenuItem icon={Pencil} label="Edit content" onClick={() => navigate(`/sow/templates/${tpl.id}`)} />
                          <MenuItem icon={Settings} label="Rename / area" onClick={() => setEditing(tpl)} />
                          <MenuItem
                            icon={Copy}
                            label="Duplicate"
                            onClick={() =>
                              duplicateTpl.mutate(tpl, {
                                onSuccess: () => toast.success("Duplicated"),
                                onError: (e) => toast.error(errorMessage(e)),
                              })
                            }
                          />
                          <MenuItem
                            icon={Archive}
                            label="Archive"
                            onClick={() =>
                              updateTpl.mutate(
                                { id: tpl.id, archived_at: new Date().toISOString() },
                                {
                                  onSuccess: () => toast.success("Archived"),
                                  onError: (e) => toast.error(errorMessage(e)),
                                },
                              )
                            }
                          />
                          <MenuItem icon={Trash2} label="Delete" destructive onClick={() => removeTemplate(tpl)} />
                        </PopoverContent>
                      </Popover>
                    </div>
                    <div className="mt-auto flex items-center gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        className="flex-1 gap-1 border-m-primary text-m-primary hover:bg-m-primary/5"
                        onClick={() => startFromTemplate(tpl)}
                        disabled={createDoc.isPending}
                      >
                        <Rocket className="h-3.5 w-3.5" />
                        Start SOW
                      </Button>
                      <Button size="sm" variant="outline" className="gap-1" onClick={() => navigate(`/sow/templates/${tpl.id}`)}>
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
            <span className="text-label-medium text-m-on-surface-variant">{filteredDocs.length}</span>
          </div>
          {dLoading ? (
            <p className="text-body-medium text-m-on-surface-variant">Loading…</p>
          ) : filteredDocs.length === 0 ? (
            <Card className="border-m-outline-variant">
              <CardContent className="p-6 text-center text-body-medium text-m-on-surface-variant">
                No SOWs match — start one from a template, or create a blank SOW.
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
                    <TableHead className="w-12" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredDocs.map((doc) => (
                    <TableRow key={doc.id} className="cursor-pointer" onClick={() => navigate(`/sow/docs/${doc.id}`)}>
                      <TableCell className="font-medium text-m-on-surface">{doc.title}</TableCell>
                      <TableCell>
                        <Badge className={STATUS_TONE[doc.status] ?? STATUS_TONE.draft}>{doc.status}</Badge>
                      </TableCell>
                      <TableCell className="text-body-small text-m-on-surface-variant">
                        {new Date(doc.updated_at).toLocaleDateString("en-ZA", {
                          year: "numeric",
                          month: "short",
                          day: "numeric",
                        })}
                      </TableCell>
                      <TableCell onClick={(e) => e.stopPropagation()}>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 text-m-error"
                          aria-label={`Delete ${doc.title}`}
                          onClick={() => removeDoc(doc.id, doc.title)}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </Card>
          )}
        </section>
      </div>

      <EditTemplateDialog
        template={editing}
        onClose={() => setEditing(null)}
        onSave={(patch) => {
          if (!editing) return;
          updateTpl.mutate(
            { id: editing.id, ...patch },
            {
              onSuccess: () => {
                toast.success("Saved");
                setEditing(null);
              },
              onError: (e) => toast.error(`Could not save: ${errorMessage(e)}`),
            },
          );
        }}
      />
    </div>
  );
}

function FilterRow({
  label,
  active,
  onClick,
  count,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
  count?: number;
}) {
  return (
    <li>
      <button
        type="button"
        onClick={onClick}
        className={cn(
          "flex w-full items-center justify-between rounded-md px-2 py-1 text-left text-body-small capitalize",
          active
            ? "bg-m-secondary-container text-m-on-secondary-container"
            : "text-m-on-surface hover:bg-m-surface-container",
        )}
      >
        <span className="truncate">{label}</span>
        {count !== undefined && <span className="ml-2 tabular-nums text-label-small opacity-70">{count}</span>}
      </button>
    </li>
  );
}

function EditTemplateDialog({
  template,
  onClose,
  onSave,
}: {
  template: SowTemplate | null;
  onClose: () => void;
  onSave: (patch: { name: string; department: string | null }) => void;
}) {
  const [name, setName] = useState("");
  const [department, setDepartment] = useState("");

  // Re-seed when a new template is opened.
  useEffect(() => {
    if (template) {
      setName(template.name);
      setDepartment(template.department ?? "");
    }
  }, [template]);

  return (
    <Dialog open={!!template} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit template</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1">
            <Label htmlFor="tpl-name">Name</Label>
            <Input id="tpl-name" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="tpl-dept">Area / department</Label>
            <Input
              id="tpl-dept"
              value={department}
              onChange={(e) => setDepartment(e.target.value)}
              placeholder="e.g. SEO"
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => onSave({ name: name.trim(), department: department.trim() || null })}>
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
