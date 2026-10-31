import type { BinaryFileData } from "@setsquare/setsquare/types";

import { canonical } from "./canonical";
import { ApiError } from "./errors";

import type { DrawingContent } from "../../setsquare-app/workspace/types";

const MAX_FILE_BYTES = 5 * 1024 * 1024;

const imageMatches = (bytes: Buffer, mime: string) => {
  switch (mime) {
    case "image/png":
      return bytes
        .subarray(0, 8)
        .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    case "image/jpeg":
    case "image/jfif":
      return bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
    case "image/gif":
      return ["GIF87a", "GIF89a"].includes(
        bytes.subarray(0, 6).toString("ascii"),
      );
    case "image/webp":
      return (
        bytes.subarray(0, 4).toString("ascii") === "RIFF" &&
        bytes.subarray(8, 12).toString("ascii") === "WEBP"
      );
    case "image/bmp":
      return bytes.subarray(0, 2).toString("ascii") === "BM";
    case "image/x-icon":
      return bytes.subarray(0, 4).equals(Buffer.from([0, 0, 1, 0]));
    case "image/avif":
      return (
        bytes.subarray(4, 8).toString("ascii") === "ftyp" &&
        /avif|avis/.test(bytes.subarray(8, 32).toString("ascii"))
      );
    case "image/svg+xml": {
      const text = bytes
        .toString("utf8")
        .replace(/^\uFEFF/, "")
        .replace(/<!DOCTYPE\s+svg\s+[^>\u005B]*>/i, "");
      return (
        /^\s*(?:<\?xml[^>]*>\s*)?(?:<!--[\s\S]*?-->\s*)*<svg\b/i.test(text) &&
        !/<!DOCTYPE|<!ENTITY|<script\b/i.test(text)
      );
    }
    default:
      return false;
  }
};

/** Decodes an uploaded image, refusing bytes that don't match its media type. */
export const imageBytes = (file: BinaryFileData) => {
  const match = /^data:([^;]+);base64,(.*)$/.exec(file.dataURL);
  if (!match || match[1] !== file.mimeType) {
    throw new ApiError(
      400,
      "invalid_image",
      "Image content does not match its media type",
    );
  }
  const bytes = Buffer.from(match[2], "base64");
  if (
    !bytes.length ||
    bytes.length > MAX_FILE_BYTES ||
    bytes.toString("base64") !== match[2] ||
    !imageMatches(bytes, file.mimeType)
  ) {
    throw new ApiError(
      400,
      "invalid_image",
      "Upload a supported image no larger than 5 MiB",
    );
  }
  return bytes;
};

/** Lists the image file ids a drawing references, once each, in element order. */
export const imageFileIds = (content: DrawingContent) => [
  ...new Set(
    content.elements.flatMap((element) =>
      element.type === "image" && element.fileId ? [element.fileId] : [],
    ),
  ),
];

/** Requires a drawing's declared image ids to be exactly the images it shows. */
export const checkFiles = (
  content: DrawingContent,
  declared: readonly string[],
) => {
  const ids = imageFileIds(content).sort();
  if (canonical(ids) !== canonical([...new Set(declared)].sort())) {
    throw new ApiError(
      400,
      "invalid_files",
      "Image references must match the drawing",
    );
  }
  return ids;
};
