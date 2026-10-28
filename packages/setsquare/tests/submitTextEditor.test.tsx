import React from "react";
import { vi } from "vitest";

import { KEYS } from "@setsquare/common";

import type { SetsquareElement } from "@setsquare/element/types";

import { Setsquare } from "../index";

import { API } from "./helpers/api";
import { Keyboard } from "./helpers/ui";
import { getTextEditor, updateTextEditor } from "./queries/dom";
import { act, render } from "./test-utils";

const { h } = window;

describe("api.submitTextEditor()", () => {
  it("commits the text being typed", async () => {
    const onChange = vi.fn<(elements: readonly SetsquareElement[]) => void>();
    await render(<Setsquare onChange={onChange} handleKeyboardGlobally />);
    const text = API.createElement({ type: "text", text: "Greendale" });
    API.setElements([text]);
    API.setSelectedElements([text]);
    Keyboard.keyPress(KEYS.ENTER);
    const editor = await getTextEditor();
    updateTextEditor(editor, "Greendale Community College");
    onChange.mockClear();

    act(() => h.app.api.submitTextEditor());

    expect(h.state.editingTextElement).toBe(null);
    expect(document.querySelector(".setsquare-wysiwyg")).toBe(null);
    expect(h.elements.find((element) => element.id === text.id)).toMatchObject({
      originalText: "Greendale Community College",
    });
    const [elements] = onChange.mock.lastCall!;
    expect(elements.find((element) => element.id === text.id)).toMatchObject({
      originalText: "Greendale Community College",
    });
  });

  it("does nothing while no text is being edited", async () => {
    await render(<Setsquare />);
    const text = API.createElement({ type: "text", text: "Troy" });
    API.setElements([text]);

    act(() => h.app.api.submitTextEditor());

    expect(h.elements).toEqual([text]);
  });
});
