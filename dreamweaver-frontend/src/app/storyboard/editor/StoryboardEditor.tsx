"use client";

import StoryboardPage from "@/app/storyboard/[storyboardId]/page";

type StoryboardEditorProps = {
  storyboardId: string;
};

export function StoryboardEditor({ storyboardId }: StoryboardEditorProps) {
  return <StoryboardPage storyboardIdOverride={storyboardId} />;
}
