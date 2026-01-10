"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { Image as ImageIcon, Video, Wand2 } from "lucide-react";
import { Button } from "@/components/ui/button";

const NAV_ITEMS = [
    { href: "/image", label: "Image", icon: ImageIcon },
    { href: "/video", label: "Video", icon: Video },
    { href: "/edit", label: "Edit", icon: Wand2 },
];

export function Navbar() {
    const pathname = usePathname();

    return (
        <header className="sticky top-0 z-50 h-14 border-b border-border/50 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
            <div className="container h-full flex items-center justify-between px-4">
                {/* Logo */}
                <Link href="/" className="flex items-center gap-2">
                    <div className="w-8 h-8 rounded-lg bg-primary flex items-center justify-center">
                        <span className="text-primary-foreground font-bold text-sm">D</span>
                    </div>
                    <span className="font-semibold text-lg hidden sm:inline">Dreamweaver</span>
                </Link>

                {/* Navigation */}
                <nav className="flex items-center gap-1">
                    {NAV_ITEMS.map((item) => {
                        const isActive = pathname === item.href || (item.href !== "/" && pathname.startsWith(item.href));
                        const Icon = item.icon;
                        return (
                            <Link key={item.href} href={item.href}>
                                <Button
                                    variant={isActive ? "secondary" : "ghost"}
                                    size="sm"
                                    className={cn(
                                        "gap-2 h-9 px-4",
                                        isActive && "bg-muted text-foreground"
                                    )}
                                >
                                    <Icon className="w-4 h-4" />
                                    <span className="font-medium">{item.label}</span>
                                </Button>
                            </Link>
                        );
                    })}
                </nav>

                {/* Right side - empty for now */}
                <div className="w-24" />
            </div>
        </header>
    );
}
