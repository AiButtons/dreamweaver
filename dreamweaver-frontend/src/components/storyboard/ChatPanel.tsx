import React, { useMemo, useRef, useState } from "react";
import { Sparkles, Send, ChevronDown } from "lucide-react";
import { ChatMessage, StoryNode } from "@/app/storyboard/types";
import ContextWidget from "./ContextWidget";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";

interface ChatPanelProps {
  messages: ChatMessage[];
  onSendMessage: (message: string) => void;
  isGenerating: boolean;
  selectedNode: StoryNode | null;
  onClearSelection: () => void;
}

const ChatPanel: React.FC<ChatPanelProps> = ({
  messages,
  onSendMessage,
  isGenerating,
  selectedNode,
  onClearSelection
}) => {
  const [input, setInput] = useState("");
  const [showConversation, setShowConversation] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  const quickActions = useMemo(() => {
    if (selectedNode) {
      return [
        {
          label: "Expand into shots",
          prompt: `Expand node "${selectedNode.data.label}" into 6-10 shot nodes with cinematic coverage.`,
        },
        {
          label: "Continuity check",
          prompt: `Check continuity for node "${selectedNode.data.label}" and propose fixes if needed.`,
        },
        {
          label: "Generate prompt pack",
          prompt: `Create an image prompt pack for node "${selectedNode.data.label}" using rolling history and character consistency.`,
        },
      ];
    }
    return [
      { label: "Draft 6-scene outline", prompt: "Draft a 6-scene outline for this story with escalating stakes." },
      { label: "Add main characters", prompt: "Propose 3-5 main characters with distinct motivations and arcs." },
      { label: "Branch an alternate ending", prompt: "Propose a branch for an alternate ending and where it splits." },
    ];
  }, [selectedNode]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (input.trim() && !isGenerating) {
      onSendMessage(input);
      setInput("");
    }
  };

  return (
    <div className="h-full flex flex-col border-r border-border/60 bg-background/40">
      <div className="px-4 pt-4 pb-3 border-b border-border/60 bg-background/40">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <Sparkles className="size-4 text-primary" />
              <div className="text-sm font-semibold tracking-tight">Assistant</div>
            </div>
            <div className="text-xs text-muted-foreground mt-0.5">
              {selectedNode ? "Director notes for the selected node." : "High-level story direction and drafting."}
            </div>
          </div>
          <Collapsible open={showConversation} onOpenChange={setShowConversation}>
            <CollapsibleTrigger asChild>
              <Button variant="ghost" size="sm" className="h-8 gap-1">
                Conversation
                <ChevronDown className={cn("size-4 transition-transform", showConversation && "rotate-180")} />
              </Button>
            </CollapsibleTrigger>
          </Collapsible>
        </div>

        <div className="mt-3 flex flex-wrap gap-2">
          {quickActions.map((action) => (
            <Button
              key={action.label}
              type="button"
              variant="secondary"
              size="sm"
              className="h-8"
              disabled={isGenerating}
              onClick={() => {
                setInput(action.prompt);
              }}
            >
              {action.label}
            </Button>
          ))}
        </div>
      </div>

      <Collapsible open={showConversation} onOpenChange={setShowConversation}>
        <CollapsibleContent className="border-b border-border/60">
          <ScrollArea className="h-[40vh]">
            <div className="p-4 space-y-4" ref={scrollRef}>
              {messages.map((msg) => (
                <div
                  key={msg.id}
                  className={cn("flex flex-col", msg.role === "user" ? "items-end" : "items-start")}
                >
                  <div
                    className={cn(
                      "max-w-[92%] rounded-2xl px-4 py-3 text-sm leading-relaxed border",
                      msg.role === "user"
                        ? "bg-primary text-primary-foreground border-primary/20 rounded-br-none"
                        : "bg-card/60 text-foreground border-border/60 rounded-bl-none",
                    )}
                  >
                    {msg.content}
                  </div>
                  <span className="text-[10px] text-muted-foreground mt-1 px-1">
                    {msg.role === "user" ? "You" : "Assistant"}
                  </span>
                </div>
              ))}
              {isGenerating ? (
                <div className="text-xs text-muted-foreground">Thinking...</div>
              ) : null}
            </div>
          </ScrollArea>
        </CollapsibleContent>
      </Collapsible>

      <div className="mt-auto p-4">
        {selectedNode ? (
          <div className="mb-3">
            <ContextWidget selectedNode={selectedNode} onClearSelection={onClearSelection} />
          </div>
        ) : null}

        <form onSubmit={handleSubmit} className="space-y-2">
          <Textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={selectedNode ? `Give direction for "${selectedNode.data.label}"...` : "Give a director note or drafting instruction..."}
            disabled={isGenerating}
            className="min-h-[84px] bg-background/60"
          />
          <div className="flex items-center justify-between">
            <div className="text-[11px] text-muted-foreground">
              Enter to send. Shift+Enter for newline.
            </div>
            <Button type="submit" disabled={!input.trim() || isGenerating} className="gap-2">
              <Send className="size-4" />
              Send
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default ChatPanel;
