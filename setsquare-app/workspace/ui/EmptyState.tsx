import type { ReactNode } from "react";

/** What the page shows where it has nothing to list, and why. */
export const EmptyState = ({
  title,
  children,
}: {
  title: string;
  children?: ReactNode;
}) => (
  <div className="workspace-empty">
    {/* a blank sheet with its registration mark */}
    <svg
      className="workspace-empty__sheet"
      viewBox="0 0 64 48"
      aria-hidden="true"
      focusable="false"
    >
      <rect x="0.5" y="0.5" width="63" height="47" />
      <circle cx="32" cy="24" r="6" />
      <path d="M32 14v20M22 24h20" />
    </svg>
    <h2 className="workspace-empty__title">{title}</h2>
    {children}
  </div>
);
