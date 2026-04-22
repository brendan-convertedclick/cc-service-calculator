import MDEditor from "@uiw/react-md-editor";
import { Label } from "@/components/ui/label";

type ScopeValues = {
  enhanced_prose: string;
  in_scope_md: string;
  out_of_scope_md: string;
  open_questions_md: string;
};

type Props = {
  value: ScopeValues;
  onChange: (v: Partial<ScopeValues>) => void;
  disabled?: boolean;
};

export function ScopeEditor({ value, onChange, disabled }: Props) {
  const section = (key: keyof ScopeValues, label: string, rows = 6) => (
    <div className="space-y-2">
      <Label>{label}</Label>
      <MDEditor
        value={value[key]}
        onChange={(v) => onChange({ [key]: v ?? "" })}
        height={rows * 28}
        textareaProps={{ disabled }}
        preview="edit"
      />
    </div>
  );

  return (
    <div className="space-y-4">
      {section("enhanced_prose", "Clarified summary", 4)}
      {section("in_scope_md", "In scope", 6)}
      {section("out_of_scope_md", "Out of scope", 6)}
      {section("open_questions_md", "Open questions", 6)}
    </div>
  );
}
