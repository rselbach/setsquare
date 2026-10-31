/** A registration mark on blank paper, for a drawing with nothing to show. */
export const BlankSheet = ({ className }: { className: string }) => (
  <svg
    className={className}
    viewBox="0 0 48 48"
    aria-hidden="true"
    focusable="false"
  >
    <circle cx="24" cy="24" r="9" />
    <path d="M24 8v32M8 24h32" />
  </svg>
);
