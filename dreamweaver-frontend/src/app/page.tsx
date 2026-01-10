import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Image, Video, Wand2, Film, Sparkles, ArrowRight } from "lucide-react";

const features = [
  {
    title: "Image Generation",
    description: "Create stunning images with visual camera controls and professional equipment simulation.",
    icon: Image,
    href: "/image",
    color: "text-blue-500",
    bgColor: "bg-blue-500/10",
  },
  {
    title: "Image Editing",
    description: "Edit, inpaint, and outpaint images with AI. Apply camera adjustments to existing photos.",
    icon: Wand2,
    href: "/edit",
    color: "text-purple-500",
    bgColor: "bg-purple-500/10",
  },
  {
    title: "Video Generation",
    description: "Transform images into cinematic videos with camera movements and professional presets.",
    icon: Video,
    href: "/video",
    color: "text-green-500",
    bgColor: "bg-green-500/10",
  },
  {
    title: "Cinema Studio",
    description: "Professional-grade cinematic content powered by real camera and lens simulation.",
    icon: Film,
    href: "/cinema",
    color: "text-primary",
    bgColor: "bg-primary/10",
    isNew: true,
  },
];

export default function Home() {
  return (
    <div className="min-h-screen bg-background">
      {/* Hero Section */}
      <section className="relative py-24 px-4">
        <div className="absolute inset-0 bg-gradient-to-b from-primary/5 to-transparent pointer-events-none" />
        <div className="container max-w-5xl mx-auto text-center relative">
          <div className="inline-flex items-center gap-2 rounded-full border border-border/50 bg-card px-4 py-1.5 text-sm mb-6">
            <Sparkles className="h-4 w-4 text-primary" />
            <span className="text-muted-foreground">Visual Prompting for AI Generation</span>
          </div>

          <h1 className="text-5xl md:text-7xl font-bold tracking-tight mb-6">
            <span className="text-gradient-lime">Dreamweaver</span>
          </h1>

          <p className="text-xl text-muted-foreground max-w-2xl mx-auto mb-10">
            Create stunning images and videos with intuitive visual controls.
            No prompting expertise needed — just drag, click, and generate.
          </p>

          <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
            <Button asChild size="lg" className="h-12 px-8 text-base glow-lime">
              <Link href="/image">
                <Image className="mr-2 h-5 w-5" />
                Start Creating
              </Link>
            </Button>
            <Button asChild variant="outline" size="lg" className="h-12 px-8 text-base">
              <Link href="/explore">
                Explore Gallery
                <ArrowRight className="ml-2 h-4 w-4" />
              </Link>
            </Button>
          </div>
        </div>
      </section>

      {/* Features Grid */}
      <section className="py-16 px-4">
        <div className="container max-w-6xl mx-auto">
          <div className="text-center mb-12">
            <p className="text-sm font-medium text-primary tracking-wide uppercase mb-3">
              EXPLORE FEATURES
            </p>
            <h2 className="text-3xl font-bold tracking-tight">
              Everything You Need to Create
            </h2>
          </div>

          <div className="grid md:grid-cols-2 gap-6">
            {features.map((feature) => (
              <Link key={feature.title} href={feature.href}>
                <Card className="bg-card border-border hover:border-primary/50 transition-all hover:shadow-lg hover:shadow-primary/5 h-full group">
                  <CardContent className="p-6">
                    <div className="flex items-start gap-4">
                      <div className={`flex h-12 w-12 items-center justify-center rounded-xl ${feature.bgColor}`}>
                        <feature.icon className={`h-6 w-6 ${feature.color}`} />
                      </div>
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-2">
                          <h3 className="text-lg font-semibold group-hover:text-primary transition-colors">
                            {feature.title}
                          </h3>
                          {feature.isNew && (
                            <span className="rounded bg-primary px-1.5 py-0.5 text-[10px] font-semibold text-primary-foreground">
                              NEW
                            </span>
                          )}
                        </div>
                        <p className="text-sm text-muted-foreground">
                          {feature.description}
                        </p>
                      </div>
                      <ArrowRight className="h-5 w-5 text-muted-foreground group-hover:text-primary group-hover:translate-x-1 transition-all" />
                    </div>
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>
        </div>
      </section>

      {/* Visual Controls Highlight */}
      <section className="py-16 px-4 bg-card/50">
        <div className="container max-w-6xl mx-auto">
          <div className="grid md:grid-cols-2 gap-12 items-center">
            <div>
              <p className="text-sm font-medium text-primary tracking-wide uppercase mb-3">
                VISUAL CONTROLS
              </p>
              <h2 className="text-3xl font-bold tracking-tight mb-4">
                3D Camera Control
              </h2>
              <p className="text-muted-foreground mb-6">
                Drag the colored handles to control camera angles visually.
                The green ring controls azimuth (horizontal rotation),
                the pink arc controls elevation, and the orange handle controls distance.
              </p>
              <ul className="space-y-3 text-sm">
                <li className="flex items-center gap-3">
                  <span className="w-3 h-3 rounded-full bg-[#00ff88]" />
                  <span>Azimuth: 8 positions around the subject</span>
                </li>
                <li className="flex items-center gap-3">
                  <span className="w-3 h-3 rounded-full bg-[#ff69b4]" />
                  <span>Elevation: Low angle to high angle shots</span>
                </li>
                <li className="flex items-center gap-3">
                  <span className="w-3 h-3 rounded-full bg-[#ffa500]" />
                  <span>Distance: Close-up to wide shots</span>
                </li>
              </ul>
            </div>
            <div className="aspect-[4/3] rounded-xl bg-[#1a1a1a] border border-border flex items-center justify-center">
              <p className="text-muted-foreground text-sm">3D Preview</p>
            </div>
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="py-24 px-4">
        <div className="container max-w-4xl mx-auto text-center">
          <h2 className="text-3xl font-bold tracking-tight mb-4">
            Ready to Create?
          </h2>
          <p className="text-muted-foreground mb-8 max-w-lg mx-auto">
            Start generating professional-quality images and videos today.
            No prompting expertise required.
          </p>
          <Button asChild size="lg" className="h-12 px-10 text-base glow-lime">
            <Link href="/image">
              <Sparkles className="mr-2 h-5 w-5" />
              Get Started
            </Link>
          </Button>
        </div>
      </section>
    </div>
  );
}
