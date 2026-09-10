import { cn } from "@/lib/utils";

const GRADIENTS = [
  "from-[#1e6e3c] to-[#115231]",
  "from-[#2c8a4f] to-[#1e6e3c]",
  "from-[#4f9d6d] to-[#2c8a4f]",
  "from-emerald-500 to-teal-500",
  "from-amber-500 to-orange-500",
  "from-rose-500 to-pink-500",
];

export function initialsOf(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]!.toUpperCase())
    .join("");
}

export function Avatar({
  name,
  size = "md",
  className,
}: {
  name: string;
  size?: "xs" | "sm" | "md" | "lg" | "xl";
  className?: string;
}) {
  const sizes = {
    xs: "h-6 w-6 text-[10px]",
    sm: "h-8 w-8 text-xs",
    md: "h-9 w-9 text-[13px]",
    lg: "h-12 w-12 text-base",
    xl: "h-16 w-16 text-xl",
  };
  const hash = [...name].reduce((a, c) => a + (c.codePointAt(0) ?? 0), 0);
  return (
    <span
      aria-hidden
      className={cn(
        "inline-flex shrink-0 select-none items-center justify-center rounded-full bg-gradient-to-br font-semibold text-white shadow-[0_1px_2px_rgba(92,80,62,0.22),0_3px_8px_-2px_rgba(92,80,62,0.28)] ring-1 ring-black/5",
        GRADIENTS[hash % GRADIENTS.length],
        sizes[size],
        className,
      )}
    >
      {initialsOf(name)}
    </span>
  );
}
