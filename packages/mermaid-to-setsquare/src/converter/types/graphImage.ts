import { nanoid } from "nanoid";

import type { FileId } from "@setsquare/element/types";

import type { SetsquareElementSkeleton } from "@setsquare/element/transform";
import type { BinaryFiles } from "@setsquare/setsquare/types";

import { GraphConverter } from "../GraphConverter.js";

import type { GraphImage } from "../../interfaces.js";

export const GraphImageConverter = new GraphConverter<GraphImage>({
  converter: (graph) => {
    const imageId = nanoid() as FileId;

    const { width, height } = graph;
    const imageElement: SetsquareElementSkeleton = {
      type: "image",
      x: 0,
      y: 0,
      width,
      height,
      status: "saved",
      fileId: imageId,
    };
    const files = {
      [imageId]: {
        id: imageId,
        mimeType: graph.mimeType,
        dataURL: graph.dataURL,
      },
    } as BinaryFiles;
    return { files, elements: [imageElement] };
  },
});
