import clsx from "clsx";
import React, { useEffect, useId, useMemo, useState } from "react";

import {
  MQ_RIGHT_SIDEBAR_MIN_WIDTH,
  THEME,
  createUserAgentDescriptor,
  getFormFactor,
  isShallowEqual,
} from "@setsquare/common";

import type { EditorInterface } from "@setsquare/common";
import type { Theme } from "@setsquare/element/types";

import { getDefaultAppState } from "../appState";
import { UIAppStateContext } from "../context/ui-appState";
import { EditorJotaiProvider, editorJotaiStore } from "../editor-jotai";
import { languages, useI18n } from "../i18n";

import {
  EditorInterfaceContext,
  SetsquareContainerContext,
  SetsquareSetAppStateContext,
} from "./App";
import { InitializeApp } from "./InitializeApp";

import type { AppState } from "../types";

type StandaloneUIProviderProps = {
  theme: Theme;
  /** the language to show, as `<Setsquare langCode>` takes it */
  langCode: string;
  /** classes for the `.setsquare` element the children render in */
  className?: string;
  children: React.ReactNode;
};

// the editor measures its own container; a page has the window to go by
const windowEditorInterface = (
  previous: EditorInterface | null,
): EditorInterface => {
  const { innerWidth: width, innerHeight: height } = window;
  const next: EditorInterface = {
    formFactor: getFormFactor(width, height),
    desktopUIMode: "full",
    userAgent:
      previous?.userAgent ?? createUserAgentDescriptor(navigator.userAgent),
    // the editor learns of touch from the pointers on its canvas
    isTouchScreen: false,
    canFitSidebar: width > MQ_RIGHT_SIDEBAR_MIN_WIDTH,
    isLandscape: width > height,
  };
  return previous && isShallowEqual(previous, next) ? previous : next;
};

// outside the editor there's no app state, such as an open menu, to change
const setNoAppState = () => {};

const StandaloneUI = ({
  theme,
  className,
  children,
}: Omit<StandaloneUIProviderProps, "langCode">) => {
  const { langCode } = useI18n();
  const id = useId();
  const [container, setContainer] = useState<HTMLDivElement | null>(null);
  const [editorInterface, setEditorInterface] = useState(() =>
    windowEditorInterface(null),
  );

  useEffect(() => {
    const onResize = () => setEditorInterface(windowEditorInterface);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  const containerValue = useMemo(() => ({ container, id }), [container, id]);
  const appState = useMemo(
    (): AppState => ({
      ...getDefaultAppState(),
      width: 0,
      height: 0,
      offsetLeft: 0,
      offsetTop: 0,
      theme,
    }),
    [theme],
  );
  const rtl = languages.find((lang) => lang.code === langCode)?.rtl;

  return (
    <SetsquareContainerContext.Provider value={containerValue}>
      <EditorInterfaceContext.Provider value={editorInterface}>
        <SetsquareSetAppStateContext.Provider value={setNoAppState}>
          <UIAppStateContext.Provider value={appState}>
            <div
              ref={setContainer}
              className={clsx("setsquare", className, {
                "theme--dark": theme === THEME.DARK,
                "setsquare--mobile": editorInterface.formFactor === "phone",
              })}
              dir={rtl ? "rtl" : "ltr"}
            >
              {children}
            </div>
          </UIAppStateContext.Provider>
        </SetsquareSetAppStateContext.Provider>
      </EditorInterfaceContext.Provider>
    </SetsquareContainerContext.Provider>
  );
};

/**
 * Lets the editor's dialogs, menus and fields, such as `Dialog`,
 * `ConfirmDialog`, `DropdownMenu` and `TextField`, work outside
 * `<Setsquare>`, as on a page of the host app's own. It gives them the
 * editor's state, the theme, the language `langCode` names, loaded before
 * the children show, and a form factor from the window's size.
 *
 * The children render in a `.setsquare` element, in the theme and the
 * language's direction, so the editor's styles apply to them. The editor's
 * state is shared with `<Setsquare>`, so show one or the other at a time.
 */
export const StandaloneUIProvider = ({
  langCode,
  ...props
}: StandaloneUIProviderProps) => (
  <EditorJotaiProvider store={editorJotaiStore}>
    <InitializeApp langCode={langCode} theme={props.theme}>
      <StandaloneUI {...props} />
    </InitializeApp>
  </EditorJotaiProvider>
);
