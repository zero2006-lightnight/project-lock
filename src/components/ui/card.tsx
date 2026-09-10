import * as React from "react";
import { cn } from "@/lib/utils";

export function Card({
  className,
  interactive = false,
  inset = false,
  ...props
}: React.HTMLAttributes<HTMLDivElement> & { interactive?: boolean; inset?: boolean }) {
  return (
    <div
      className={cn(
        "relative rounded-[6px] border-2 border-ink bg-card text-card-foreground",
        inset ? "neo-inset bg-muted/30" : "shadow-brutal",
        interactive && "brutal-press cursor-pointer",
        className,
      )}
      {...props}
    />
  );
}

export function CardHeader({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("flex flex-wrap items-start justify-between gap-3 px-5 pt-5 sm:px-6 sm:pt-6", className)}
      {...props}
    />
  );
}

export function CardTitle({
  className,
  ...props
}: React.HTMLAttributes<HTMLHeadingElement>) {
  return (
    <h3
      className={cn("font-brutal-display text-lg tracking-tight text-foreground", className)}
      {...props}
    />
  );
}

export function CardDescription({
  className,
  ...props
}: React.HTMLAttributes<HTMLParagraphElement>) {
  return (
    <p className={cn("text-sm text-muted-foreground", className)} {...props} />
  );
}

export function CardBody({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("px-5 pb-5 pt-1 sm:px-6 sm:pb-6", className)} {...props} />;
}
