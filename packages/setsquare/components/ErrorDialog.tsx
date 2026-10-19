import React, { useState } from "react";

import { t } from "../i18n";

import { useSetsquareContainer } from "./App";
import { Dialog } from "./Dialog";

export const ErrorDialog = ({
  children,
  onClose,
}: {
  children?: React.ReactNode;
  onClose?: () => void;
}) => {
  const [modalIsShown, setModalIsShown] = useState(!!children);
  const { container: setsquareContainer } = useSetsquareContainer();

  const handleClose = React.useCallback(() => {
    setModalIsShown(false);

    if (onClose) {
      onClose();
    }
    // TODO: Fix the A11y issues so this is never needed since we should always focus on last active element
    setsquareContainer?.focus();
  }, [onClose, setsquareContainer]);

  return (
    <>
      {modalIsShown && (
        <Dialog
          size="small"
          onCloseRequest={handleClose}
          title={t("errorDialog.title")}
        >
          <div style={{ whiteSpace: "pre-wrap" }}>{children}</div>
        </Dialog>
      )}
    </>
  );
};
