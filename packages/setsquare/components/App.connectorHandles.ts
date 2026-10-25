import {
  DRAGGING_THRESHOLD,
  EVENT,
  KEYS,
  viewportCoordsToSceneCoords,
} from "@setsquare/common";
import {
  getConnectorElements,
  getConnectorHandleAt,
  getConnectorHandles,
  getNewNodePosition,
  isArrowElement,
  isBindableElement,
  isFlowchartNodeElement,
  isHollowInteriorHit,
  isNearConnectorHandles,
  type LinkDirection,
} from "@setsquare/element";
import { pointFrom, type GlobalPoint } from "@setsquare/math";

import type {
  SetsquareElement,
  SetsquareFlowchartNodeElement,
  NonDeleted,
} from "@setsquare/element/types";

import type React from "react";
import type { ConnectorHandlesRenderConfig } from "../scene/types";
import type App from "./App";

type ConnectorHandlesState =
  | { type: "hidden" }
  | { type: "shown"; render: ConnectorHandlesRenderConfig }
  | {
      type: "pressed";
      render: ConnectorHandlesRenderConfig & { active: LinkDirection };
      origin: { clientX: number; clientY: number };
      dragging: boolean;
    };

const isConnectable = (
  element: SetsquareElement | null | undefined,
): element is NonDeleted<SetsquareFlowchartNodeElement> =>
  !!element &&
  !element.isDeleted &&
  !element.locked &&
  isFlowchartNodeElement(element);

/** whether the element is an arrow bound to the shape */
const isConnectorOf = (element: SetsquareElement, shape: SetsquareElement) =>
  isArrowElement(element) &&
  (element.startBinding?.elementId === shape.id ||
    element.endBinding?.elementId === shape.id);

/**
 * The connector handles around a hovered shape, as in draw.io: clicking one
 * adds a connected copy of the shape on that side, dragging one connects the
 * shape to whatever it's dropped on, or to a copy of it where it's dropped.
 */
export class AppConnectorHandles {
  private state: ConnectorHandlesState = { type: "hidden" };

  constructor(private app: App) {}

  /** what the interactive canvas draws, or null when the handles are hidden */
  get render() {
    return this.state.type !== "hidden" && this.canShow()
      ? this.state.render
      : null;
  }

  private canShow() {
    const { state } = this.app;
    return (
      this.app.isInteractionEnabled() &&
      state.activeTool.type === "selection" &&
      !state.viewModeEnabled &&
      !state.newElement &&
      !state.multiElement &&
      !state.editingTextElement &&
      !state.selectionElement &&
      !state.isResizing &&
      !state.isRotating &&
      !state.selectedElementsAreBeingDragged &&
      !state.croppingElementId &&
      !state.selectedLinearElement?.isEditing
    );
  }

  private setState(next: ConnectorHandlesState) {
    this.state = next;
    this.app.triggerRender();
  }

  private show(
    element: NonDeleted<SetsquareFlowchartNodeElement>,
    active: LinkDirection | null,
  ) {
    if (
      this.state.type === "shown" &&
      this.state.render.elementId === element.id &&
      this.state.render.active === active
    ) {
      return;
    }
    const position =
      active &&
      getNewNodePosition(
        element,
        active,
        this.app.scene.getNonDeletedElementsMap(),
      );
    this.setState({
      type: "shown",
      render: {
        elementId: element.id,
        active,
        preview: position && {
          type: "node",
          center: pointFrom<GlobalPoint>(
            position.x + element.width / 2,
            position.y + element.height / 2,
          ),
        },
      },
    });
  }

  private hide() {
    if (this.state.type !== "hidden") {
      this.setState({ type: "hidden" });
    }
  }

  /**
   * Shows the handles of the shape under the pointer, keeping them while the
   * pointer heads for one of them.
   *
   * @returns whether the pointer is on a handle
   */
  updateHover = (
    scenePointer: { x: number; y: number },
    isOverScrollBar: boolean,
  ): boolean => {
    if (this.state.type === "pressed") {
      return true;
    }
    if (isOverScrollBar || !this.canShow()) {
      this.hide();
      return false;
    }

    const elementsMap = this.app.scene.getNonDeletedElementsMap();
    const point = pointFrom<GlobalPoint>(scenePointer.x, scenePointer.y);
    const shown =
      this.state.type === "shown"
        ? elementsMap.get(this.state.render.elementId)
        : null;
    const hitElement = this.app.getElementAtPosition(
      scenePointer.x,
      scenePointer.y,
    );
    // a hollow shape's empty inside is the weakest hit, as when selecting
    const isHollowHit =
      !!hitElement &&
      isHollowInteriorHit(
        point,
        hitElement,
        elementsMap,
        this.app.getElementHitThreshold(hitElement),
      );

    if (isConnectable(shown)) {
      // another shape under the pointer takes precedence over a handle, so
      // handles never steal clicks from shapes they overlap; the shape's own
      // connectors leave through its handles, so they don't count
      const hitTakesPrecedence =
        !!hitElement &&
        hitElement.id !== shown.id &&
        !isHollowHit &&
        !isConnectorOf(hitElement, shown);
      const handle =
        !hitTakesPrecedence &&
        getConnectorHandleAt(
          getConnectorHandles(shown, elementsMap, this.app.state.zoom),
          point,
          this.app.state.zoom,
        );
      if (handle) {
        this.show(shown, handle.direction);
        return true;
      }
    }

    const isNearShown =
      isConnectable(shown) &&
      isNearConnectorHandles(shown, elementsMap, point, this.app.state.zoom);
    // off the shape on the way to its handles, the empty inside of a box
    // around or beside it doesn't take the handles away
    const keepsShown =
      isNearShown &&
      isHollowHit &&
      !this.app.hitElement(scenePointer.x, scenePointer.y, shown);
    if (isConnectable(hitElement) && !keepsShown) {
      this.show(hitElement, null);
    } else if (isNearShown) {
      this.show(shown, null);
    } else {
      this.hide();
    }
    return false;
  };

