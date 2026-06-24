import { benchSync } from "../lib/timing.ts";
import {
  getChromeRssMB,
  getAppRssGroups,
  clearProcessCache as clearMemCache,
} from "../../src/lib/memory-budget.ts";

export function runRssBenchmarks() {
  return [
    {
      label: "getChromeRssMB (cold)",
      sample: benchSync(() => {
        clearMemCache();
        getChromeRssMB();
      }, 50),
    },
    {
      label: "getAppRssGroups (cold)",
      sample: benchSync(() => {
        clearMemCache();
        getAppRssGroups();
      }, 50),
    },
    {
      label: "getAppRssGroups+cachedRss",
      sample: benchSync(() => {
        getAppRssGroups();
        getChromeRssMB();
      }, 50),
    },
  ];
}
