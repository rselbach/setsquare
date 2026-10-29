import DropdownMenu from "@setsquare/setsquare/components/dropdownMenu/DropdownMenu";
import {
  DotsHorizontalIcon,
  DuplicateIcon,
  LoadIcon,
  pencilIcon,
} from "@setsquare/setsquare/components/icons";
import { useI18n } from "@setsquare/setsquare/i18n";
import { useState } from "react";

import { navigate } from "../../web/router";

import type { Route } from "../../web/router";

/** A card's `⋯` menu: Open, Rename, and Duplicate when given. */
export const ItemMenu = ({
  label,
  to,
  onRename,
  onDuplicate,
}: {
  label: string;
  /** where Open goes */
  to: Route;
  onRename: () => void;
  onDuplicate?: () => void;
}) => {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);

  return (
    <DropdownMenu open={open}>
      <DropdownMenu.Trigger
        className="workspace-card__more"
        onToggle={() => setOpen(!open)}
        title={label}
        aria-label={label}
      >
        {DotsHorizontalIcon}
      </DropdownMenu.Trigger>
      <DropdownMenu.Content
        className="workspace-menu"
        onClickOutside={() => setOpen(false)}
        onSelect={() => setOpen(false)}
      >
        <DropdownMenu.Item icon={LoadIcon} onSelect={() => navigate(to)}>
          {t("workspace.open")}
        </DropdownMenu.Item>
        <DropdownMenu.Item icon={pencilIcon} onSelect={onRename}>
          {t("buttons.rename")}
        </DropdownMenu.Item>
        {onDuplicate && (
          <DropdownMenu.Item icon={DuplicateIcon} onSelect={onDuplicate}>
            {t("workspace.duplicate")}
          </DropdownMenu.Item>
        )}
      </DropdownMenu.Content>
    </DropdownMenu>
  );
};
