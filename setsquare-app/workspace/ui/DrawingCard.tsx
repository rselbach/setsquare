import { useI18n } from "@setsquare/setsquare/i18n";
import clsx from "clsx";

import { RouteLink } from "../../web/RouteLink";
import { formatRelativeTime } from "../formatRelativeTime";

import { InlineName, useCardKeys } from "./InlineName";
import { ItemMenu } from "./ItemMenu";
import { useDragSource } from "./useWorkspaceDrag";

import type { DrawingMeta, Thumbnail } from "../types";

// a registration mark on blank paper, for a drawing with nothing to show
const blankSheet = (
  <svg
    className="drawing-card__blank"
    viewBox="0 0 48 48"
    aria-hidden="true"
    focusable="false"
  >
    <circle cx="24" cy="24" r="9" />
    <path d="M24 8v32M8 24h32" />
  </svg>
);

/**
 * A drawing of the grid: its thumbnail on a sheet of paper, with the name
 * and when it was last edited in a ruled strip below, like the editor's
 * title block. The whole card is its link, which can be dragged.
 */
export const DrawingCard = ({
  drawing,
  thumbnail,
  now,
  location,
  renaming,
  onStartRename,
  onStopRename,
  onRename,
  onDuplicate,
  onMove,
  onTrash,
}: {
  drawing: DrawingMeta;
  thumbnail?: Thumbnail;
  now: number;
  /** where the drawing is, for lists across folders */
  location?: string;
  renaming: boolean;
  onStartRename: () => void;
  onStopRename: () => void;
  onRename: (name: string | null) => void;
  onDuplicate: () => void;
  /** given the card, where the focus goes back to */
  onMove: (card: HTMLElement | null) => void;
  onTrash: (card: HTMLElement | null) => void;
}) => {
  const { t, langCode } = useI18n();
  const { cardRef, onKeyDown, onClose } = useCardKeys({
    renaming,
    onStart: onStartRename,
    onStop: onStopRename,
    onTrash,
  });
  const shownName = drawing.name || t("labels.untitled");
  const to = { kind: "drawing", id: drawing.id } as const;
  const { dragging, sourceProps } = useDragSource({
    kind: "drawing",
    id: drawing.id,
  });

  return (
    <li
      ref={cardRef}
      className={clsx("workspace-card drawing-card", {
        "workspace-card--dragging": dragging,
      })}
      onKeyDown={onKeyDown}
      {...(renaming ? {} : sourceProps)}
    >
      <div className="drawing-card__sheet">
        {thumbnail ? (
          <img src={thumbnail.src} alt="" draggable={false} />
        ) : (
          blankSheet
        )}
      </div>
      <div className="workspace-card__strip">
        <div className="workspace-card__label">
          {renaming ? (
            <InlineName
              name={drawing.name}
              label={t("workspace.drawingName")}
              untitled={t("labels.untitled")}
              className="workspace-card__name-field"
              onSave={onRename}
              onClose={onClose}
            />
          ) : (
            <RouteLink to={to} className="workspace-card__link">
              <span
                className={clsx("workspace-card__name", {
                  "workspace-card__name--untitled": !drawing.name,
                })}
                title={shownName}
              >
                {shownName}
              </span>
            </RouteLink>
          )}
          {location && (
            <span className="workspace-card__location">{location}</span>
          )}
        </div>
        <time
          className="workspace-card__time"
          dateTime={new Date(drawing.updatedAt).toISOString()}
        >
          {formatRelativeTime(drawing.updatedAt, now, langCode)}
        </time>
        <ItemMenu
          label={t("workspace.drawingActions", { name: shownName })}
          to={to}
          onRename={onStartRename}
          onDuplicate={onDuplicate}
          onMove={() => onMove(cardRef.current)}
          onTrash={() => onTrash(cardRef.current)}
        />
      </div>
    </li>
  );
};
