import { isTauri } from "@tauri-apps/api/core";
import Trans from "@setsquare/setsquare/components/Trans";
import {
  EditorJotaiProvider,
  editorJotaiStore,
} from "@setsquare/setsquare/editor-jotai";
import { t } from "@setsquare/setsquare/i18n";
import React from "react";

interface TopErrorBoundaryState {
  hasError: boolean;
  localStorage: string;
}

export class TopErrorBoundary extends React.Component<
  any,
  TopErrorBoundaryState
> {
  state: TopErrorBoundaryState = {
    hasError: false,
    localStorage: "",
  };

  render() {
    return this.state.hasError ? (
      // the editor's store, which Trans reads the language from, may never
      // have been provided, or have gone with the editor
      <EditorJotaiProvider store={editorJotaiStore}>
        {this.errorSplash()}
      </EditorJotaiProvider>
    ) : (
      this.props.children
    );
  }

  componentDidCatch() {
    const _localStorage: any = {};
    for (const [key, value] of Object.entries({ ...localStorage })) {
      try {
        _localStorage[key] = JSON.parse(value);
      } catch (error: any) {
        _localStorage[key] = value;
      }
    }

    this.setState({
      hasError: true,
      localStorage: JSON.stringify(_localStorage),
    });
  }

  private selectTextArea(event: React.MouseEvent<HTMLTextAreaElement>) {
    if (event.target !== document.activeElement) {
      event.preventDefault();
      (event.target as HTMLTextAreaElement).select();
    }
  }

  private errorSplash() {
    return (
      <div className="ErrorSplash setsquare">
        <div className="ErrorSplash-messageContainer">
          <div className="ErrorSplash-paragraph bigger align-center">
            <Trans
              i18nKey="errorSplash.headingMain"
              button={(el) => (
                <button onClick={() => window.location.reload()}>{el}</button>
              )}
            />
          </div>
          <div className="ErrorSplash-paragraph align-center">
            {isTauri() ? (
              <>
                <Trans
                  i18nKey="errorSplash.clearCanvasMessage"
                  button={(el) => (
                    <button
                      onClick={() => {
                        try {
                          localStorage.clear();
                          window.location.reload();
                        } catch (error: any) {
                          console.error(error);
                        }
                      }}
                    >
                      {el}
                    </button>
                  )}
                />
                <br />
                <div className="smaller">
                  <span role="img" aria-label="warning">
                    ⚠️
                  </span>
                  {t("errorSplash.clearCanvasCaveat")}
                  <span role="img" aria-hidden="true">
                    ⚠️
                  </span>
                </div>
              </>
            ) : (
              // a fresh page load, so nothing of the broken state is left
              <Trans
                i18nKey="errorSplash.backToDrawingsMessage"
                button={(el) => (
                  <button onClick={() => window.location.assign("/")}>
                    {el}
                  </button>
                )}
              />
            )}
          </div>
          <div>
            <div className="ErrorSplash-paragraph">
              <div className="ErrorSplash-details">
                <label>{t("errorSplash.sceneContent")}</label>
                <textarea
                  rows={5}
                  onPointerDown={this.selectTextArea}
                  readOnly={true}
                  value={this.state.localStorage}
                />
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }
}
