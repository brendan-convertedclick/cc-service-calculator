import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export type ClientOption = { id: string; name: string };

type ClientSelectFieldProps = {
  /** Used as both the trigger's id and its label's htmlFor. */
  id: string;
  clients: ClientOption[];
  value: string;
  onValueChange: (value: string) => void;
};

/**
 * The "Client" picker shared by the staff self-service forms (brief,
 * revision, extension). Pure presentational — callers own the clients list
 * and the selected value.
 */
export function ClientSelectField({ id, clients, value, onValueChange }: ClientSelectFieldProps) {
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>Client</Label>
      <Select value={value} onValueChange={onValueChange}>
        <SelectTrigger id={id}>
          <SelectValue placeholder="Pick a client" />
        </SelectTrigger>
        <SelectContent>
          {clients.map((c) => (
            <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