  /** @returns whether the press landed on a handle, and is handled here */
  handlePointerDown = (event: React.PointerEvent<HTMLElement>): boolean => {
    if (
      this.state.type !== "shown" ||
      !this.state.render.active ||
      !this.canShow()
    ) {
      return false;
    }
    // hovering decided the handle; the press only has to still be on it
    const elementsMap = this.app.scene.getNonDeletedElementsMap();
    const element = elementsMap.get(this.state.render.elementId);
    const { x, y } = viewportCoordsToSceneCoords(event, this.app.state);
    if (
      !element ||
      getConnectorHandleAt(
        getConnectorHandles(element, elementsMap, this.app.state.zoom),
        pointFrom<GlobalPoint>(x, y),
        this.app.state.zoom,
      )?.direction !== this.state.render.active
    ) {
      return false;
    }

    this.state = {
      type: "pressed",
      render: { ...this.state.render, active: this.state.render.active },
      origin: { clientX: event.clientX, clientY: event.clientY },
      dragging: false,
    };
    this.app.ownerWindow.addEventListener(
      EVENT.POINTER_MOVE,
      this.onPointerMove,
    );
    this.app.ownerWindow.addEventListener(EVENT.POINTER_UP, this.onPointerUp);
    this.app.ownerWindow.addEventListener(EVENT.KEYDOWN, this.onKeyDown);
    return true;
  };

  private endPress() {
    this.app.ownerWindow.removeEventListener(
      EVENT.POINTER_MOVE,
      this.onPointerMove,
    );
    this.app.ownerWindow.removeEventListener(
      EVENT.POINTER_UP,
      this.onPointerUp,
    );
    this.app.ownerWindow.removeEventListener(EVENT.KEYDOWN, this.onKeyDown);
  }

  private getSource() {
    if (this.state.type !== "pressed") {
      return null;
    }
    const source = this.app.scene
      .getNonDeletedElementsMap()
      .get(this.state.render.elementId);
    return isConnectable(source) ? source : null;
  }

  /** where a drop at the point lands: on another shape, or a copy there */
  private getDropPreview(
    source: NonDeleted<SetsquareFlowchartNodeElement>,
    point: GlobalPoint,
  ): ConnectorHandlesRenderConfig["preview"] {
    const hitElement = this.app.getElementAtPosition(point[0], point[1]);
    if (hitElement?.id === source.id) {
      return null;
    }
    if (hitElement && isBindableElement(hitElement) && !hitElement.locked) {
      return { type: "target", elementId: hitElement.id };
    }
    return { type: "node", center: point };
  }

  private onPointerMove = (event: PointerEvent) => {
    const source = this.getSource();
    if (this.state.type !== "pressed" || !source) {
      return;
    }
    const { origin } = this.state;
    if (
      !this.state.dragging &&
      Math.hypot(
        event.clientX - origin.clientX,
        event.clientY - origin.clientY,
      ) < DRAGGING_THRESHOLD
    ) {
      return;
    }

    const { x, y } = viewportCoordsToSceneCoords(event, this.app.state);
    this.setState({
      ...this.state,
      dragging: true,
      render: {
        ...this.state.render,
        preview: this.getDropPreview(source, pointFrom<GlobalPoint>(x, y)),
      },
    });
  };

  private onPointerUp = () => {
    const source = this.getSource();
    const pressed = this.state;
    this.endPress();
    this.setState({ type: "hidden" });
    if (pressed.type !== "pressed" || !source) {
      return;
    }

    const { active, preview } = pressed.render;
    if (!pressed.dragging) {
      this.app.flowchart.addConnectedNode(source, active);
      return;
    }
    if (!preview) {
      return;
    }

    let end: Parameters<typeof getConnectorElements>[2];
    if (preview.type === "node") {
      end = { at: preview.center };
    } else {
      const target = this.app.scene
        .getNonDeletedElementsMap()
        .get(preview.elementId);
      if (!target || !isBindableElement(target)) {
        return;
      }
      end = { target };
    }
    this.app.flowchart.insertConnection(
      getConnectorElements(source, active, end, this.app.state, this.app.scene),
    );
  };

  private onKeyDown = (event: KeyboardEvent) => {
    if (event.key === KEYS.ESCAPE && this.state.type === "pressed") {
      event.preventDefault();
      this.endPress();
      this.setState({ type: "hidden" });
    }
  };
}
