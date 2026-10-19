import { useRef, useState } from "react";

import { useLibraryCache, useLibraryItemSvg } from "../hooks/useLibraryItemSvg";
import { t } from "../i18n";

import { Dialog } from "./Dialog";
import DialogActionButton from "./DialogActionButton";

import "./LibraryRenameDialog.scss";

import type { LibraryItem, LibraryItems } from "../types";

const LibraryItemPreview = ({ item }: { item: LibraryItem }) => {
  const ref = useRef<HTMLDivElement | null>(null);
  const { svgCache } = useLibraryCache();
  useLibraryItemSvg(item.id, item.elements, svgCache, ref);

  return <div className="library-rename-dialog__preview" ref={ref} />;
};

export const LibraryRenameDialog = ({
  libraryItems,
  onClose,
}: {
  libraryItems: LibraryItems;
  onClose: (names: Map<LibraryItem["id"], string>) => void;
}) => {
  const [names, setNames] = useState(
    () => new Map(libraryItems.map((item) => [item.id, item.name ?? ""])),
  );
  const close = () => onClose(names);

  return (
    <Dialog
      onCloseRequest={close}
      title={t("buttons.rename")}
      className="library-rename-dialog"
    >
      <div className="library-rename-dialog__items">
        {libraryItems.map((item) => (
          <label key={item.id} className="library-rename-dialog__item">
            <LibraryItemPreview item={item} />
            {t("library.itemName")}
            <input
              type="text"
              value={names.get(item.id)}
              onChange={(event) =>
                setNames(new Map(names).set(item.id, event.target.value))
              }
            />
          </label>
        ))}
      </div>
      <div className="library-rename-dialog__buttons">
        <DialogActionButton
          label={t("buttons.saveLibNames")}
          actionType="primary"
          onClick={close}
        />
      </div>
    </Dialog>
  );
};
