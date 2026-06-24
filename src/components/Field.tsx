import type { ReactNode } from "react";

export function Field({
  children,
  className = "field",
  label
}: {
  children: ReactNode;
  className?: string;
  label: string;
}) {
  return (
    <label className={className}>
      <span>{label}</span>
      {children}
    </label>
  );
}
