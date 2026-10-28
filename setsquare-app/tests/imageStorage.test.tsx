import { API } from "@setsquare/setsquare/tests/helpers/api";
import {
  act,
  render,
  screen,
  waitFor,
} from "@setsquare/setsquare/tests/test-utils";
import { t } from "@setsquare/setsquare/i18n";
import { CaptureUpdateAction } from "@setsquare/setsquare";

import type { FileId } from "@setsquare/element/types";
import type { DataURL } from "@setsquare/setsquare/types";

import SetsquareApp from "../App";
import { LocalData } from "../data/LocalData";

const storage = vi.hoisted(() => ({ full: false }));

vi.mock("idb-keyval", async (importOriginal) => {
  const module = await importOriginal<typeof import("idb-keyval")>();
  return {
    ...module,
    set: (...args: Parameters<typeof module.set>) =>
      storage.full
        ? Promise.reject(new DOMException("full", "QuotaExceededError"))
        : module.set(...args),
  };
});

// the native menu bar needs the desktop app itself; DesktopMenu.test covers it
vi.mock("../desktop/DesktopMenu", () => ({ DesktopMenu: () => null }));

const { h } = window;

// the single scene's image storage, which LocalData holds
describe("image storage", () => {
  beforeEach(() => {
    Object.assign(window, { isTauri: true });
  });

  afterEach(() => {
    delete (window as any).isTauri;
  });

  it("tells the user when images can't be saved", async () => {
    await render(<SetsquareApp />);
    const fileId = "jeff" as FileId;
    const image = API.createElement({ type: "image", fileId });

    storage.full = true;
    act(() => {
      h.app.addFiles([
        {
          id: fileId,
          dataURL: "data:image/png;base64,AAAA" as DataURL,
          mimeType: "image/png",
          created: Date.now(),
        },
      ]);
      API.updateScene({
        elements: [image],
        captureUpdate: CaptureUpdateAction.IMMEDIATELY,
      });
    });

    expect(
      await screen.findByText(t("alerts.imageSaveFailed")),
    ).toBeInTheDocument();
    expect(LocalData.fileStorage.shouldPreventUnload(h.elements)).toBe(true);

    // the next save retries the image
    storage.full = false;
    act(() => {
      API.updateElement(image, { x: 100 });
    });

    await waitFor(() =>
      expect(screen.queryByText(t("alerts.imageSaveFailed"))).toBeNull(),
    );
    expect(LocalData.fileStorage.shouldPreventUnload(h.elements)).toBe(false);
  });
});
