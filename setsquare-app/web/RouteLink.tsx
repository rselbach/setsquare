import { navigate, routeToPath } from "./router";

import type { AnchorHTMLAttributes, MouseEvent } from "react";

import type { Route } from "./router";

type RouteLinkProps = Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "href"> & {
  to: Route;
  replace?: boolean;
};

// modified and middle clicks keep their meaning, such as opening a new tab
const isPlainClick = (event: MouseEvent<HTMLAnchorElement>) =>
  event.button === 0 &&
  !event.metaKey &&
  !event.ctrlKey &&
  !event.shiftKey &&
  !event.altKey;

/** A link to a route that a plain click opens in place. */
export const RouteLink = ({
  to,
  replace,
  onClick,
  children,
  ...props
}: RouteLinkProps) => (
  <a
    {...props}
    href={routeToPath(to)}
    onClick={(event) => {
      onClick?.(event);
      if (
        event.defaultPrevented ||
        !isPlainClick(event) ||
        (props.target !== undefined && props.target !== "_self")
      ) {
        return;
      }
      event.preventDefault();
      navigate(to, { replace });
    }}
  >
    {children}
  </a>
);
