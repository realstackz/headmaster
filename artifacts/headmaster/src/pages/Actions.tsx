import React from "react";
import { AppLayout } from "@/components/layout/AppLayout";
import {
  useListActions,
  useUpdateAction,
  getListActionsQueryKey,
  getGetGraphSummaryQueryKey,
  ActionStatus,
  UpdateActionBodyStatus,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { Clock, Loader2, CheckCircle2, Circle, ArrowRight, Zap } from "lucide-react";
import { cn } from "@/lib/utils";

const COLUMNS: {
  id: ActionStatus;
  label: string;
  icon: React.ElementType;
  color: string;
  dot: string;
}[] = [
  { id: "pending",     label: "To Do",      icon: Circle,       color: "text-muted-foreground", dot: "bg-muted-foreground" },
  { id: "in_progress", label: "In Progress", icon: Loader2,      color: "text-blue-400",         dot: "bg-blue-400" },
  { id: "done",        label: "Done",        icon: CheckCircle2, color: "text-green-400",        dot: "bg-green-400" },
];

const NEXT_STATUS: Record<ActionStatus, UpdateActionBodyStatus | null> = {
  pending:     "in_progress",
  in_progress: "done",
  done:        null,
};

export default function Actions() {
  const { data: actions = [], isLoading } = useListActions();
  const updateAction = useUpdateAction();
  const queryClient  = useQueryClient();
  const { toast }    = useToast();

  const handleStatus = async (id: string, status: UpdateActionBodyStatus) => {
    try {
      await updateAction.mutateAsync({ id, data: { status } });
      queryClient.invalidateQueries({ queryKey: getListActionsQueryKey() });
      queryClient.invalidateQueries({ queryKey: getGetGraphSummaryQueryKey() });
    } catch {
      toast({ title: "Failed to update", variant: "destructive" });
    }
  };

  return (
    <AppLayout>
      <div className="flex flex-col h-full overflow-hidden">
        {/* Page header — roadmap.sh style */}
        <div className="px-8 py-5 border-b border-border shrink-0">
          <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1 font-mono">
            <span>Headmaster</span>
            <ArrowRight className="w-3 h-3" />
            <span className="text-foreground">Actions</span>
          </div>
          <h1 className="text-xl font-semibold tracking-tight">Actions Board</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Tasks extracted from your knowledge graph. Move them through to completion.
          </p>
        </div>

        {isLoading ? (
          <div className="flex-1 flex items-center justify-center">
            <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <div className="flex-1 flex gap-4 p-6 overflow-hidden">
            {COLUMNS.map((col) => {
              const ColIcon = col.icon;
              const colActions = actions.filter((a) => a.status === col.id);
              return (
                <div
                  key={col.id}
                  className="flex-1 flex flex-col rounded-lg border border-border bg-muted/20 overflow-hidden"
                  data-testid={`column-${col.id}`}
                >
                  {/* Column header */}
                  <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-card/50 shrink-0">
                    <div className="flex items-center gap-2">
                      <span className={cn("w-1.5 h-1.5 rounded-full", col.dot)} />
                      <span className={cn("text-xs font-semibold uppercase tracking-wider font-mono", col.color)}>
                        {col.label}
                      </span>
                    </div>
                    <span className="text-[10px] font-mono text-muted-foreground bg-muted px-1.5 py-0.5 rounded">
                      {colActions.length}
                    </span>
                  </div>

                  {/* Cards */}
                  <div className="flex-1 overflow-y-auto p-3 flex flex-col gap-2">
                    {colActions.length === 0 ? (
                      <div className="flex-1 flex items-center justify-center">
                        <p className="text-xs text-muted-foreground">No {col.label.toLowerCase()} actions</p>
                      </div>
                    ) : (
                      colActions.map((action) => {
                        const next = NEXT_STATUS[action.status as ActionStatus];
                        const nextCol = next ? COLUMNS.find((c) => c.id === next) : null;
                        return (
                          <div
                            key={action.id}
                            data-testid={`action-card-${action.id}`}
                            className="bg-card border border-border rounded-md p-3.5 hover:border-muted-foreground/40 transition-colors group"
                          >
                            <div className="flex items-start gap-2.5">
                              <div className="mt-0.5 shrink-0 p-1 rounded-sm bg-green-500/10">
                                <Zap className="w-3 h-3 text-green-500" strokeWidth={2.5} />
                              </div>
                              <div className="flex-1 min-w-0">
                                <p className="text-sm font-medium text-foreground leading-snug">
                                  {action.title}
                                </p>
                                {action.description && (
                                  <p className="text-xs text-muted-foreground mt-1 leading-relaxed line-clamp-2">
                                    {action.description}
                                  </p>
                                )}
                              </div>
                            </div>

                            {/* Status buttons — appear on hover */}
                            {(next || action.status !== "pending") && (
                              <div className="mt-3 pt-2.5 border-t border-border flex items-center gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
                                {action.status !== "pending" && (
                                  <button
                                    onClick={() => handleStatus(action.id, "pending")}
                                    className="text-[10px] font-mono px-2 py-1 rounded bg-muted hover:bg-muted/80 text-muted-foreground transition-colors"
                                  >
                                    To Do
                                  </button>
                                )}
                                {next && nextCol && (
                                  <button
                                    onClick={() => handleStatus(action.id, next)}
                                    className={cn(
                                      "text-[10px] font-mono px-2 py-1 rounded transition-colors ml-auto",
                                      next === "in_progress"
                                        ? "bg-blue-500/10 text-blue-400 hover:bg-blue-500/20"
                                        : "bg-green-500/10 text-green-400 hover:bg-green-500/20"
                                    )}
                                  >
                                    Mark {nextCol.label}
                                  </button>
                                )}
                              </div>
                            )}
                          </div>
                        );
                      })
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </AppLayout>
  );
}
