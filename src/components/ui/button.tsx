"use client";

import * as React from "react";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

type Variant =
  | "primary"
  | "secondary"
  | "ink"
  | "ghost"
  | "outline"
  | "danger"
  | "success"
  | "warning"
  | "link";
type Size = "xs" | "sm" | "md" | "lg" | "icon" | "icon-sm";

const variantClasses: Record<Variant, string> = {
  primary:
    "bg-lime text-inkfill border-2 border-ink shadow-brutal brutal-press font-bold",
  secondary:
    "bg-card text-card-foreground border-2 border-ink shadow-brutal brutal-press font-bold",
  ink: "bg-inkfill text-lime border-2 border-ink shadow-brutal brutal-press font-bold",
  ghost: "text-foreground hover:bg-muted font-medium transition-colors underline-offset-4 hover:underline",
  outline:
    "border-2 border-ink bg-card text-foreground shadow-brutal-sm brutal-press hover:bg-muted font-medium",
  danger:
    "bg-danger-fill text-inkfill border-2 border-ink shadow-brutal brutal-press font-bold",
  success:
    "bg-success text-white border-2 border-ink shadow-brutal brutal-press font-bold",
  warning:
    "bg-warning text-white border-2 border-ink shadow-brutal brutal-press font-bold",
  link: "text-primary underline-offset-4 hover:underline font-medium p-0 h-auto",
};

const sizeClasses: Record<Size, string> = {
  xs: "h-8 px-2.5 text-xs rounded-[6px] gap-1.5",
  sm: "h-9 px-4 text-sm rounded-[6px] gap-2",
  md: "h-11 px-5 text-sm rounded-[6px] gap-2",
  lg: "h-13 px-7 text-[15px] rounded-[6px] gap-2",
  icon: "h-11 w-11 rounded-[6px]",
  "icon-sm": "h-9 w-9 rounded-[6px]",
};

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  iconRight?: React.ReactNode;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = "primary", size = "md", loading, iconRight, children, disabled, ...props }, ref) => {
    return (
      <button
        ref={ref}
        className={cn(
          "inline-flex select-none items-center justify-center whitespace-nowrap transition-all duration-150 disabled:pointer-events-none disabled:opacity-50 cursor-pointer",
          variantClasses[variant],
          sizeClasses[size],
          className,
        )}
        aria-busy={loading || undefined}
        disabled={disabled || loading}
        {...props}
      >
        {loading && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
        {children}
        {iconRight}
      </button>
    );
  },
);
Button.displayName = "Button";

export { variantClasses, sizeClasses };
export type { Variant, Size };
