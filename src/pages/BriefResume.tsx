import { useEffect } from "react";
import { Navigate, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { resumeHref, type Brief } from "@/lib/brief-routing";

export function BriefResume() {
  const { id } = useParams<{ id: string }>();

  const { data, isLoading, error } = useQuery({
    queryKey: ["brief-resume", id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("briefs")
        .select("id, status")
        .eq("id", id!)
        .single();
      if (error) throw error;
      return data as Pick<Brief, "id" | "status">;
    },
    enabled: !!id,
  });

  useEffect(() => {
    if (error) console.error("BriefResume: failed to load brief", error);
  }, [error]);

  if (!id) return <Navigate to="/briefs" replace />;
  if (isLoading) return null;
  if (error || !data) return <Navigate to="/briefs" replace />;

  return <Navigate to={resumeHref(data as Brief)} replace />;
}
