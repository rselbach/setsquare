import { t } from "../i18n";

import { useAppProps, useSetsquareSetAppState } from "./App";
import { ExportImageIcon } from "./icons";

import "./ExportButton.scss";

export const ExportButton = () => {
  const { UIOptions } = useAppProps();
  const setAppState = useSetsquareSetAppState();

  if (!UIOptions.canvasActions.saveAsImage) {
    return null;
  }

  const label = t("toolBar.export");

  return (
    <button
      type="button"
      className="export-button"
      title={label}
      aria-label={label}
      onClick={() =>
        setAppState({
          openDialog: { name: "imageExport" },
          openMenu: null,
          openPopup: null,
        })
      }
    >
      {ExportImageIcon}
      <span className="export-button__label">{label}</span>
    </button>
  );
};
