import { Calculator, LogOut } from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { BriefFormBody } from "@/components/staff/BriefFormBody";
import { ExtensionFormBody } from "@/components/staff/ExtensionFormBody";

/**
 * Phase 1 + 2 staff portal: the single page that staff-role users see when
 * they log in. Two tabs:
 *   - New brief        — Phase 1
 *   - Extension request — Phase 2
 *
 * Component name kept as `StaffBriefForm` to avoid churn in routing.
 */
export function StaffBriefForm() {
  const { user, signOut } = useAuth();

  return (
    <div className="relative min-h-screen overflow-hidden bg-m-surface-container-low">
      <div
        aria-hidden
        className="absolute inset-0 -z-10 opacity-40"
        style={{
          background:
            "radial-gradient(60% 40% at 20% 10%, hsl(var(--mcolor-primary-container)) 0%, transparent 60%), " +
            "radial-gradient(50% 40% at 80% 90%, hsl(var(--mcolor-tertiary-container)) 0%, transparent 60%)",
        }}
      />
      <header className="flex items-center justify-between border-b border-m-outline-variant/40 bg-m-surface/60 px-6 py-3 backdrop-blur">
        <div className="flex items-center gap-3">
          <div className="grid h-9 w-9 place-items-center rounded-md bg-m-primary-container text-m-on-primary-container">
            <Calculator className="h-4 w-4" />
          </div>
          <div className="leading-tight">
            <div className="text-title-small text-m-on-surface">Conductor</div>
            <div className="text-label-small text-m-on-surface-variant">Brief & extensions</div>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <div className="hidden text-right sm:block">
            <div className="text-body-small text-m-on-surface">{user?.email}</div>
          </div>
          <Button variant="ghost" size="sm" onClick={() => signOut()} title="Sign out">
            <LogOut className="h-4 w-4" />
          </Button>
        </div>
      </header>

      <main className="mx-auto max-w-2xl px-4 py-10">
        <Card className="shadow-elev-2">
          <CardHeader>
            <CardTitle className="text-headline-small">Submit work</CardTitle>
            <CardDescription>
              Brief a new task or request extra sprint points on something you're
              already working on.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Tabs defaultValue="brief" className="space-y-6">
              <TabsList className="grid w-full grid-cols-2">
                <TabsTrigger value="brief">New brief</TabsTrigger>
                <TabsTrigger value="extension">Extension request</TabsTrigger>
              </TabsList>
              <TabsContent value="brief" className="space-y-0">
                <BriefFormBody />
              </TabsContent>
              <TabsContent value="extension" className="space-y-0">
                <ExtensionFormBody />
              </TabsContent>
            </Tabs>
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
