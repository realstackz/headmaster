import React, { useState } from "react";
import { AppLayout } from "@/components/layout/AppLayout";
import { GraphWorkspace } from "@/components/graph/GraphWorkspace";
import {
  useCreateInput,
  useProcessInput,
  getGetGraphDataQueryKey,
  getListInputsQueryKey,
  getListNodesQueryKey,
  getGetGraphSummaryQueryKey,
  CreateInputBodyType,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, Sparkles, FileText, Globe, StickyNote } from "lucide-react";
import { cn } from "@/lib/utils";

const TYPE_OPTIONS = [
  { value: "text", label: "Text / Idea",      icon: FileText  },
  { value: "note", label: "Note",             icon: StickyNote },
  { value: "url",  label: "URL / Article",    icon: Globe     },
] as const;

export default function Home() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const createInput  = useCreateInput();
  const processInput = useProcessInput();

  const [title,        setTitle]        = useState("");
  const [content,      setContent]      = useState("");
  const [type,         setType]         = useState<CreateInputBodyType>("text");
  const [isProcessing, setIsProcessing] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() || !content.trim()) {
      toast({ title: "Title and content are required", variant: "destructive" });
      return;
    }

    try {
      setIsProcessing(true);
      const input = await createInput.mutateAsync({ data: { title, content, type } });
      await processInput.mutateAsync({ id: input.id });

      queryClient.invalidateQueries({ queryKey: getGetGraphDataQueryKey() });
      queryClient.invalidateQueries({ queryKey: getListInputsQueryKey() });
      queryClient.invalidateQueries({ queryKey: getListNodesQueryKey() });
      queryClient.invalidateQueries({ queryKey: getGetGraphSummaryQueryKey() });

      toast({ title: "Mapped to graph", description: "New nodes and connections added." });
      setTitle(""); setContent(""); setType("text");
    } catch {
      toast({ title: "Processing failed", description: "Check your OpenAI key and try again.", variant: "destructive" });
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <AppLayout>
      <div className="flex flex-1 overflow-hidden h-full">
        {/* Graph canvas */}
        <div className="flex-1 relative flex flex-col min-w-0">
          <GraphWorkspace />
        </div>

        {/* Ingest panel */}
        <aside className="w-72 shrink-0 border-l border-border bg-card flex flex-col h-full overflow-hidden">
          {/* Header */}
          <div className="px-5 py-4 border-b border-border">
            <div className="flex items-center gap-2 mb-1">
              <Sparkles className="w-3.5 h-3.5 text-primary" strokeWidth={2} />
              <h2 className="text-sm font-semibold text-foreground">Add to Graph</h2>
            </div>
            <p className="text-xs text-muted-foreground leading-relaxed">
              Paste any text, note, or URL. AI extracts nodes and connections automatically.
            </p>
          </div>

          {/* Form */}
          <form onSubmit={handleSubmit} className="flex-1 flex flex-col gap-4 px-5 py-4 overflow-y-auto">
            {/* Type selector — pill buttons */}
            <div className="flex gap-1.5">
              {TYPE_OPTIONS.map(({ value, label, icon: Icon }) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setType(value as CreateInputBodyType)}
                  className={cn(
                    "flex-1 flex flex-col items-center gap-1 py-2 px-1 rounded-md border text-xs font-medium transition-colors",
                    type === value
                      ? "border-primary/50 bg-primary/8 text-foreground"
                      : "border-border bg-background text-muted-foreground hover:border-muted-foreground/40 hover:text-foreground"
                  )}
                >
                  <Icon className="w-3.5 h-3.5" strokeWidth={2} />
                  <span className="leading-none">{value === "url" ? "URL" : value === "note" ? "Note" : "Text"}</span>
                </button>
              ))}
            </div>

            {/* Title */}
            <div className="flex flex-col gap-1.5">
              <label className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
                Title
              </label>
              <Input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="e.g. Second Brain Framework"
                className="bg-background text-sm h-9"
                disabled={isProcessing}
                data-testid="input-title"
              />
            </div>

            {/* Content */}
            <div className="flex flex-col gap-1.5 flex-1">
              <label className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
                Content
              </label>
              <Textarea
                value={content}
                onChange={(e) => setContent(e.target.value)}
                placeholder={type === "url" ? "https://..." : "Paste your notes, thoughts, or excerpts here…"}
                className="flex-1 bg-background resize-none text-sm min-h-[180px]"
                disabled={isProcessing}
                data-testid="input-content"
              />
            </div>

            {/* Submit */}
            <button
              type="submit"
              disabled={isProcessing || !title.trim() || !content.trim()}
              data-testid="button-process"
              className={cn(
                "w-full flex items-center justify-center gap-2 py-2.5 rounded-md text-sm font-semibold transition-all",
                "bg-primary text-primary-foreground hover:bg-primary/90",
                "disabled:opacity-40 disabled:cursor-not-allowed"
              )}
            >
              {isProcessing ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  Processing…
                </>
              ) : (
                <>
                  <Sparkles className="w-3.5 h-3.5" />
                  Process &amp; Map
                </>
              )}
            </button>
          </form>
        </aside>
      </div>
    </AppLayout>
  );
}
