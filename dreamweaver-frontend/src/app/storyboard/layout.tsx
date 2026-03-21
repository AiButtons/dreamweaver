import React from 'react';
import './storyboard.css'; // Import the specific CSS
import "@copilotkit/react-ui/styles.css";
import { StoryboardCopilotProvider } from "@/components/storyboard/StoryboardCopilotProvider";

export default function StoryboardLayout({
    children,
}: {
    children: React.ReactNode;
}) {
    return (
        <StoryboardCopilotProvider>
            <div className="storyboard-layout h-screen w-full bg-background text-foreground">
                {children}
            </div>
        </StoryboardCopilotProvider>
    );
}
