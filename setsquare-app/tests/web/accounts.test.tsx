import { fireEvent, render, screen, waitFor } from "@testing-library/react";

import SetsquareApp from "../../App";
import { AccountContext } from "../../web/accountContext";
import { AccountControls, AccountNotice } from "../../web/accountControls";
import { setLeaveGuard } from "../../web/router";
import * as workspaceStore from "../../web/workspaceStore";
import { LocalWorkspaceStore } from "../../workspace/local/LocalWorkspaceStore";
import { RemoteWorkspaceStore } from "../../workspace/remote/RemoteWorkspaceStore";
import { workspaceFixture } from "../workspace/helpers";

import type { ReactNode } from "react";

import type { AccountState } from "../../web/accountContext";
import type { SessionInfo } from "../../workspace/api";
import type { WorkspaceStore } from "../../workspace/WorkspaceStore";

const signedIn: Extract<SessionInfo, { kind: "signedIn" }> = {
  kind: "signedIn",
  user: {
    id: "greendale-account",
    login: "troy-barnes",
    name: "Troy Barnes",
    avatarUrl: "https://avatars.githubusercontent.com/u/123",
  },
  csrfToken: "greendale-csrf",
};

const response = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json" },
  });

let workspace: ReturnType<typeof workspaceFixture>;
const remoteStores: RemoteWorkspaceStore[] = [];

const withAccount = (
  state: AccountState,
  store: WorkspaceStore,
  children: ReactNode,
  ownerWindow = window,
) => (
  <AccountContext.Provider
    value={{ state, store, ownerWindow, expire: vi.fn() }}
  >
    {children}
  </AccountContext.Provider>
);

beforeEach(() => {
  workspace = workspaceFixture();
  localStorage.clear();
  window.history.replaceState(null, "", "/");
});

afterEach(() => {
  for (const store of remoteStores.splice(0)) {
    store.close();
  }
  workspace.close();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  setLeaveGuard(null);
});

