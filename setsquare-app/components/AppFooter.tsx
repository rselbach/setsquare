import { Footer } from "@setsquare/setsquare/index";
import React from "react";

import { DebugFooter, isVisualDebuggerEnabled } from "./DebugCanvas";

export const AppFooter = React.memo(
  ({ onChange }: { onChange: () => void }) => {
    // an empty footer would take the row's space from the host's footer
    if (!isVisualDebuggerEnabled()) {
      return null;
    }
    return (
      <Footer>
        <div
          style={{
            display: "flex",
            gap: ".5rem",
            alignItems: "center",
          }}
        >
          <DebugFooter onChange={onChange} />
        </div>
      </Footer>
    );
  },
);
