import React from "react";
import { Link, useLocation } from "wouter";
import { BrainCircuit } from "lucide-react";
import { cn } from "@/lib/utils";
import { useGetGraphSummary } from "@workspace/api-client-react";

export function Topbar() {
  const [location] = useLocation();
  const { data: summary } = useGetGraphSummary();

  const navItems = [
    { label: "Graph",   href: "/" },
    { label: "Roadmap", href: "/roadmap" },
    { label: "Inputs",  href: "/inputs" },
    { label: "Actions", href: "/actions" },
  ];

  return (
    <header className="h-12 shrink-0 border-b bg-topbar border-topbar-border flex items-center px-4 gap-6 z-20">
      {/* Logo */}
      <Link href="/">
        <div className="flex items-center gap-2 text-foreground hover:text-primary transition-colors cursor-pointer select-none">
          <BrainCircuit className="w-5 h-5 text-primary" strokeWidth={1.75} />
          <span className="font-semibold text-sm tracking-tight">Headmaster</span>
        </div>
      </Link>

      <div className="w-px h-4 bg-border" />

      {/* Nav */}
      <nav className="flex items-center gap-1">
        {navItems.map((item) => (
          <Link key={item.href} href={item.href}>
            <span
              className={cn(
                "px-3 py-1.5 rounded text-sm font-medium transition-colors cursor-pointer",
                location === item.href
                  ? "bg-accent text-foreground"
                  : "text-muted-foreground hover:text-foreground hover:bg-accent/60"
              )}
            >
              {item.label}
            </span>
          </Link>
        ))}
      </nav>

      {/* Spacer */}
      <div className="flex-1" />

      {/* Live stats */}
      {summary && (
        <div className="flex items-center gap-4 text-xs text-muted-foreground font-mono">
          <span>
            <span className="text-foreground font-semibold">{summary.totalNodes}</span> nodes
          </span>
          <span className="text-border">·</span>
          <span>
            <span className="text-foreground font-semibold">{summary.totalEdges}</span> connections
          </span>
          <span className="text-border">·</span>
          <span>
            <span className="text-foreground font-semibold">{summary.actionsByStatus.pending}</span> actions pending
          </span>
        </div>
      )}
    </header>
  );
}
