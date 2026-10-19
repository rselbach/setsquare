import { useEffect } from "react";

import { isDevEnv, toBrandedType } from "@setsquare/common";

import type {
  Collaborator,
  SetsquareImperativeAPI,
  SocketId,
} from "@setsquare/setsquare/types";

/**
 * Dev-only debug helper: `?collaborators=<N>` on setsquare-app populates
 * the canvas with N static fake collaborators (Greendale study group names,
 * one of them marked as the current user) so avatar/UserList UI can be
 * exercised without a collaboration backend.
 */

const DEBUG_USERNAMES = [
  "Troy Barnes",
  "Abed Nadir",
  "Annie Edison",
  "Britta Perry",
  "Jeff Winger",
  "Shirley Bennett",
  "Pierce Hawthorne",
];

const getSimulatedCollaboratorCountFromUrl = (): number | null => {
  const count = Number(
    new URLSearchParams(window.location.search).get("collaborators"),
  );
  return Number.isFinite(count) && count > 0 ? Math.floor(count) : null;
};

const generateSimulatedCollaborators = (
  count: number,
): Map<SocketId, Collaborator> => {
  const collaborators = new Map<SocketId, Collaborator>();

  for (let i = 0; i < count; i++) {
    const socketId = toBrandedType<SocketId>(`debug-collaborator-${i}`);
    collaborators.set(socketId, {
      id: socketId,
      socketId,
      username: DEBUG_USERNAMES[i % DEBUG_USERNAMES.length],
      isCurrentUser: i === 0,
    });
  }

  return collaborators;
};

export const useSimulatedCollaborators = (
  setsquareAPI: SetsquareImperativeAPI | null,
) => {
  useEffect(() => {
    if (!isDevEnv() || !setsquareAPI) {
      return;
    }

    const count = getSimulatedCollaboratorCountFromUrl();
    if (!count) {
      return;
    }

    setsquareAPI.updateScene({
      collaborators: generateSimulatedCollaborators(count),
    });
  }, [setsquareAPI]);
};
