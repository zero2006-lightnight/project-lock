"use client";

import * as React from "react";
import Link from "next/link";
import { useActionState } from "react";
import { Eye, EyeOff, Rocket, Sparkles } from "lucide-react";
import { Card, CardBody } from "@/components/ui/card";
import { Field, Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { loginAction, signupAction, type AuthState } from "@/lib/auth/actions";

const initialState: AuthState = undefined;

function PasswordInput({ id, label, ...props }: React.InputHTMLAttributes<HTMLInputElement> & { id: string; label: string }) {
  const [show, setShow] = React.useState(false);
  return (
    <Field label={label} required htmlFor={id}>
      <div className="relative">
        <Input id={id} name={props.name} type={show ? "text" : "password"} autoComplete={props.autoComplete} placeholder={props.placeholder} required />
        <button
          type="button"
          onClick={() => setShow((v) => !v)}
          aria-label={show ? "Hide password" : "Show password"}
          className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground cursor-pointer"
        >
          {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
        </button>
      </div>
    </Field>
  );
}

export function AuthForm({ mode, googleConfigured = false }: { mode: "login" | "signup"; googleConfigured?: boolean }) {
  const [state, action, pending] = useActionState(mode === "login" ? loginAction : signupAction, initialState);
  const fillDemo = () => {
    const email = document.getElementById("email") as HTMLInputElement;
    const password = document.getElementById("password") as HTMLInputElement;
    if (email) email.value = "demo@studypilot.app";
    if (password) password.value = "demo1234";
  };

  const googleEnabled = googleConfigured;

  return (
    <Card className="w-full max-w-md">
      <CardBody className="pt-8">
        <div className="mb-7 flex flex-col items-center text-center">
          <span className="neo-float mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-primary text-primary-foreground">
            <Rocket className="h-7 w-7" />
          </span>
          <h1 className="text-xl font-bold tracking-tight">
            {mode === "login" ? "Welcome back" : "Create your account"}
          </h1>
          <p className="mt-1.5 text-sm text-muted-foreground">
            {mode === "login" ? "Plan smarter. Study better. Stay ahead." : "Your AI-powered study co-pilot."}
          </p>
        </div>

        {googleEnabled && (
          <>
            <a
              href="/auth/google"
              className="flex w-full items-center justify-center gap-2.5 rounded-xl bg-card px-4 py-2.5 text-sm font-semibold text-foreground shadow-raise-sm tactile cursor-pointer"
            >
              <svg viewBox="0 0 24 24" className="h-4.5 w-4.5" aria-hidden>
                <path fill="#4285F4" d="M23.49 12.27c0-.79-.07-1.54-.19-2.27H12v4.51h6.47c-.29 1.48-1.14 2.73-2.4 3.58v3h3.86c2.26-2.09 3.56-5.17 3.56-8.82z" />
                <path fill="#34A853" d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.86-3c-1.08.72-2.45 1.16-4.07 1.16-3.13 0-5.78-2.11-6.73-4.96H1.29v3.09C3.26 21.3 7.31 24 12 24z" />
                <path fill="#FBBC05" d="M5.27 14.29c-.25-.72-.38-1.49-.38-2.29s.14-1.57.38-2.29V6.62H1.29C.47 8.24 0 10.06 0 12s.47 3.76 1.29 5.38l3.98-3.09z" />
                <path fill="#EA4335" d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.31 0 3.26 2.7 1.29 6.62l3.98 3.09c.95-2.85 3.6-4.96 6.73-4.96z" />
              </svg>
              Continue with Google
            </a>
            <div className="mb-5 flex items-center gap-3 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
              <span className="h-px flex-1 bg-border" /> or <span className="h-px flex-1 bg-border" />
            </div>
          </>
        )}

        <form action={action} className="space-y-4">
          {mode === "signup" && (
            <Field label="Name" required htmlFor="name">
              <Input id="name" name="name" placeholder="e.g. Alex Morgan" autoComplete="name" required />
            </Field>
          )}
          <Field label="Email" required htmlFor="email">
            <Input id="email" name="email" type="email" placeholder="you@university.edu" autoComplete="email" required />
          </Field>
          <PasswordInput id="password" label="Password" name="password" placeholder="At least 8 characters" autoComplete={mode === "login" ? "current-password" : "new-password"} />

          {state?.fieldErrors?.email && <p className="text-xs font-medium text-danger">{state.fieldErrors.email[0]}</p>}
          {state?.fieldErrors?.password && <p className="text-xs font-medium text-danger">{state.fieldErrors.password[0]}</p>}
          {state?.error && (
            <p className="rounded-xl bg-danger-soft px-3.5 py-2.5 text-xs font-medium text-danger" role="alert">
              {state.error}
            </p>
          )}

          <Button type="submit" size="lg" className="w-full" loading={pending}>
            {mode === "login" ? "Sign in" : "Create account"}
          </Button>
        </form>

        {mode === "login" && (
          <>
            <div className="my-5 flex items-center gap-3 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
              <span className="h-px flex-1 bg-border" /> or <span className="h-px flex-1 bg-border" />
            </div>
            <button
              onClick={fillDemo}
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-primary-soft/60 px-4 py-3 text-sm font-semibold text-primary shadow-inset-sm ring-1 ring-inset ring-primary/20 transition-colors hover:bg-primary-soft cursor-pointer"
            >
              <Sparkles className="h-4 w-4" /> Try the demo student (Alex)
            </button>
            <p className="mt-2.5 text-center text-[11px] text-muted-foreground">
              Demo account: demo@studypilot.app · demo1234 — pre-filled above.
            </p>
          </>
        )}

        <p className="mt-6 text-center text-sm text-muted-foreground">
          {mode === "login" ? (
            <>
              New to StudyPilot?{" "}
              <Link href="/signup" className="font-semibold text-primary hover:underline">
                Create an account
              </Link>
            </>
          ) : (
            <>
              Already have an account?{" "}
              <Link href="/login" className="font-semibold text-primary hover:underline">
                Sign in
              </Link>
            </>
          )}
        </p>
      </CardBody>
    </Card>
  );
}