import React from "react";
import { Link, useLocation } from "wouter";
import { Activity, Database, CheckSquare, Circle } from "lucide-react";
import { cn } from "@/lib/utils";
import { useGetGraphSummary } from "@workspace/api-client-react";

const NODE_TYPES = [
  { key: "concept", label: "Concept", color: "hsl(var(--node-concept))" },
  { key: "insight", label: "Insight", color: "hsl(var(--node-insight))" },
  { key: "action",  label: "Action",  color: "hsl(var(--node-action))"  },
  { key: "goal",    label: "Goal",    color: "hsl(var(--node-goal))"    },
] as const;

export function Sidebar() {
  const [location] = useLocation();
  const { data: summary } = useGetGraphSummary();

  const navItems = [
    {
      label: "Graph",
      href: "/",
      icon: Activity,
      count: summary?.totalNodes,
    },
    {
      label: "Inputs",
      href: "/inputs",
      icon: Database,
      count: summary?.totalInputs,
    },
    {
      label: "Actions",
      href: "/actions",
      icon: CheckSquare,
      count: summary?.actionsByStatus.pending,
      countLabel: "pending",
    },
  ];

  return (
    <aside className="w-52 shrink-0 flex flex-col border-r border-sidebar-border bg-sidebar h-full">
      {/* Nav section */}
      <div className="flex-1 py-3 flex flex-col gap-0.5 px-2 overflow-y-auto">
        <p className="px-2 pt-1 pb-2 text-[10px] font-semibold text-muted-foreground uppercase tracking-widest">
          Navigate
        </p>

        {navItems.map((item) => {
          const active = location === item.href;
          return (
            <Link key={item.href} href={item.href}>
              <div
                className={cn(
                  "flex items-center gap-2.5 px-2.5 py-2 rounded-md text-sm transition-colors cursor-pointer group",
                  active
                    ? "bg-sidebar-primary text-sidebar-primary-foreground"
                    : "text-sidebar-foreground/60 hover:bg-sidebar-accent hover:text-sidebar-foreground"
                )}
              >
                <item.icon className={cn("w-3.5 h-3.5 shrink-0", active ? "text-primary" : "text-muted-foreground group-hover:text-foreground")} strokeWidth={2} />
                <span className="flex-1 font-medium">{item.label}</span>
                {item.count !== undefined && item.count > 0 && (
                  <span
                    className={cn(
                      "text-[10px] font-mono px-1.5 py-0.5 rounded-sm leading-none",
                      active
                        ? "bg-white/10 text-primary-foreground/70"
                        : "bg-muted text-muted-foreground"
                    )}
                  >
                    {item.count}
                  </span>
                )}
              </div>
            </Link>
          );
        })}

        {/* Node type legend */}
        <div className="mt-4 pt-3 border-t border-sidebar-border">
          <p className="px-2 pb-2 text-[10px] font-semibold text-muted-foreground uppercase tracking-widest">
            Node Types
          </p>
          <div className="flex flex-col gap-0.5 px-1">
            {NODE_TYPES.map(({ key, label, color }) => {
              const count = summary?.nodesByType[key] ?? 0;
              return (
                <div key={key} className="flex items-center gap-2 px-1.5 py-1.5 rounded-md text-xs text-sidebar-foreground/60">
                  <span className="w-2 h-2 rounded-sm shrink-0" style={{ backgroundColor: color }} />
                  <span className="flex-1">{label}</span>
                  <span className="font-mono text-muted-foreground text-[10px]">{count}</span>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Footer */}
      <div className="p-3 border-t border-sidebar-border">
        <div className="flex items-center gap-1.5">
          <Circle className="w-1.5 h-1.5 fill-green-500 text-green-500" />
          <span className="text-[10px] text-muted-foreground font-mono">AI ready</span>
        </div>
      </div>
    </aside>
  );
}
