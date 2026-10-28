import { CaptureUpdateAction, useSetsquareAPI } from "@setsquare/setsquare";
import { openConfirmModal } from "@setsquare/setsquare/components/OverwriteConfirm/OverwriteConfirmState";
import Trans from "@setsquare/setsquare/components/Trans";
import { APP_NAME, EVENT } from "@setsquare/common";
import { useEffect } from "react";
import { loadFromBlob } from "@setsquare/setsquare/data/blob";
import { t } from "@setsquare/setsquare/i18n";
import {
  restoreAppState,
  restoreElements,
} from "@setsquare/setsquare/data/restore";

const shareableLinkConfirmDialog = {
  title: t("overwriteConfirm.modal.shareableLink.title"),
  description: (
    <Trans
      i18nKey="overwriteConfirm.modal.shareableLink.description"
      bold={(text) => <strong>{text}</strong>}
      br={() => <br />}
    />
  ),
  actionLabel: t("overwriteConfirm.modal.shareableLink.button"),
  color: "danger",
} as const;

/** The scene URL in the page's `#url=` hash, if it has one. */
export const getSceneUrl = () => window.location.hash.match(/^#url=(.*)$/)?.[1];

/**
 * Fetches the scene a `#url=` link points to. Resolves to null when the user
 * keeps the current scene.
 */
export const loadSceneFromUrl = async (url: string, hasElements: boolean) => {
  window.history.replaceState({}, APP_NAME, window.location.origin);

  const request = await fetch(window.decodeURIComponent(url));
  const data = await loadFromBlob(await request.blob(), null, null);
  if (!hasElements || (await openConfirmModal(shareableLinkConfirmDialog))) {
    return data;
  }
  return null;
};

/** Replaces the open scene with that of a `#url=` link opened later. */
export const useSceneUrlLinks = () => {
  const setsquareAPI = useSetsquareAPI();

  useEffect(() => {
    if (!setsquareAPI) {
      return;
    }

    // only `#url=` links load a scene; any other hash, such as a link to an
    // anchor, leaves the open scene alone
    const onHashChange = async (event: HashChangeEvent) => {
      event.preventDefault();
      const url = getSceneUrl();
      if (!url) {
        return;
      }
      setsquareAPI.updateScene({ appState: { isLoading: true } });

      try {
        const scene = await loadSceneFromUrl(
          url,
          setsquareAPI.getSceneElements().length > 0,
        );
        if (!scene) {
          setsquareAPI.updateScene({ appState: { isLoading: false } });
          return;
        }
        setsquareAPI.addFiles(Object.values(scene.files));
        setsquareAPI.updateScene({
          elements: restoreElements(scene.elements, null, {
            repairBindings: true,
          }),
          appState: restoreAppState(scene.appState, null),
          captureUpdate: CaptureUpdateAction.IMMEDIATELY,
        });
      } catch (error: any) {
        setsquareAPI.updateScene({
          appState: {
            isLoading: false,
            errorMessage: t("alerts.invalidSceneUrl"),
          },
        });
      }
    };

    window.addEventListener(EVENT.HASHCHANGE, onHashChange, false);
    return () => {
      window.removeEventListener(EVENT.HASHCHANGE, onHashChange, false);
    };
  }, [setsquareAPI]);
};
