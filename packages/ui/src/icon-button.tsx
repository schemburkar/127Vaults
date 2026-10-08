import { Button, type ButtonProps } from "./button";

export function IconButton({ label, variant = "ghost", ...props }: ButtonProps & { label: string }) {
  return <Button {...props} variant={variant} size="icon" aria-label={label} title={label} />;
}
