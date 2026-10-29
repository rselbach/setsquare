import React, { useEffect, useState } from "react";

import type { Theme } from "@setsquare/element/types";

import { defaultLang, isLanguageLoaded, languages, setLanguage } from "../i18n";

import { LoadingMessage } from "./LoadingMessage";

import type { Language } from "../i18n";

interface Props {
  langCode: Language["code"];
  children: React.ReactElement;
  theme?: Theme;
}

const findLanguage = (code: Language["code"]) =>
  languages.find((lang) => lang.code === code) || defaultLang;

export const InitializeApp = (props: Props) => {
  // a language another editor or page loaded shows at once, so moving
  // between them doesn't flash the loading screen
  const [loading, setLoading] = useState(
    () => !isLanguageLoaded(findLanguage(props.langCode).code),
  );

  useEffect(() => {
    const updateLang = async () => {
      await setLanguage(currentLang);
      setLoading(false);
    };
    const currentLang = findLanguage(props.langCode);
    updateLang();
  }, [props.langCode]);

  return loading ? <LoadingMessage theme={props.theme} /> : props.children;
};
