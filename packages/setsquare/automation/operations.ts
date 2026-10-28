import { cloneJSON, DEFAULT_ZOOM, randomId } from "@setsquare/common";
import {
  bindBindingElement,
  convertToSetsquareElements,
  fixBindingsAfterDeletion,
  getBoundTextElement,
  getContainerElement,
  getColorTargetElement,
  getColorUpdate,
  isArrowElement,
  isBindableElement,
  isFrameLikeElement,
  isNonDeletedElement,
  isStickyNoteElement,
  isTextElement,
  newArrowElement,
  newTextElement,
  redrawTextBoundingBox,
  Scene,
  syncStickyNoteInk,
  updateBoundElements,
  updateStickyNoteLayout,
} from "@setsquare/element";
import { pointFrom } from "@setsquare/math";

import type {
  NonDeletedSetsquareElement,
  SetsquareElement,
} from "@setsquare/element/types";

import type { Operation } from "./schema";

const requireElement = (scene: Scene, id: string) => {
  const element = scene.getNonDeletedElementsMap().get(id);
  if (!element) {
    throw new Error(`Element not found: ${id}`);
  }
  if (element.locked) {
    throw new Error(`Element is locked: ${id}`);
  }
  return element;
};

const setLabel = (
  scene: Scene,
  element: NonDeletedSetsquareElement,
  text: string,
) => {
  let label = isTextElement(element)
    ? element
    : getBoundTextElement(element, scene.getNonDeletedElementsMap());
  const container = isTextElement(element)
    ? getContainerElement(element, scene.getNonDeletedElementsMap())
    : element;
  if (container?.locked || label?.locked) {
    throw new Error(`Label or container is locked: ${element.id}`);
  }
  if (!label) {
    if (
      !["rectangle", "ellipse", "diamond", "stickynote", "arrow"].includes(
        element.type,
      )
    ) {
      throw new Error(`Labels are not supported for ${element.type}`);
    }
    label = newTextElement({
      x: element.x,
      y: element.y,
      text,
      containerId: element.id,
      textAlign: "center",
      verticalAlign: "middle",
      strokeColor: element.strokeColor,
      labelPosition: isArrowElement(element) ? 0.5 : null,
    });
    scene.mutateElement(element, {
      boundElements: [
        ...(element.boundElements ?? []),
        { id: label.id, type: "text" },
      ],
    });
    scene.replaceAllElements([...scene.getElementsIncludingDeleted(), label]);
  }
  scene.mutateElement(label, { text, originalText: text });
  redrawTextBoundingBox(label, container, scene);
  if (container && isNonDeletedElement(container)) {
    updateBoundElements(container, scene);
  }
};

