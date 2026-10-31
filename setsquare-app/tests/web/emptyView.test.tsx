import { THEME } from "@setsquare/common";
import { StandaloneUIProvider } from "@setsquare/setsquare";
import {
  fireEvent,
  render,
  screen,
  waitFor,
} from "@setsquare/setsquare/tests/test-utils";

import { EmptyView } from "../../workspace/ui/EmptyView";

import type { BrowserImportState } from "../../web/browserImport";

const renderRoot = (
  state: BrowserImportState,
  run = vi.fn(async (): Promise<BrowserImportState> => state),
) => {
  const show = vi.fn();
  render(
    <StandaloneUIProvider theme={THEME.LIGHT} langCode="en">
      <EmptyView
        view="folder"
        folderId={null}
        query=""
        browserImport={{ state, run }}
        newDrawing={() => {}}
        toast={{ show }}
      />
    </StandaloneUIProvider>,
  );
  return { run, show };
};

const importButton = () =>
  screen.queryByRole("button", { name: /browser drawings/ });

describe("the empty workspace's import prompt", () => {
  it.each<[string, BrowserImportState]>([
    ["while it checks the browser", { kind: "checking" }],
    ["with nothing to import", { kind: "ready", pending: 0 }],
  ])("isn't there %s", (_, state) => {
    renderRoot(state);

    expect(
      screen.getByRole("heading", { name: "No drawings yet" }),
    ).toBeInTheDocument();
    expect(importButton()).toBeNull();
    expect(screen.queryByText(/saved in this browser/)).toBeNull();
  });

  it("offers the one drawing the account doesn't have", () => {
    renderRoot({ kind: "ready", pending: 1 });

    expect(
      screen.getByText(
        "1 drawing is saved in this browser but not in your account.",
      ),
    ).toBeInTheDocument();
    expect(importButton()).toHaveTextContent("Import browser drawings");
    expect(importButton()).toBeEnabled();
  });

  it("counts the drawings the account doesn't have", () => {
    renderRoot({ kind: "ready", pending: 7 });

    expect(
      screen.getByText(
        "7 drawings are saved in this browser but not in your account.",
      ),
    ).toBeInTheDocument();
  });

  it("can't be started again while importing", () => {
    renderRoot({ kind: "importing", pending: 2 });

    expect(importButton()).toHaveTextContent("Importing browser drawings…");
    expect(importButton()).toBeDisabled();
  });

  it("imports and says how it went", async () => {
    const { run, show } = renderRoot(
      { kind: "ready", pending: 1 },
      vi.fn(async (): Promise<BrowserImportState> => ({
        kind: "imported",
        pending: 0,
        result: { imported: 1, skipped: [] },
      })),
    );

    fireEvent.click(importButton()!);

    expect(run).toHaveBeenCalledTimes(1);
    await waitFor(() =>
      expect(show).toHaveBeenCalledWith({
        text: "Imported 1 drawing. This browser keeps its copy.",
        error: false,
      }),
    );
  });
});
