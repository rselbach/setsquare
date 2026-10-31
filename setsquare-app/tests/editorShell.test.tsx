import { SetsquareAPIProvider } from "@setsquare/setsquare";
import { render, screen, waitFor } from "@testing-library/react";
import { Fragment, StrictMode } from "react";

import type { SetsquareInitialDataState } from "@setsquare/setsquare/types";

import { TopErrorBoundary } from "../components/TopErrorBoundary";
import { FileManager } from "../data/FileManager";
import { EditorShell } from "../editor/EditorShell";

import type { ScenePersistence } from "../editor/ScenePersistence";

const { h } = window;

const persistenceWith = (
  load: () => Promise<SetsquareInitialDataState>,
): ScenePersistence => ({
  load,
  opened: vi.fn(),
  save: vi.fn(),
  flush: async () => {},
  isSavePaused: () => false,
  changedElsewhere: async () => ({ scene: null, files: false }),
  fileStorage: new FileManager({
    getFiles: async () => ({ loadedFiles: [], erroredFiles: new Map() }),
    saveFiles: async () => ({ savedFiles: new Map(), erroredFiles: new Map() }),
  }),
});

const editorWith = (persistence: ScenePersistence, key?: string) => (
  <TopErrorBoundary>
    <SetsquareAPIProvider>
      <EditorShell
        key={key}
        persistence={persistence}
        theme="light"
        onThemeChange={() => {}}
      >
        {null}
      </EditorShell>
    </SetsquareAPIProvider>
  </TopErrorBoundary>
);

const emptyScene = async () => ({ elements: [], appState: null });

afterEach(() => {
  vi.restoreAllMocks();
});

describe("EditorShell", () => {
  it("shows the error when the scene can't load, rather than an empty one", async () => {
    // React reports the error it caught
    vi.spyOn(console, "error").mockImplementation(() => {});
    const persistence = persistenceWith(() =>
      Promise.reject(new Error("Chang locked the study room")),
    );

    render(editorWith(persistence));

    expect(
      await screen.findByRole("button", { name: "reloading the page" }),
    ).toBeInTheDocument();
    expect(persistence.opened).not.toHaveBeenCalled();
    expect(persistence.save).not.toHaveBeenCalled();
  });

  it.each([false, true])(
    "tells the next scene's persistence once that it opened, in StrictMode = %s",
    async (strict) => {
      const Mode = strict ? StrictMode : Fragment;
      const { rerender } = render(
        <Mode>{editorWith(persistenceWith(emptyScene), "plan")}</Mode>,
      );
      await waitFor(() => expect(h.state.isLoading).toBe(false));
      const seating = persistenceWith(emptyScene);

      // as the web app opens the next drawing
      rerender(<Mode>{editorWith(seating, "seating")}</Mode>);

      await waitFor(() => expect(seating.opened).toHaveBeenCalled());
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(seating.opened).toHaveBeenCalledTimes(1);
    },
  );
});
