import type { ReactNode } from "react";

export function NavigationGroup({
  activeView,
  collapsed,
  label,
  items,
  onSelect
}: {
  activeView: string;
  collapsed: boolean;
  label: string;
  items: Array<{ id: string; label: string; icon: ReactNode }>;
  onSelect: (id: string) => void;
}) {
  return (
    <section className="nav-group">
      {!collapsed ? <p>{label}</p> : null}
      {items.map((item) => (
        <button
          aria-current={activeView === item.id ? "page" : undefined}
          className={activeView === item.id ? "nav-item active" : "nav-item"}
          key={item.id}
          onClick={() => onSelect(item.id)}
          title={collapsed ? item.label : undefined}
          type="button"
        >
          {item.icon}
          <span>{item.label}</span>
        </button>
      ))}
    </section>
  );
}
