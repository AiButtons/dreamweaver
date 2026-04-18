"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useMutation } from "convex/react";
import { authClient } from "@/lib/auth-client";
import { mutationRef } from "@/lib/convexRefs";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type AuthMode = "sign_in" | "sign_up" | "reset";

type AuthErrorShape = {
  message?: string;
};

export default function AuthPage() {
  const router = useRouter();
  const params = useSearchParams();
  const redirectTo = useMemo(() => params.get("redirect") ?? "/storyboard", [params]);
  const [mode, setMode] = useState<AuthMode>("sign_in");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const resetPasswordDev = useMutation(mutationRef("_debugAuth:resetPasswordDev"));

  const submit = async () => {
    setErrorMessage(null);
    setSuccessMessage(null);
    setIsSubmitting(true);
    try {
      if (mode === "sign_up") {
        const result = await authClient.signUp.email({
          name: name.trim(),
          email: email.trim(),
          password,
          callbackURL: redirectTo,
        });
        if (result.error) {
          const error = result.error as AuthErrorShape;
          setErrorMessage(error.message ?? "Sign up failed.");
          return;
        }
      } else if (mode === "reset") {
        // Dev-only: gated by BETTER_AUTH_ALLOW_DEV_PASSWORD_RESET on the Convex deployment.
        await resetPasswordDev({ email: email.trim(), newPassword: password });
        setSuccessMessage(
          `Password updated for ${email.trim()}. You can now sign in with the new password.`,
        );
        setMode("sign_in");
        setPassword("");
        return;
      } else {
        const result = await authClient.signIn.email({
          email: email.trim(),
          password,
          callbackURL: redirectTo,
        });
        if (result.error) {
          const error = result.error as AuthErrorShape;
          setErrorMessage(error.message ?? "Sign in failed.");
          return;
        }
      }
      router.push(redirectTo);
      router.refresh();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Authentication failed.";
      setErrorMessage(message);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="flex min-h-[calc(100vh-3.5rem)] items-center justify-center bg-slate-950 px-6 py-12">
      <Card className="w-full max-w-md border-slate-800 bg-slate-900 text-slate-100">
        <CardHeader>
          <CardTitle>
            {mode === "sign_in"
              ? "Sign in"
              : mode === "sign_up"
                ? "Create account"
                : "Reset password"}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {mode === "sign_up" && (
            <div className="space-y-2">
              <Label htmlFor="name">Name</Label>
              <Input
                id="name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="Your name"
                autoComplete="name"
              />
            </div>
          )}
          <div className="space-y-2">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="you@example.com"
              autoComplete="email"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="password">{mode === "reset" ? "New password" : "Password"}</Label>
            <Input
              id="password"
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder={mode === "reset" ? "Enter a new password (min 8 chars)" : "Enter password"}
              autoComplete={mode === "sign_in" ? "current-password" : "new-password"}
            />
          </div>
          {errorMessage && (
            <div className="rounded-md border border-red-500/50 bg-red-500/10 px-3 py-2 text-sm text-red-200">
              {errorMessage}
            </div>
          )}
          {successMessage && (
            <div className="rounded-md border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-200">
              {successMessage}
            </div>
          )}
          <Button
            type="button"
            className="w-full"
            disabled={
              isSubmitting
              || !email.trim()
              || !password.trim()
              || (mode === "sign_up" && !name.trim())
            }
            onClick={() => {
              void submit();
            }}
          >
            {isSubmitting
              ? "Please wait..."
              : mode === "sign_in"
                ? "Sign in"
                : mode === "sign_up"
                  ? "Create account"
                  : "Reset password"}
          </Button>
          <div className="flex items-center justify-between text-sm text-slate-400">
            <span>
              {mode === "sign_in" ? "No account yet?" : mode === "sign_up" ? "Already have an account?" : "Remembered it?"}{" "}
              <button
                type="button"
                className="text-slate-200 underline underline-offset-2"
                onClick={() => {
                  setErrorMessage(null);
                  setSuccessMessage(null);
                  setMode((current) => (current === "sign_in" ? "sign_up" : "sign_in"));
                }}
              >
                {mode === "sign_in" ? "Create one" : "Sign in"}
              </button>
            </span>
            {mode !== "reset" && (
              <button
                type="button"
                className="text-slate-300 underline underline-offset-2"
                onClick={() => {
                  setErrorMessage(null);
                  setSuccessMessage(null);
                  setMode("reset");
                }}
              >
                Forgot password?
              </button>
            )}
          </div>
          <div className="text-xs text-slate-500">
            You will be redirected to{" "}
            <code className="rounded bg-slate-800 px-1 py-0.5">{redirectTo}</code> after auth.
          </div>
          <div className="pt-1">
            <Link className="text-xs text-slate-400 underline underline-offset-2" href="/">
              Back to home
            </Link>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