/** Builds an isolated scene; failed batches never mutate the live document. */
export const applyOperations = (
  elements: readonly SetsquareElement[],
  operations: readonly Operation[],
) => {
  const scene = new Scene(cloneJSON(elements));
  const createdIds: string[] = [];
  const add = (created: SetsquareElement[]) => {
    for (const element of created) {
      if (scene.getElementsMapIncludingDeleted().has(element.id)) {
        throw new Error(`Element ID already exists: ${element.id}`);
      }
      createdIds.push(element.id);
    }
    scene.replaceAllElements([
      ...scene.getElementsIncludingDeleted(),
      ...created,
    ]);
  };

  for (const operation of operations) {
    switch (operation.kind) {
      case "create": {
        const properties = {
          id: operation.id ?? randomId(),
          x: operation.x,
          y: operation.y,
          width: operation.width,
          height: operation.height,
          label:
            operation.label === undefined
              ? undefined
              : { text: operation.label },
          ...operation.style,
        };
        add(
          convertToSetsquareElements(
            [
              operation.type === "stickynote"
                ? { ...properties, type: "stickynote" }
                : { ...properties, type: operation.type },
            ],
            { regenerateIds: false },
          ),
        );
        break;
      }
      case "text":
        add(
          convertToSetsquareElements(
            [
              {
                id: operation.id ?? randomId(),
                type: "text",
                x: operation.x,
                y: operation.y,
                text: operation.text,
                fontSize: operation.fontSize,
              },
            ],
            { regenerateIds: false },
          ),
        );
        break;
      case "connect": {
        const from = requireElement(scene, operation.fromId);
        const to = requireElement(scene, operation.toId);
        if (
          !isBindableElement(from) ||
          !isBindableElement(to) ||
          from.id === to.id
        ) {
          throw new Error("Connections require two different bindable shapes");
        }
        const x = from.x + from.width / 2;
        const y = from.y + from.height / 2;
        const arrow = {
          ...newArrowElement({
            type: "arrow",
            x,
            y,
            points: [
              pointFrom(0, 0),
              pointFrom(to.x + to.width / 2 - x, to.y + to.height / 2 - y),
            ],
            endArrowhead: "arrow",
          }),
          id: operation.id ?? randomId(),
        };
        add([arrow]);
        bindBindingElement(arrow, from, "orbit", "start", scene, DEFAULT_ZOOM);
        bindBindingElement(arrow, to, "orbit", "end", scene, DEFAULT_ZOOM);
        updateBoundElements(from, scene);
        updateBoundElements(to, scene);
        if (operation.label !== undefined) {
          setLabel(scene, arrow, operation.label);
        }
        break;
      }
      case "move": {
        const element = requireElement(scene, operation.id);
        if (
          isFrameLikeElement(element) ||
          (isTextElement(element) && element.containerId) ||
          (isArrowElement(element) &&
            (element.startBinding || element.endBinding))
        ) {
          throw new Error(
            "Move the owning shape instead of a bound label, bound arrow, or frame",
          );
        }
        scene.mutateElement(element, { x: operation.x, y: operation.y });
        const label = getBoundTextElement(
          element,
          scene.getNonDeletedElementsMap(),
        );
        if (label) {
          redrawTextBoundingBox(label, element, scene);
        }
        updateBoundElements(element, scene);
        break;
      }
      case "resize": {
        const element = requireElement(scene, operation.id);
        if (
          !["rectangle", "ellipse", "diamond", "stickynote"].includes(
            element.type,
          )
        ) {
          throw new Error(
            "Resize supports rectangles, ellipses, diamonds, and sticky notes",
          );
        }
        scene.mutateElement(element, {
          width: operation.width,
          height: operation.height,
        });
        if (isStickyNoteElement(element)) {
          updateStickyNoteLayout(element, scene, {
            baseHeight: operation.height,
          });
          break;
        }
        const label = getBoundTextElement(
          element,
          scene.getNonDeletedElementsMap(),
        );
        if (label) {
          redrawTextBoundingBox(label, element, scene);
        }
        updateBoundElements(element, scene);
        break;
      }
      case "set_label":
        setLabel(scene, requireElement(scene, operation.id), operation.text);
        break;
      case "style": {
        const element = requireElement(scene, operation.id);
        const previous = new Map(
          [...scene.getElementsMapIncludingDeleted()].map(([id, value]) => [
            id,
            { ...value },
          ]),
        );
        const { strokeColor, backgroundColor, ...rest } = operation.style;
        scene.mutateElement(element, rest);
        for (const [property, color] of [
          ["strokeColor", strokeColor],
          ["backgroundColor", backgroundColor],
        ] as const) {
          if (color === undefined) {
            continue;
          }
          const map = scene.getNonDeletedElementsMap();
          const target = requireElement(
            scene,
            getColorTargetElement(element, property, map).id,
          );
          scene.mutateElement(
            target,
            getColorUpdate(target, property, color, map),
          );
        }
        scene.replaceAllElements(
          syncStickyNoteInk(scene.getElementsIncludingDeleted(), previous),
        );
        break;
      }
      case "delete": {
        const element = requireElement(scene, operation.id);
        const deleted = [element];
        const label = getBoundTextElement(
          element,
          scene.getNonDeletedElementsMap(),
        );
        if (label) {
          deleted.push(requireElement(scene, label.id));
        }
        if (
          isFrameLikeElement(element) &&
          scene
            .getNonDeletedElements()
            .some((child) => child.frameId === element.id)
        ) {
          throw new Error(
            "Delete frame contents individually before deleting the frame",
          );
        }
        for (const item of deleted) {
          scene.mutateElement<SetsquareElement>(item, { isDeleted: true });
        }
        fixBindingsAfterDeletion(scene.getElementsIncludingDeleted(), deleted);
        scene.replaceAllElements(scene.getElementsIncludingDeleted());
        break;
      }
    }
  }
  return { elements: scene.getElementsIncludingDeleted(), createdIds };
};
