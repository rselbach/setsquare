import { fireEvent, render, screen, waitFor } from "@testing-library/react";

import { CaptureUpdateAction } from "@setsquare/setsquare";
import { API } from "@setsquare/setsquare/tests/helpers/api";

import SetsquareApp from "../../App";
import { AccountContext } from "../../web/accountContext";
import {
  AccountMenu,
  AccountNotice,
  StorageNote,
} from "../../web/accountControls";
import { setLeaveGuard } from "../../web/router";
import * as workspaceStore from "../../web/workspaceStore";
import { LocalWorkspaceStore } from "../../workspace/local/LocalWorkspaceStore";
import { RemoteWorkspaceStore } from "../../workspace/remote/RemoteWorkspaceStore";
import { workspaceFixture } from "../workspace/helpers";

import {
  cleanUpWebApp,
  renderWebAppAt,
  savedContent,
  waitForAutosave,
  waitForDrawing,
} from "./helpers";

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

    render(
      withAccount(
        { kind: "signedOut" },
        store,
        <>
          <AccountMenu toast={{ show: vi.fn() }} />
          <StorageNote />
        </>,
      ),
    );

    expect(screen.getByRole("link", { name: "Sign in" })).toHaveAttribute(
      "href",
      "/api/auth/github?returnTo=%2Frecent%3Fgreendale%3D1",
    );
    expect(screen.getByText("Stored in this browser")).toBeInTheDocument();
  });

  it("shows nothing to sign in to without an account server", async () => {
    const store = await workspace.open();

    render(
      withAccount(
        { kind: "local" },
        store,
        <AccountMenu toast={{ show: vi.fn() }} />,
      ),
    );

    expect(screen.queryByRole("link")).toBeNull();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("shows who is signed in with their GitHub avatar", async () => {
    const store = await workspace.open();

    render(
      withAccount(signedIn, store, <AccountMenu toast={{ show: vi.fn() }} />),
    );
    const trigger = screen.getByRole("button", {
      name: "Account menu for Troy Barnes",
    });
    expect(trigger.querySelector("img")).toHaveAttribute(
      "src",
      signedIn.user.avatarUrl,
    );
    fireEvent.click(trigger);

    expect(await screen.findByText("troy-barnes on GitHub")).toBeVisible();
    expect(screen.getByRole("menuitem", { name: "Sign out" })).toBeVisible();
  });

  it("shows initials when the avatar can't load", async () => {
    const store = await workspace.open();

    render(
      withAccount(signedIn, store, <AccountMenu toast={{ show: vi.fn() }} />),
    );
    const trigger = screen.getByRole("button", {
      name: "Account menu for Troy Barnes",
    });
    fireEvent.error(trigger.querySelector("img")!);

    expect(trigger).toHaveTextContent("TB");
  });

  it("offers a way back to the account while it can't be reached", async () => {
    const store = await workspace.open();

    render(
      withAccount(
        { kind: "unreachable" },
        store,
        <>
          <AccountMenu toast={{ show: vi.fn() }} />
          <AccountNotice />
        </>,
      ),
    );

    expect(screen.getByRole("button", { name: "Reconnect" })).toBeVisible();
    expect(screen.getByRole("status")).toHaveTextContent(
      "Showing the drawings stored in this browser",
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
    render(
      withAccount(
        signedIn,
        store,
        <AccountMenu toast={{ show: vi.fn() }} />,
        ownerWindow,
      ),
    );

    fireEvent.click(
      screen.getByRole("button", { name: "Account menu for Troy Barnes" }),
    );
    fireEvent.click(await screen.findByRole("menuitem", { name: "Sign out" }));
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

  it("signs out past a stalled save once the recovery draft holds the edit", async () => {
    const store = Object.assign(await workspace.open(), {
      recoveryKey: signedIn.user.id,
      recoveryStorage: window.localStorage,
      recoveryDrafts: {
        save: vi.fn().mockResolvedValue(undefined),
        load: vi.fn().mockResolvedValue([]),
        remove: vi.fn().mockResolvedValue(undefined),
      },
    });
    const drawing = await store.createDrawing({
      folderId: null,
      name: "Greendale",
      content: savedContent("Greendale", "troy"),
    });
    vi.spyOn(workspaceStore, "openWorkspaceStore").mockImplementation(
      async (options) => {
        options?.onSession?.(signedIn);
        return store;
      },
    );
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetch);
    // jsdom reports the page load sign out ends with as not implemented
    vi.spyOn(console, "error").mockImplementation(() => {});
    await renderWebAppAt(`/d/${drawing.id}`);
    await waitForDrawing(drawing.id, ["troy"]);
    vi.spyOn(store, "saveDrawingContent").mockReturnValue(
      new Promise(() => {}),
    );
    API.updateScene({
      elements: [
        ...window.h.elements,
        API.createElement({ type: "ellipse", id: "annie" }),
      ],
      captureUpdate: CaptureUpdateAction.IMMEDIATELY,
    });
    await waitForAutosave();

    fireEvent.click(
      screen.getByRole("button", { name: "Account menu for Troy Barnes" }),
    );
    fireEvent.click(await screen.findByRole("menuitem", { name: "Sign out" }));

    await waitFor(
      () =>
        expect(fetch).toHaveBeenCalledWith(
          "/api/auth/logout",
          expect.objectContaining({ method: "POST" }),
        ),
      { timeout: 3000 },
    );
    expect(store.recoveryDrafts.save).toHaveBeenLastCalledWith(
      expect.objectContaining({ id: drawing.id }),
    );
    await cleanUpWebApp(workspace);
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
    const show = vi.fn();

    render(withAccount(signedIn, remote, <AccountMenu toast={{ show }} />));
    fireEvent.click(
      screen.getByRole("button", { name: "Account menu for Troy Barnes" }),
    );
    expect(imported).not.toHaveBeenCalled();
    fireEvent.click(
      await screen.findByRole("menuitem", { name: "Import 1 browser drawing" }),
    );

    await waitFor(() =>
      expect(show).toHaveBeenCalledWith({
        text: "Imported 1 drawing. This browser keeps its copy.",
        error: false,
      }),
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
    const show = vi.fn();

    render(withAccount(signedIn, remote, <AccountMenu toast={{ show }} />));
    fireEvent.click(
      screen.getByRole("button", { name: "Account menu for Troy Barnes" }),
    );
    fireEvent.click(
      await screen.findByRole("menuitem", { name: "Import 1 browser drawing" }),
    );

    await waitFor(() =>
      expect(show).toHaveBeenCalledWith({
        text: "Couldn't import “Paintball”. They're still in this browser.",
        error: true,
      }),
    );
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
      expect(
        screen.getAllByRole("link", { name: "Sign in again" }).length,
      ).toBeGreaterThan(0),
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
