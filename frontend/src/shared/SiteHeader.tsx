import { useEffect, useRef, useState } from "react";
import { NavLink } from "react-router-dom";
import { Brand } from "./Brand";
import { Icon } from "./Icon";

export function SiteHeader({
  session,
}: {
  session: { name: string; email: string } | null;
}) {
  const [open, setOpen] = useState(false);
  const toggle = useRef<HTMLButtonElement>(null);
  const header = useRef<HTMLElement>(null);

  useEffect(() => {
    if (!open) return;

    const closeOutside = (event: Event) => {
      if (!header.current?.contains(event.target as Node))
        setOpen(false);
    };

    document.addEventListener("pointerdown", closeOutside);
    document.addEventListener("focusin", closeOutside);

    return () => {
      document.removeEventListener("pointerdown", closeOutside);
      document.removeEventListener("focusin", closeOutside);
    };
  }, [open]);

  return (
    <header
      className="site-header"
      ref={header}
      onClick={(event) => {
        if (
          open &&
          event.target instanceof Element &&
          event.target.closest("a")
        ) {
          setOpen(false);
          toggle.current?.focus();
        }
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape" && open) {
          setOpen(false);
          toggle.current?.focus();
        }
      }}
    >
      <div className="container nav-row">
        <Brand />

        <button
          ref={toggle}
          className="menu-toggle"
          aria-expanded={open}
          aria-controls="primary-navigation"
          onClick={() => setOpen(!open)}
        >
          <Icon name={open ? "close" : "menu"} />
          <span>{open ? "Close menu" : "Menu"}</span>
        </button>

        <nav
          id="primary-navigation"
          aria-label="Main navigation"
          className={open ? "primary-nav is-open" : "primary-nav"}
        >
          <NavLink to="/" end>
            Home
          </NavLink>

          <NavLink to="/learn-more">About</NavLink>
          <NavLink to="/programs">Programs</NavLink>
          <NavLink to="/admissions">Admissions</NavLink>
          <NavLink to="/tuition">Tuition</NavLink>
          <NavLink to="/faq">FAQs</NavLink>
          <NavLink to="/contact">Contact</NavLink>

          <div className="nav-actions">
            <NavLink
              className="nav-hub-link"
              to={session ? "/dashboard" : "/login"}
            >
              {session ? "Workspace" : "Sign in"}
            </NavLink>

            <NavLink
              to="/application"
              style={{
                backgroundColor: "#1a3c34",
                color: "white",
                padding: "0.6rem 1.25rem",
                borderRadius: "6px",
                textDecoration: "none",
                fontWeight: 500,
                fontSize: "0.95rem",
                display: "flex",
                alignItems: "center",
                gap: "0.5rem",
                transition: "background-color 0.2s"
              }}
            >
              Start Application
            </NavLink>
          </div>
        </nav>
      </div>
    </header>
  );
}