describe("web accounts", () => {
  it("links GitHub sign in back to the current page", async () => {
    const store = await workspace.open();
    window.history.replaceState(null, "", "/recent?greendale=1");

    render(withAccount({ kind: "signedOut" }, store, <AccountControls />));

    expect(
      screen.getByRole("link", { name: "Sign in with GitHub" }),
    ).toHaveAttribute(
      "href",
      "/api/auth/github?returnTo=%2Frecent%3Fgreendale%3D1",
    );
    expect(screen.getByText("Stored in this browser")).toBeInTheDocument();
  });

  it("identifies the private account without the browser-only warning", async () => {
    const store = await workspace.open();

    render(withAccount(signedIn, store, <AccountControls />));

    expect(screen.getByText("Saved to your account")).toBeInTheDocument();
    expect(screen.getByText("Troy Barnes")).toBeInTheDocument();
    expect(screen.getByText("troy-barnes on GitHub")).toBeInTheDocument();
    expect(screen.queryByText("Stored in this browser")).toBeNull();
  });

  it("offers a way back to the account while it can't be reached", async () => {
    const store = await workspace.open();

    render(
      withAccount(
        { kind: "unreachable" },
        store,
        <>
          <AccountControls />
          <AccountNotice />
        </>,
      ),
    );

    expect(screen.getByText("Can't reach your account")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent(
      "Showing the drawings stored in this browser",
    );
    expect(screen.getAllByRole("button", { name: /Try again/i })).toHaveLength(
      2,
    );
  });

  it("pins sign out to the current account and flushes the page first", async () => {
    const store = await workspace.open();
    const assign = vi.fn();
    const fetch = vi
      .fn()
      .mockResolvedValue(new Response(null, { status: 204 }));
    const ownerWindow = new Proxy(window, {
      get: (target, property) => {
        if (property === "fetch") {
          return fetch;
        }
        if (property === "location") {
          return { ...target.location, assign };
        }
        return Reflect.get(target, property);
      },
    });
    const flushing = Promise.withResolvers<void>();
    setLeaveGuard(() => flushing.promise);
    render(withAccount(signedIn, store, <AccountControls />, ownerWindow));

    fireEvent.click(screen.getByRole("button", { name: "Sign out" }));
    expect(fetch).not.toHaveBeenCalled();
    flushing.resolve();

    await waitFor(() => expect(assign).toHaveBeenCalledWith("/"));
    expect(fetch).toHaveBeenCalledWith("/api/auth/logout", {
      method: "POST",
      credentials: "same-origin",
      headers: {
        "X-CSRF-Token": signedIn.csrfToken,
        "X-Setsquare-Account": signedIn.user.id,
      },
    });
  });

  it("keeps the mounted drawing beside the expired-session notice", async () => {
    const store = await workspace.open();

    render(
      withAccount(
        { kind: "expired", user: signedIn.user },
        store,
        <>
          <input aria-label="Drawing title" defaultValue="Dreamatorium" />
          <AccountNotice />
        </>,
      ),
    );

    expect(screen.getByRole("textbox", { name: "Drawing title" })).toHaveValue(
      "Dreamatorium",
    );
    expect(screen.getByRole("alert")).toHaveTextContent("Your session ended");
    expect(screen.getByRole("link", { name: "Sign in again" })).toHaveAttribute(
      "href",
      "/api/auth/github?returnTo=%2F",
    );
  });

  it("imports only after the user asks and retains the local workspace", async () => {
    const remote = await RemoteWorkspaceStore.open({
      session: signedIn,
      ownerWindow: window,
      onSessionExpired: vi.fn(),
      fetch: vi
        .fn<typeof fetch>()
        .mockResolvedValue(response({ folders: [], drawings: [] })),
    });
    remoteStores.push(remote);
    const local = await workspace.open();
    await local.createDrawing({ folderId: null, name: "Dreamatorium" });
    vi.spyOn(LocalWorkspaceStore, "open").mockResolvedValue(local);
    const imported = vi
      .spyOn(remote, "importLocalWorkspace")
      .mockResolvedValue({ imported: 1, skipped: [] });
    const deleted = vi.spyOn(local, "deleteForever");
    const closed = vi.spyOn(local, "close").mockImplementation(() => {});

    render(withAccount(signedIn, remote, <AccountControls />));
    expect(await screen.findByRole("status")).toHaveTextContent(
      "1 drawing in this browser isn't in your account yet",
    );
    expect(imported).not.toHaveBeenCalled();
    fireEvent.click(
      screen.getByRole("button", { name: "Import browser drawings" }),
    );

    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent(
        "Imported 1 drawing",
      ),
    );
    expect(imported).toHaveBeenCalledWith(local);
    expect(deleted).not.toHaveBeenCalled();
    expect(closed).toHaveBeenCalledTimes(2);
  });

  it("names the browser drawings an import had to leave behind", async () => {
    const remote = await RemoteWorkspaceStore.open({
      session: signedIn,
      ownerWindow: window,
      onSessionExpired: vi.fn(),
      fetch: vi
        .fn<typeof fetch>()
        .mockResolvedValue(response({ folders: [], drawings: [] })),
    });
    remoteStores.push(remote);
    const local = await workspace.open();
    const paintball = await local.createDrawing({
      folderId: null,
      name: "Paintball",
    });
    vi.spyOn(LocalWorkspaceStore, "open").mockResolvedValue(local);
    vi.spyOn(local, "close").mockImplementation(() => {});
    vi.spyOn(remote, "importLocalWorkspace").mockResolvedValue({
      imported: 0,
      skipped: [paintball],
    });

    render(withAccount(signedIn, remote, <AccountControls />));
    fireEvent.click(
      await screen.findByRole("button", { name: "Import browser drawings" }),
    );

    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent(
        "Couldn't import “Paintball”. They're still in this browser.",
      ),
    );
    expect(screen.getByRole("button", { name: "Try again" })).toBeVisible();
  });

  it("shows a recoverable boot failure and retries without clearing storage", async () => {
    const store = await workspace.open();
    localStorage.setItem("greendale-draft", "Dreamatorium");
    vi.spyOn(workspaceStore, "openWorkspaceStore")
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce(store);

    render(<SetsquareApp />);

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Could not open your drawings",
    );
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));

    expect(await screen.findByRole("main")).toBeInTheDocument();
    expect(localStorage.getItem("greendale-draft")).toBe("Dreamatorium");
    expect(workspaceStore.openWorkspaceStore).toHaveBeenCalledTimes(2);
  });

  it("detects an account change on focus while keeping the old workspace", async () => {
    const store = await workspace.open();
    vi.spyOn(workspaceStore, "openWorkspaceStore").mockImplementation(
      async (options) => {
        options?.onSession?.(signedIn);
        return store;
      },
    );
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(
      response({
        ...signedIn,
        user: { ...signedIn.user, id: "abed-account", login: "abed" },
      }),
    );
    vi.stubGlobal("fetch", fetch);

    render(<SetsquareApp />);
    await screen.findByRole("main");
    fireEvent.focus(window);

    await waitFor(() =>
      expect(screen.getByRole("link", { name: "Sign in again" })).toBeVisible(),
    );
    expect(screen.getByRole("main")).toBeInTheDocument();
    expect(screen.queryByText("Saved to abed")).toBeNull();
  });
});

describe("account session discovery", () => {
  it("supports the static app without a backend", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response({}, 404)));

    expect(await workspaceStore.readAccountSession(window)).toEqual({
      kind: "local",
    });
  });

  it("reports a known account server that doesn't answer as unreachable", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(response(signedIn))
      .mockResolvedValueOnce(response({}, 503))
      .mockRejectedValueOnce(new TypeError("Failed to fetch"));
    vi.stubGlobal("fetch", fetch);

    expect(await workspaceStore.readAccountSession(window)).toEqual(signedIn);
    expect(await workspaceStore.readAccountSession(window)).toEqual({
      kind: "unreachable",
    });
    expect(await workspaceStore.readAccountSession(window)).toEqual({
      kind: "unreachable",
    });
  });

  it("opens the browser's drawings while the account can't be reached", async () => {
    localStorage.setItem("setsquare-account-server", "true");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new TypeError("Failed to fetch")),
    );
    const local = await workspace.open();
    vi.spyOn(LocalWorkspaceStore, "open").mockResolvedValue(local);
    const onSession = vi.fn();

    const store = await workspaceStore.openWorkspaceStore({
      ownerWindow: window,
      onSession,
    });

    expect(store).toBe(local);
    expect(onSession).toHaveBeenCalledWith({ kind: "unreachable" });
  });
});
