import React from "react";

import type * as TSetsquare from "@setsquare/setsquare";
import type { SetsquareImperativeAPI } from "@setsquare/setsquare/types";

import CustomFooter from "./CustomFooter";

const MobileFooter = ({
  setsquareAPI,
  setsquareLib,
}: {
  setsquareAPI: SetsquareImperativeAPI;
  setsquareLib: typeof TSetsquare;
}) => {
  const { useEditorInterface, Footer } = setsquareLib;

  const editorInterface = useEditorInterface();
  if (editorInterface.formFactor === "phone") {
    return (
      <Footer>
        <CustomFooter setsquareAPI={setsquareAPI} setsquareLib={setsquareLib} />
      </Footer>
    );
  }
  return null;
};
export default MobileFooter;
