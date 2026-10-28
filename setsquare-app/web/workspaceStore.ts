import { LocalWorkspaceStore } from "../workspace/local/LocalWorkspaceStore";

/**
 * Opens the workspace the web app shows. Tests replace this module to give
 * each test a workspace of its own.
 */
export const openWorkspaceStore = () => LocalWorkspaceStore.open();
