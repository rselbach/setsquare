import type { ImportedDataState } from "@setsquare/setsquare/data/types";
import type {
  SetsquareRectangleElement,
  SetsquareDiamondElement,
  SetsquareEllipseElement,
} from "@setsquare/element/types";
import type { Mutable } from "@setsquare/common/utility-types";

export type ArrayElement<A> = A extends readonly (infer T)[] ? T : never;

export type SetsquareElement = Mutable<
  ArrayElement<ImportedDataState["elements"]>
>;

export type SetsquareVertexElement =
  | SetsquareRectangleElement
  | SetsquareDiamondElement
  | SetsquareEllipseElement;
