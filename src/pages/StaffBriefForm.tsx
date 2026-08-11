import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { BriefFormBody } from "@/components/staff/BriefFormBody";
import { ExtensionFormBody } from "@/components/staff/ExtensionFormBody";
import { MeetingFormBody } from "@/components/staff/MeetingFormBody";
import { MyMeetingsList } from "@/components/staff/MyMeetingsList";
import { MyRequestsList } from "@/components/staff/MyRequestsList";
import { RevisionFormBody } from "@/components/staff/RevisionFormBody";
import { ClickUpConnectCard } from "@/components/ClickUpConnectCard";

/**
 * "My work" — everyone's own request desk, and where staff land after signing
 * in. It renders inside the AppShell like every other page, so identity,
 * profile and sign-out live in the nav rail rather than a header of its own.
 *
 * Four tabs:
 *   - New brief          — Phase 1
 *   - Extension request  — Phase 2
 *   - Request Revision   — new DFT/REV-stage task, admin-approved
 *   - Internal meeting   — schedule + manage internal meetings (Google
 *     Calendar + ClickUp overhead task)
 *
 * Component name kept as `StaffBriefForm` to avoid churn in routing.
 */
export function StaffBriefForm() {
  return (
    <div className="relative min-h-full overflow-hidden bg-m-surface-container-low">
      <div
        aria-hidden
        className="absolute inset-0 -z-10 opacity-40"
        style={{
          background:
            "radial-gradient(60% 40% at 20% 10%, hsl(var(--mcolor-primary-container)) 0%, transparent 60%), " +
            "radial-gradient(50% 40% at 80% 90%, hsl(var(--mcolor-tertiary-container)) 0%, transparent 60%)",
        }}
      />
      <main className="mx-auto max-w-4xl space-y-6 px-4 py-10">
        <ClickUpConnectCard />
        <Card className="shadow-elev-2">
          <CardHeader>
            <CardTitle className="text-headline-small">Submit work</CardTitle>
            <CardDescription>
              Brief a new task or request extra sprint points on something you're
              already working on.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Tabs defaultValue="extension" className="space-y-6">
              <TabsList className="grid w-full grid-cols-5">
                <TabsTrigger value="extension">Extension request</TabsTrigger>
                <TabsTrigger value="brief">New brief</TabsTrigger>
                <TabsTrigger value="revision">Request Revision</TabsTrigger>
                <TabsTrigger value="meeting">Internal meeting</TabsTrigger>
                <TabsTrigger value="mine">My requests</TabsTrigger>
              </TabsList>
              <TabsContent value="extension" className="space-y-0">
                <ExtensionFormBody />
              </TabsContent>
              <TabsContent value="brief" className="space-y-0">
                <BriefFormBody />
              </TabsContent>
              <TabsContent value="revision" className="space-y-0">
                <RevisionFormBody />
              </TabsContent>
              <TabsContent value="meeting" className="space-y-6">
                <MeetingFormBody />
                <MyMeetingsList />
              </TabsContent>
              <TabsContent value="mine" className="space-y-0">
                <MyRequestsList />
              </TabsContent>
            </Tabs>
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
