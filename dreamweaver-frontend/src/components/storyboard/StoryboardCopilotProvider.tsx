"use client";

import { ReactNode } from "react";
import { CopilotKit } from "@copilotkit/react-core";

export function StoryboardCopilotProvider({ children }: { children: ReactNode }) {
  return (
    <CopilotKit runtimeUrl="/api/copilotkit/storyboard" agent="storyboard_agent">
      {children}
    </CopilotKit>
  );
}

