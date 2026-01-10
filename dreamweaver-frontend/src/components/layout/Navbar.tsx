"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { Sparkles } from "lucide-react";

const navItems = [
    { title: "Explore", href: "/explore" },
    { title: "Image", href: "/image", active: true },
    { title: "Video", href: "/video" },
    { title: "Edit", href: "/edit" },
    { title: "Character", href: "/character" },
    { title: "Inpaint", href: "/inpaint" },
    { title: "Cinema Studio", href: "/cinema", badge: "V1.5" },
    { title: "Assist", href: "/assist" },
    { title: "Apps", href: "/apps" },
    { title: "Community", href: "/community" },
];

export function Navbar() {
    const pathname = usePathname();

    return (
        <nav className="fixed top-0 left-0 right-0 z-50 h-14 bg-background border-b border-border/30">
            <div className="flex h-full items-center justify-between px-4 max-w-[1800px] mx-auto">
                {/* Logo */}
                <Link href="/" className="flex items-center gap-2 mr-8">
                    <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10 border border-primary/30">
                        <Sparkles className="h-4 w-4 text-primary" />
                    </div>
                </Link>

                {/* Navigation Links */}
                <div className="flex-1 flex items-center gap-1">
                    {navItems.map((item) => {
                        const isActive = pathname === item.href || pathname.startsWith(item.href + "/");

                        return (
                            <Link
                                key={item.title}
                                href={item.href}
                                className={cn(
                                    "flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-colors",
                                    isActive
                                        ? "bg-muted text-foreground border border-border/50"
                                        : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
                                )}
                            >
                                {item.title}
                                {item.badge && (
                                    <span className="text-[10px] font-semibold text-primary bg-primary/10 px-1.5 py-0.5 rounded">
                                        {item.badge}
                                    </span>
                                )}
                            </Link>
                        );
                    })}
                </div>

                {/* Right Side - Pricing and Profile */}
                <div className="flex items-center gap-4">
                    <Link
                        href="/pricing"
                        className="text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
                    >
                        Pricing
                    </Link>
                    <button className="h-8 w-8 rounded-full bg-primary/20 border border-primary/30 flex items-center justify-center text-xs font-semibold text-primary">
                        L
                    </button>
                </div>
            </div>
        </nav>
    );
}
