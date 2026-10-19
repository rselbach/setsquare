// eslint-disable-next-line no-restricted-imports
import {
  atom,
  Provider,
  useAtom,
  useAtomValue,
  useSetAtom,
  createStore,
} from "jotai";

export const appJotaiStore = createStore();

export { atom, Provider, useAtom, useAtomValue, useSetAtom };
