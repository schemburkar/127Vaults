import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import type { ButtonHTMLAttributes } from "react";
import { cn } from "./utils";

const buttonVariants = cva(
  "ui-button inline-flex min-h-11 cursor-pointer flex-nowrap items-center justify-center gap-2 whitespace-nowrap rounded-xl px-4 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-[#9D1F32]/30 disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-45 [&>svg]:shrink-0",
  {
    variants: {
      variant: {
        primary: "bg-[#9D1F32] text-white hover:bg-[#9D1F32]/85",
        secondary: "border border-white/10 bg-white/5 text-slate-100 hover:bg-white/10",
        ghost: "text-slate-300 hover:bg-white/7 hover:text-white",
        destructive: "bg-red-700 text-white hover:bg-red-800",
      },
      size: { default: "h-11", sm: "h-9 px-3", icon: "size-11 px-0" },
    },
    defaultVariants: { variant: "primary", size: "default" },
  },
);

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> { asChild?: boolean }

export function Button({ asChild, className, variant, size, type, ...props }: ButtonProps) {
  const Component = asChild ? Slot : "button";
  return <Component type={asChild ? undefined : (type ?? "button")} className={cn(buttonVariants({ variant, size }), className)} {...props} />;
}
