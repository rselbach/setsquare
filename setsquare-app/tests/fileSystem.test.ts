import { Blob as NodeBlob } from "node:buffer";

import { invoke } from "@tauri-apps/api/core";

import { DesktopFileHandle } from "../desktop/fileSystem";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(async () => {}),
  isTauri: () => false,
}));

describe("DesktopFileHandle", () => {
  // jsdom's Blob can't be read back as bytes
  beforeEach(() => {
    vi.stubGlobal("Blob", NodeBlob);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("saves the whole file through the app, naming it by file URL", async () => {
    const handle = new DesktopFileHandle(
      "/Users/abed/Greendale #1/Señor Chang?.setsquare",
    );

    const writable = await handle.createWritable();
    await writable.write(new Blob(["troy "]));
    await writable.write(new Blob(["and abed"]));
    await writable.close();

    expect(invoke).toHaveBeenCalledTimes(1);
    const [command, bytes, options] = vi.mocked(invoke).mock.calls[0];
    expect(command).toBe("save_file");
    expect(new TextDecoder().decode(bytes as Uint8Array)).toBe("troy and abed");
    const url = new URL((options as any).headers.url);
    expect(decodeURIComponent(url.pathname)).toBe(
      "/Users/abed/Greendale #1/Señor Chang?.setsquare",
    );
    expect(url.search).toBe("");
    expect(url.hash).toBe("");
  });
});
