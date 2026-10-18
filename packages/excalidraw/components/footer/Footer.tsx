import { useTunnels } from "../../context/tunnels";
import { ExitZenModeButton } from "../Actions";
import { useApp } from "../App";

import { TitleBlock } from "./TitleBlock";

import type { ActionManager } from "../../actions/manager";
import type { UIAppState } from "../../types";

const Footer = ({
  appState,
  actionManager,
  showExitZenModeBtn,
  renderWelcomeScreen,
  defaultUIEnabled,
  zoomUIEnabled,
}: {
  appState: UIAppState;
  actionManager: ActionManager;
  showExitZenModeBtn: boolean;
  renderWelcomeScreen: boolean;
  defaultUIEnabled: boolean;
  zoomUIEnabled: boolean;
}) => {
  const { FooterCenterTunnel, WelcomeScreenHelpHintTunnel } = useTunnels();
  const app = useApp();

  return (
    <footer
      role="contentinfo"
      className="layer-ui__wrapper__footer App-menu App-menu_bottom"
    >
      <FooterCenterTunnel.Out />
      {/* not faded out in zen mode: the zoom controls stay visible
          (chrome-less); the title block's other cells opt out individually */}
      {(defaultUIEnabled ||
        renderWelcomeScreen ||
        (zoomUIEnabled && app.isNavigationEnabled())) && (
        <div className="layer-ui__wrapper__footer-right">
          <div style={{ position: "relative" }}>
            {renderWelcomeScreen && <WelcomeScreenHelpHintTunnel.Out />}
            <TitleBlock
              appState={appState}
              actionManager={actionManager}
              showName={defaultUIEnabled}
              showZoom={zoomUIEnabled && app.isNavigationEnabled()}
              showHelp={defaultUIEnabled}
            />
          </div>
        </div>
      )}
      {defaultUIEnabled && (
        <ExitZenModeButton
          actionManager={actionManager}
          showExitZenModeBtn={showExitZenModeBtn}
        />
      )}
    </footer>
  );
};

export default Footer;
Footer.displayName = "Footer";
