import type { ReactNode } from "react";

export function StatusBanner({ children, variant }: { children: ReactNode; variant: "error" | "success" }) {
  if (!children) return null;
  return <p className={`banner ${variant}`}>{children}</p>;
}
