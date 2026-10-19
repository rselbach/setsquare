import { isArrowKey, KEYS } from "@setsquare/common";

import {
  makeNextSelectedElementIds,
  CaptureUpdateAction,
  FlowChartCreator,
  FlowChartNavigator,
  getSelectedElements,
  isFlowchartNodeElement,
  type LinkDirection,
} from "@setsquare/element";

import type {
  SetsquareElement,
  SetsquareFlowchartNodeElement,
  NonDeleted,
  NonDeletedSetsquareElement,
} from "@setsquare/element/types";

import type React from "react";
import type App from "./App";
import type { PendingSetsquareElements } from "../types";

type FlowchartOperation =
  | { type: "none" }
  | { type: "canceled" }
  | { type: "creating"; pending: PendingSetsquareElements }
  | { type: "navigating"; nodeId: SetsquareElement["id"] | null }
  | { type: "committed"; nodes: PendingSetsquareElements }
  | { type: "navigationEnded" };

/**
 * Captures the App state management for the flowchart functionality.
 */
export class AppFlowchart {
  private creator = new FlowChartCreator();
  private navigator = new FlowChartNavigator();

  constructor(private app: App) {}

  get pendingNodes() {
    return this.creator.pendingNodes;
  }

  get isCreatingChart() {
    return this.creator.isCreatingChart;
  }

  /** ends any in-progress flowchart creation/navigation session */
  clear = () => {
    this.creator.clear();
    this.navigator.clear();
  };

  handleKeyEvent = (event: React.KeyboardEvent | KeyboardEvent): boolean => {
    const operation = this.resolveKeyboardEventToOperation(event);

    switch (operation.type) {
      case "none":
        return false;
      case "canceled":
        this.app.triggerRender(true);
        return true;
      case "creating":
        event.preventDefault();
        if (operation.pending.length) {
          this.app.revealIfHidden(operation.pending);
        }
        return true;
      case "navigating": {
        event.preventDefault();
        const node =
          operation.nodeId &&
          this.app.scene.getNonDeletedElementsMap().get(operation.nodeId);
        if (node) {
          this.selectAndReveal(node);
        }
        return true;
      }
      case "committed": {
        this.insertConnection(operation.nodes);
        return true;
      }
      case "navigationEnded":
        this.captureUpdate();
        return true;
    }
  };

  private resolveKeyboardEventToOperation(
    event: React.KeyboardEvent | KeyboardEvent,
  ): FlowchartOperation {
    const { creator, navigator, app } = this;

    if (event.type === "keydown") {
      if (event.key === KEYS.ESCAPE && creator.isCreatingChart) {
        creator.clear();
        return { type: "canceled" };
      }

      if (!isArrowKey(event.key)) {
        return { type: "none" };
      }

      if (event[KEYS.CTRL_OR_CMD] && !event.shiftKey) {
        const selectedElements = getSelectedElements(
          app.scene.getNonDeletedElementsMap(),
          app.state,
        );

        if (
          selectedElements.length === 1 &&
          isFlowchartNodeElement(selectedElements[0])
        ) {
          creator.createNodes(
            selectedElements[0],
            app.state,
            AppFlowchart.getLinkDirectionFromKey(event.key),
            app.scene,
          );
        }

        return { type: "creating", pending: creator.pendingNodes ?? [] };
      }

      if (event.altKey) {
        const elementsMap = app.scene.getNonDeletedElementsMap();
        const selectedElements = getSelectedElements(elementsMap, app.state);

        if (selectedElements.length === 1) {
          return {
            type: "navigating",
            nodeId: navigator.exploreByDirection(
              selectedElements[0],
              elementsMap,
              AppFlowchart.getLinkDirectionFromKey(event.key),
            ),
          };
        }
      }

      return { type: "none" };
    }

    // keyup: releasing a modifier finalizes the workflow it was driving;
    // both can finalize on the same event
    const navigationEnded = !event.altKey && navigator.isExploring;
    if (navigationEnded) {
      navigator.clear();
    }

    if (!event[KEYS.CTRL_OR_CMD] && creator.isCreatingChart) {
      const nodes = creator.pendingNodes ?? [];
      creator.clear();
      return { type: "committed", nodes };
    }

    return navigationEnded ? { type: "navigationEnded" } : { type: "none" };
  }

  /** Adds a copy of `node` `direction` of it, connected to it, as Cmd+arrow does. */
  addConnectedNode = (
    node: NonDeleted<SetsquareFlowchartNodeElement>,
    direction: LinkDirection,
  ) => {
    const creator = new FlowChartCreator();
    creator.createNodes(node, this.app.state, direction, this.app.scene);
    this.insertConnection(creator.pendingNodes ?? []);
  };

  /** Adds connected elements in one undo step, selecting the first. */
  insertConnection = (elements: readonly NonDeletedSetsquareElement[]) => {
    if (elements.length) {
      this.app.insertNewElements(elements);
      this.selectAndReveal(elements[0]);
    }
    this.captureUpdate();
  };

  private selectAndReveal(node: NonDeletedSetsquareElement) {
    this.app.setState((prevState) => ({
      selectedElementIds: makeNextSelectedElementIds(
        { [node.id]: true },
        prevState,
      ),
    }));
    this.app.revealIfHidden([node]);
  }

  private captureUpdate() {
    this.app.syncActionResult({
      captureUpdate: CaptureUpdateAction.IMMEDIATELY,
    });
  }

  private static getLinkDirectionFromKey(key: string): LinkDirection {
    switch (key) {
      case KEYS.ARROW_UP:
        return "up";
      case KEYS.ARROW_DOWN:
        return "down";
      case KEYS.ARROW_RIGHT:
        return "right";
      case KEYS.ARROW_LEFT:
        return "left";
      default:
        return "right";
    }
  }
}
