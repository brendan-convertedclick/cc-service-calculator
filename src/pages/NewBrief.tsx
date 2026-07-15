import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Combobox } from "@/components/ui/combobox";
import { useClients, useCreateClient } from "@/hooks/useClients";
import { useCreateBrief, useUpdateBrief } from "@/hooks/useBriefs";
import { supabase } from "@/lib/supabase";

const schema = z.object({
  client_id: z.string().uuid().optional(),
  new_client_name: z.string().optional(),
  sender_email: z.string().email().optional().or(z.literal("")),
  raw_subject: z.string().min(1, "Subject required"),
  raw_body: z.string().min(10, "Body must be at least 10 characters"),
});
type FormValues = z.infer<typeof schema>;

export function NewBrief() {
  const navigate = useNavigate();
  const { data: clients = [] } = useClients();
  const createClient = useCreateClient();
  const createBrief = useCreateBrief();
  const updateBrief = useUpdateBrief();
  const [files, setFiles] = useState<File[]>([]);

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { raw_subject: "", raw_body: "" },
  });

  const onSubmit = async (values: FormValues) => {
    let clientId = values.client_id;
    if (!clientId && values.new_client_name) {
      const c = await createClient.mutateAsync({ name: values.new_client_name });
      clientId = c.id;
    }

    const brief = await createBrief.mutateAsync({
      client_id: clientId ?? null,
      source: "manual",
      sender_email: values.sender_email || null,
      raw_subject: values.raw_subject,
      raw_body: values.raw_body,
      raw_attachments: null,
      status: "new",
    });

    if (files.length > 0) {
      const records: Array<{ name: string; storage_path: string; mime: string; size: number }> = [];
      for (const f of files) {
        const path = `${brief.id}/${crypto.randomUUID()}-${f.name}`;
        const { error } = await supabase.storage.from("brief-attachments").upload(path, f);
        if (error) {
          toast.error(`Upload failed: ${f.name}`);
          continue;
        }
        records.push({ name: f.name, storage_path: path, mime: f.type, size: f.size });
      }
      if (records.length > 0) {
        await updateBrief.mutateAsync({ id: brief.id, patch: { raw_attachments: records } });
      }
    }

    toast.success("Brief created");
    navigate("/briefs");
  };

  return (
    <div className="container mx-auto max-w-2xl p-6">
      <Card>
        <CardHeader>
          <CardTitle>New brief</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <div className="space-y-2">
              <Label>Client</Label>
              <Combobox
                options={clients.map((c) => ({ value: c.id, label: c.name }))}
                value={form.watch("client_id") ?? ""}
                onChange={(v) => form.setValue("client_id", v)}
                placeholder="Search existing clients…"
                emptyLabel="No match — create new below"
              />
              <Input placeholder="Or create new client (name)" {...form.register("new_client_name")} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="sender">Sender email (optional)</Label>
              <Input id="sender" type="email" {...form.register("sender_email")} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="subj">Subject</Label>
              <Input id="subj" {...form.register("raw_subject")} />
              {form.formState.errors.raw_subject && (
                <p className="text-body-small text-destructive">
                  {form.formState.errors.raw_subject.message}
                </p>
              )}
            </div>
            <div className="space-y-2">
              <Label htmlFor="body">Brief body</Label>
              <Textarea id="body" rows={10} {...form.register("raw_body")} />
              {form.formState.errors.raw_body && (
                <p className="text-body-small text-destructive">
                  {form.formState.errors.raw_body.message}
                </p>
              )}
            </div>
            <div className="space-y-2">
              <Label>Attachments</Label>
              <Input type="file" multiple onChange={(e) => setFiles(Array.from(e.target.files ?? []))} />
            </div>
            <Button type="submit" disabled={form.formState.isSubmitting}>
              Save brief
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
