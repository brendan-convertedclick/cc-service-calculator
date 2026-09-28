// src/pages/ResultsIndex.tsx
//
// /results — list of clients that have a year-results board (a school year
// or any results_groups already exist), each linking to its planner.

import { Link } from "react-router-dom";
import { ChevronRight, LayoutTemplate } from "lucide-react";
import { useResultsClients } from "@/hooks/useResults";
import { Card, CardContent } from "@/components/ui/card";

export function ResultsIndex() {
  const { data: clients, isLoading } = useResultsClients();

  return (
    <div className="container mx-auto max-w-3xl p-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-headline-medium">Year results</h1>
          <p className="mt-1 text-body-medium text-m-on-surface-variant">
            What each school planned month by month, and how it turned out.
          </p>
        </div>
        <Link
          to="/results/templates"
          className="flex items-center gap-1.5 text-label-large text-m-primary hover:underline"
        >
          <LayoutTemplate className="h-4 w-4" />
          Templates
        </Link>
      </div>

      {isLoading ? (
        <p className="mt-6 text-body-medium text-m-on-surface-variant">Loading…</p>
      ) : !clients?.length ? (
        <Card className="mt-6">
          <CardContent className="p-6 text-body-medium text-m-on-surface-variant">
            No school has a year board yet. Open a school from Pipeline and start its year, or add results groups
            from a client's planner once one exists.
          </CardContent>
        </Card>
      ) : (
        <div className="mt-6 grid gap-2">
          {clients.map((c) => (
            <Link key={c.id} to={`/results/${c.id}`}>
              <Card className="transition-colors hover:bg-m-surface-container-low">
                <CardContent className="flex items-center justify-between p-4">
                  <span className="text-body-large">{c.name}</span>
                  <ChevronRight className="h-4 w-4 text-m-on-surface-variant" />
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
