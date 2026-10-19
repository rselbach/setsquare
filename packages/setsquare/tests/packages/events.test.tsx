import React from "react";
import { vi } from "vitest";

import { resolvablePromise } from "@setsquare/common";

import { Setsquare, CaptureUpdateAction } from "../../index";
import { API } from "../helpers/api";
import { Pointer } from "../helpers/ui";
import { render, unmountComponent } from "../test-utils";

import type { SetsquareImperativeAPI } from "../../types";

describe("event callbacks", () => {
  const h = window.h;

  let setsquareAPI: SetsquareImperativeAPI;

  const mouse = new Pointer("mouse");

  beforeEach(async () => {
    const setsquareAPIPromise = resolvablePromise<SetsquareImperativeAPI>();
    await render(
      <Setsquare
        onSetsquareAPI={(api) => setsquareAPIPromise.resolve(api as any)}
      />,
    );
    setsquareAPI = await setsquareAPIPromise;
  });

  it("should resolve editor:mount/editor:initialize when subscribed before mount", async () => {
    unmountComponent();

    const lifecyclePromise = resolvablePromise<{
      api: SetsquareImperativeAPI;
      mount: Promise<{
        setsquareAPI: SetsquareImperativeAPI;
        container: HTMLDivElement | null;
      }>;
      initialize: Promise<SetsquareImperativeAPI>;
    }>();

    await render(
      <Setsquare
        onSetsquareAPI={(api) => {
          if (api) {
            lifecyclePromise.resolve({
              api,
              mount: api.onEvent("editor:mount"),
              initialize: api.onEvent("editor:initialize"),
            });
          }
        }}
      />,
    );

    const { api, mount, initialize } = await lifecyclePromise;
    await expect(mount).resolves.toEqual({
      setsquareAPI: api,
      container: expect.any(HTMLDivElement),
    });
    await expect(initialize).resolves.toBe(api);
  });

  it("should replay editor:mount/editor:initialize to late subscribers", async () => {
    const onMount = vi.fn();
    const onInitialize = vi.fn();

    setsquareAPI.onEvent("editor:mount", onMount);
    setsquareAPI.onEvent("editor:initialize", onInitialize);

    await Promise.resolve();

    expect(onMount).toHaveBeenCalledTimes(1);
    expect(onMount).toHaveBeenCalledWith({
      setsquareAPI,
      container: expect.any(HTMLDivElement),
    });
    expect(onInitialize).toHaveBeenCalledTimes(1);
    expect(onInitialize).toHaveBeenCalledWith(setsquareAPI);

    await expect(setsquareAPI.onEvent("editor:mount")).resolves.toEqual({
      setsquareAPI,
      container: expect.any(HTMLDivElement),
    });
    await expect(setsquareAPI.onEvent("editor:initialize")).resolves.toBe(
      setsquareAPI,
    );
  });

  it("should call onMount before onInitialize props", async () => {
    unmountComponent();

    const calls: string[] = [];

    await render(
      <Setsquare
        onMount={({ setsquareAPI, container }) => {
          expect(setsquareAPI).toBeDefined();
          expect(container).toBeInstanceOf(HTMLDivElement);
          calls.push("mount");
        }}
        onInitialize={() => {
          calls.push("initialize");
        }}
      />,
    );

    expect(calls).toEqual(["mount", "initialize"]);
  });

  it("should trigger onChange on render", async () => {
    const onChange = vi.fn();

    const origBackgroundColor = h.state.viewBackgroundColor;
    setsquareAPI.onChange(onChange);
    API.updateScene({
      appState: { viewBackgroundColor: "red" },
      captureUpdate: CaptureUpdateAction.IMMEDIATELY,
    });
    expect(onChange).toHaveBeenCalledWith(
      // elements
      [],
      // appState
      expect.objectContaining({
        viewBackgroundColor: "red",
      }),
      // files
      {},
    );
    expect(onChange.mock?.lastCall?.[1].viewBackgroundColor).not.toBe(
      origBackgroundColor,
    );
  });

  it("should trigger onPointerDown/onPointerUp on canvas pointerDown/pointerUp", async () => {
    const onPointerDown = vi.fn();
    const onPointerUp = vi.fn();

    setsquareAPI.onPointerDown(onPointerDown);
    setsquareAPI.onPointerUp(onPointerUp);

    mouse.downAt(100);
    expect(onPointerDown).toHaveBeenCalledTimes(1);
    expect(onPointerUp).not.toHaveBeenCalled();
    mouse.up();
    expect(onPointerDown).toHaveBeenCalledTimes(1);
    expect(onPointerUp).toHaveBeenCalledTimes(1);
  });
});
