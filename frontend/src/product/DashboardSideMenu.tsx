import { useId } from "react";
import type { ButtonHTMLAttributes, ReactNode } from "react";
import { Icon } from "../shared/Icon";
import { useDashboardMenu } from "./useDashboardMenu";
import "./serverDashboard.css";
import "./dashboardSideMenu.css";

type NavRenderer = (
  className: string,
  options: { id?: string; collapsed: boolean },
) => ReactNode;

/**
 * The universal dashboard side menu (student, family and staff). On wide screens
 * it runs down the left side and collapses to an icon rail; on narrow screens the
 * sections move into a "Sections" disclosure. The choice is remembered per browser.
 */
export function DashboardSideMenu({
  label,
  brand,
  role,
  currentKey,
  currentLabel,
  currentText,
  renderNav,
  brandMark,
  afterBrand,
  collapsible = true,
  children,
}: {
  /** Accessible name of the whole side menu. */
  label: string;
  /** Visible heading at the top of the menu. */
  brand: string;
  /** Replaces the default leaf-and-heading brand. */
  brandMark?: ReactNode;
  /** Shown between the brand and the sections, such as a school year picker. */
  afterBrand?: ReactNode;
  /** Whether the menu can fold into an icon rail on wide screens. */
  collapsible?: boolean;
  role?: string;
  /** Identifies the active section; the mobile disclosure closes when it changes. */
  currentKey: string;
  /** Accessible name of the active section, announced on the mobile disclosure. */
  currentLabel: string;
  /** Visible name of the active section on the mobile disclosure. */
  currentText: string;
  renderNav: NavRenderer;
  children?: (collapsed: boolean) => ReactNode;
}) {
  const navId = useId();
  const menu = useDashboardMenu();
  const collapsed = collapsible && menu.collapsed;
  const toggle = menu.toggle;
  const toggleLabel = collapsed ? "Expand menu" : "Collapse menu";
  return (
    <aside
      className="server-dashboard-sidebar dashboard-side-menu"
      data-account-role={role}
      data-collapsed={collapsed ? "true" : "false"}
      aria-label={label}
    >
      <div className="dashboard-side-menu-top">
        {brandMark ?? (
          <div className="server-dashboard-brand">
            <Icon name="leaf" />
            <span className="dashboard-side-menu-brand-text">{brand}</span>
          </div>
        )}
        {collapsible && (
          <button
            type="button"
            className="dashboard-side-menu-toggle"
            aria-expanded={!collapsed}
            aria-controls={navId}
            aria-label={toggleLabel}
            title={toggleLabel}
            onClick={toggle}
          >
            <svg
              aria-hidden="true"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.7"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M5 4h14a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1ZM9 4v16" />
              <path d={collapsed ? "m13 9 3 3-3 3" : "m16 9-3 3 3 3"} />
            </svg>
          </button>
        )}
      </div>
      {afterBrand}
      {renderNav("server-dashboard-desktop-nav", { id: navId, collapsed })}
      <details
        className="server-dashboard-mobile-nav"
        key={currentKey}
        onKeyDown={(event) => {
          if (event.key === "Escape" && event.currentTarget.open) {
            event.preventDefault();
            event.currentTarget.open = false;
            event.currentTarget.querySelector<HTMLElement>("summary")?.focus();
          }
        }}
      >
        <summary aria-label={`Sections: ${currentLabel}`}>
          {currentText}
          <Icon name="menu" />
        </summary>
        {renderNav("server-dashboard-mobile-links", { collapsed: false })}
      </details>
      {children?.(collapsed)}
    </aside>
  );
}

/** One section link in the side menu. The name stays available when collapsed. */
export function DashboardSideMenuButton({
  current,
  label,
  symbol,
  collapsed,
  children,
  ...button
}: {
  current: boolean;
  /** Accessible name; also shown as a tooltip on the collapsed icon rail. */
  label: string;
  symbol: ReactNode;
  collapsed: boolean;
  /** Visible label, followed by any badges. */
  children: ReactNode;
} & Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  "aria-current" | "aria-label" | "title" | "type" | "children"
>) {
  return (
    <button
      {...button}
      type="button"
      aria-current={current ? "page" : undefined}
      aria-label={label}
      title={collapsed ? label : undefined}
    >
      <span className="server-dashboard-nav-symbol">{symbol}</span>
      {children}
    </button>
  );
}

/** The visible text of a side menu item; visually hidden on the icon rail. */
export function DashboardSideMenuLabel({ children }: { children: ReactNode }) {
  return <span className="dashboard-side-menu-label">{children}</span>;
}
