import {
  act,
  fireEvent,
  render,
  renderHook,
  screen,
} from "@testing-library/react";

import { RouteLink } from "../../web/RouteLink";
import {
  initRouter,
  navigate,
  parseRoute,
  routeToPath,
  setLeaveGuard,
  useRoute,
} from "../../web/router";

import type { Route } from "../../web/router";
import type { DrawingId, FolderId } from "../../workspace/types";

const troy = "troy" as DrawingId;
const greendale = "greendale" as FolderId;

// a guard the test lets finish
const heldGuard = () => {
  let release = () => {};
  const guard = vi.fn(
    () =>
      new Promise<void>((resolve) => {
        release = resolve;
      }),
  );
  return { guard, release: () => act(async () => release()) };
};

let stopRouter = () => {};

beforeEach(() => {
  window.history.replaceState(null, "", "/");
  stopRouter = initRouter();
});

afterEach(() => {
  stopRouter();
  window.history.replaceState(null, "", "/");
});

describe("routes", () => {
  const routes: Record<string, Route> = {
    "/": { kind: "drawings", folderId: null },
    "/f/greendale": { kind: "drawings", folderId: greendale },
    "/recent": { kind: "recent" },
    "/trash": { kind: "trash" },
    "/d/troy": { kind: "drawing", id: troy },
    "/d/troy?element=abed": { kind: "drawing", id: troy, element: "abed" },
    "/d/study%20room": { kind: "drawing", id: "study room" as DrawingId },
    "/paintball": { kind: "notFound", path: "/paintball" },
  };

  for (const [path, want] of Object.entries(routes)) {
    it(`reads and writes ${path}`, () => {
      expect(parseRoute(path)).toEqual(want);
      expect(routeToPath(want)).toBe(path);
    });
  }

  it("reads full addresses, trailing slashes and odd paths", () => {
    expect(parseRoute("https://greendale.edu/d/troy/#url=x")).toEqual({
      kind: "drawing",
      id: troy,
    });
    expect(parseRoute("/recent/")).toEqual({ kind: "recent" });
    expect(parseRoute("/d/")).toEqual({ kind: "notFound", path: "/d/" });
    expect(parseRoute("/d/troy/abed")).toEqual({
      kind: "notFound",
      path: "/d/troy/abed",
    });
    expect(parseRoute("/d/%E0%A4%A")).toEqual({
      kind: "notFound",
      path: "/d/%E0%A4%A",
    });
  });
});

describe("navigation", () => {
  it("shows the route the address held when it started", () => {
    stopRouter();
    window.history.replaceState(null, "", "/d/troy");
    stopRouter = initRouter();

    const { result } = renderHook(() => useRoute());

    expect(result.current).toEqual({ kind: "drawing", id: troy });
  });

  it("waits for the leave guard before it navigates", async () => {
    const { guard, release } = heldGuard();
    setLeaveGuard(guard);
    const { result } = renderHook(() => useRoute());

    let navigated = false;
    act(() => {
      navigate({ kind: "drawing", id: troy }).then(() => {
        navigated = true;
      });
    });
    await act(() => Promise.resolve());

    expect(guard).toHaveBeenCalledTimes(1);
    expect(window.location.pathname).toBe("/");
    expect(result.current).toEqual({ kind: "drawings", folderId: null });

    await release();

    expect(navigated).toBe(true);
    expect(window.location.pathname).toBe("/d/troy");
    expect(result.current).toEqual({ kind: "drawing", id: troy });
  });

  it("replaces the history entry when asked", async () => {
    const length = window.history.length;

    await act(() => navigate({ kind: "trash" }, { replace: true }));

    expect(window.location.pathname).toBe("/trash");
    expect(window.history.length).toBe(length);
  });

  it("waits for the leave guard before it shows back and forward", async () => {
    const { guard, release } = heldGuard();
    setLeaveGuard(guard);
    const { result } = renderHook(() => useRoute());

    // the browser changes the address, then tells the page
    window.history.pushState(null, "", "/d/troy");
    act(() => {
      window.dispatchEvent(new PopStateEvent("popstate"));
    });
    await act(() => Promise.resolve());

    expect(guard).toHaveBeenCalledTimes(1);
    expect(result.current).toEqual({ kind: "drawings", folderId: null });

    await release();

    expect(result.current).toEqual({ kind: "drawing", id: troy });
  });

  it("navigates even when the leave guard fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    setLeaveGuard(() => Promise.reject(new Error("Chang locked the door")));

    await act(() => navigate({ kind: "recent" }));

    expect(window.location.pathname).toBe("/recent");
    expect(console.error).toHaveBeenCalled();
    vi.restoreAllMocks();
  });
});

describe("RouteLink", () => {
  it("is a real link that a plain click follows in place", async () => {
    const { result } = renderHook(() => useRoute());
    render(<RouteLink to={{ kind: "drawing", id: troy }}>Troy</RouteLink>);
    const link = screen.getByRole("link", { name: "Troy" });
    expect(link.getAttribute("href")).toBe("/d/troy");

    const click = new MouseEvent("click", { bubbles: true, cancelable: true });
    await act(async () => {
      link.dispatchEvent(click);
    });

    expect(click.defaultPrevented).toBe(true);
    expect(window.location.pathname).toBe("/d/troy");
    expect(result.current).toEqual({ kind: "drawing", id: troy });
  });

  const modifiers: Record<string, MouseEventInit> = {
    "Cmd-click": { metaKey: true },
    "Ctrl-click": { ctrlKey: true },
    "Shift-click": { shiftKey: true },
    "middle click": { button: 1 },
  };

  for (const [name, init] of Object.entries(modifiers)) {
    it(`leaves a ${name} to the browser`, () => {
      render(<RouteLink to={{ kind: "trash" }}>Trash</RouteLink>);
      // runs after the link's own handler; it then stops jsdom, which can't
      // open the link as a browser would
      let prevented: boolean | null = null;
      const afterLink = (event: MouseEvent) => {
        prevented = event.defaultPrevented;
        event.preventDefault();
      };
      document.addEventListener("click", afterLink);

      fireEvent.click(screen.getByRole("link", { name: "Trash" }), init);

      document.removeEventListener("click", afterLink);
      expect(prevented).toBe(false);
      expect(window.location.pathname).toBe("/");
    });
  }
});
