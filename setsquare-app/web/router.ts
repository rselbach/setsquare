import { ELEMENT_LINK_KEY } from "@setsquare/common";
import { useSyncExternalStore } from "react";

import type { DrawingId, FolderId } from "../workspace/types";

/** A page of the web app, as its address names it. */
export type Route =
  /** a folder of drawings, or their root when folderId is null */
  | { kind: "drawings"; folderId: FolderId | null }
  | { kind: "recent" }
  | { kind: "trash" }
  /** a drawing in the editor, scrolled to an element if a link names one */
  | { kind: "drawing"; id: DrawingId; element?: string }
  | { kind: "notFound"; path: string };

/**
 * Runs before the app leaves the current page, by a link or back and
 * forward alike. The app waits for it, so it can save what's open.
 */
export type LeaveGuard = () => Promise<void | boolean>;

const ROOT: Route = { kind: "drawings", folderId: null };

const segment = (value: string) => {
  try {
    return decodeURIComponent(value);
  } catch {
    return null;
  }
};

/** The route an address shows; relative addresses are read as on this site. */
export const parseRoute = (url: string | URL): Route => {
  const { pathname, searchParams } = new URL(url, "http://localhost");
  const path = pathname.replace(/\/+$/, "") || "/";
  if (path === "/") {
    return ROOT;
  }
  if (path === "/recent") {
    return { kind: "recent" };
  }
  if (path === "/trash") {
    return { kind: "trash" };
  }
  const match = path.match(/^\/([df])\/([^/]+)$/);
  const id = match && segment(match[2]);
  if (match && id) {
    if (match[1] === "f") {
      return { kind: "drawings", folderId: id as FolderId };
    }
    const element = searchParams.get(ELEMENT_LINK_KEY);
    return element
      ? { kind: "drawing", id: id as DrawingId, element }
      : { kind: "drawing", id: id as DrawingId };
  }
  return { kind: "notFound", path: pathname };
};

/** The address of a route, from the site's root. */
export const routeToPath = (route: Route): string => {
  switch (route.kind) {
    case "drawings":
      return route.folderId === null
        ? "/"
        : `/f/${encodeURIComponent(route.folderId)}`;
    case "recent":
      return "/recent";
    case "trash":
      return "/trash";
    case "drawing": {
      const path = `/d/${encodeURIComponent(route.id)}`;
      return route.element
        ? `${path}?${new URLSearchParams({
            [ELEMENT_LINK_KEY]: route.element,
          })}`
        : path;
    }
    case "notFound":
      return route.path;
  }
};

// the route the app shows, which trails the address while a leave guard runs
let current: Route = ROOT;
let leaveGuard: LeaveGuard | null = null;
let routerWindow: Window | null = null;
const listeners = new Set<() => void>();

const publish = (route: Route) => {
  if (routeToPath(route) === routeToPath(current)) {
    return;
  }
  current = route;
  for (const listener of listeners) {
    listener();
  }
};

const runLeaveGuard = async () => {
  try {
    return (await leaveGuard?.()) !== false;
  } catch (error) {
    // a failed save mustn't trap the user on the page
    console.error(error);
    return true;
  }
};

const onPopState = async () => {
  // the address already changed, but the old page saves before it goes
  if (!(await runLeaveGuard())) {
    routerWindow?.history.replaceState(null, "", routeToPath(current));
    return;
  }
  if (routerWindow) {
    publish(parseRoute(routerWindow.location.href));
  }
};

/**
 * Starts following the address bar, showing the route it holds now. Returns
 * a function that stops.
 */
export const initRouter = (ownerWindow: Window = window) => {
  routerWindow = ownerWindow;
  current = parseRoute(ownerWindow.location.href);
  ownerWindow.addEventListener("popstate", onPopState);
  return () => {
    ownerWindow.removeEventListener("popstate", onPopState);
    leaveGuard = null;
  };
};

/** Sets what runs before each navigation away from the page, or clears it. */
export const setLeaveGuard = (guard: LeaveGuard | null) => {
  leaveGuard = guard;
};

/** Goes to a route once the leave guard is done, adding a history entry. */
export const navigate = async (
  route: Route,
  { replace = false }: { replace?: boolean } = {},
) => {
  if (!(await runLeaveGuard())) {
    return false;
  }
  const path = routeToPath(route);
  if (replace) {
    window.history.replaceState(null, "", path);
  } else {
    window.history.pushState(null, "", path);
  }
  publish(route);
  return true;
};

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

const getRoute = () => current;

/** The route the app shows, rerendering when it changes. */
export const useRoute = () => useSyncExternalStore(subscribe, getRoute);
