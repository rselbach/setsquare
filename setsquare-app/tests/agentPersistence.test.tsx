import { Setsquare } from "@setsquare/setsquare";
import { API } from "@setsquare/setsquare/tests/helpers/api";
import { render } from "@setsquare/setsquare/tests/test-utils";

import { STORAGE_KEYS } from "../app_constants";
import { LocalData } from "../data/LocalData";

const { h } = window;

afterEach(() => vi.restoreAllMocks());

it("persists agent changes while ordinary autosave is paused", async () => {
  await render(<Setsquare />);
  vi.spyOn(h.app.ownerDocument, "hidden", "get").mockReturnValue(true);
  const elements = [API.createElement({ type: "rectangle", id: "greendale" })];
  expect(LocalData.isSavePaused()).toBe(true);
  await LocalData.saveImmediately(elements, h.state, {});
  expect(
    JSON.parse(localStorage.getItem(STORAGE_KEYS.LOCAL_STORAGE_ELEMENTS)!),
  ).toMatchObject([{ id: "greendale" }]);
});

it("reports storage failures to the agent", async () => {
  await render(<Setsquare />);
  vi.spyOn(localStorage, "setItem").mockImplementation(() => {
    throw new DOMException("Full", "QuotaExceededError");
  });
  vi.spyOn(console, "error").mockImplementation(() => {});
  await expect(LocalData.saveImmediately([], h.state, {})).rejects.toThrow(
    "local storage could not save",
  );
});
