import React from 'react';
import './storyboard.css'; // Import the specific CSS

export default function StoryboardLayout({
    children,
}: {
    children: React.ReactNode;
}) {
    return (
        <div className="storyboard-layout h-screen w-full bg-white text-slate-900">
            {/* Ensure full screen and isolation from main app styles if necessary */}
            {children}
        </div>
    );
}
