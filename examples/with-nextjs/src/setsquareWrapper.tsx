"use client";
import * as setsquareLib from "@setsquare/setsquare";
import { Setsquare } from "@setsquare/setsquare";

import "@setsquare/setsquare/index.css";

import App from "../../with-script-in-browser/components/ExampleApp";

const SetsquareWrapper: React.FC = () => {
  return (
    <>
      <App
        appTitle={"Setsquare with Nextjs Example"}
        useCustom={(api: any, args?: any[]) => {}}
        setsquareLib={setsquareLib}
      >
        <Setsquare />
      </App>
    </>
  );
};

export default SetsquareWrapper;
