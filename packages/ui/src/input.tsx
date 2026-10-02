import { forwardRef, type InputHTMLAttributes } from "react";
import { cn } from "./utils";

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(({ className, ...props }, ref) => (
  <input ref={ref} className={cn("min-h-11 w-full rounded-xl border border-white/10 bg-white/5 px-3 text-base text-slate-100 outline-none placeholder:text-slate-500 focus:border-[#E0BB95] focus:ring-3 focus:ring-[#E0BB95]/15 md:text-sm", className)} {...props} />
));
Input.displayName = "Input";
