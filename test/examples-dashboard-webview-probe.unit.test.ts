import { describe, expect, test } from "bun:test";
import type { DashboardCardsPayload } from "../src/lib/dashboard-card-registry.ts";
import {
  EXAMPLES_DASHBOARD_READY_EVAL,
  buildExamplesDashboardMetadataEval,
  diffExamplesDashboardProbe,
  type ExamplesDashboardDomMetadata,
} from "../src/lib/examples-dashboard-webview-probe.ts";
import { webViewSupported } from "../src/lib/webview-console.ts";

describe("examples-dashboard-webview-probe", () => {
  test("ready eval references window flag", () => {
    expect(EXAMPLES_DASHBOARD_READY_EVAL).toContain("__EXAMPLES_DASHBOARD_READY__");
  });

  test("metadata eval script is self-contained IIFE", () => {
    const script = buildExamplesDashboardMetadataEval();
    expect(script.startsWith("(() =>")).toBe(true);
    expect(script).toContain("card-'");
    expect(script).toContain("landing");
  });

  test("diffExamplesDashboardProbe flags api/dom status drift", () => {
    const api: DashboardCardsPayload = {
      ok: true,
      total: 2,
      cards: [
        {
          id: "card-ok",
          title: "Ok",
          apiRoute: "/api/ok",
          influencedBy: [],
          status: "ok",
        },
        {
          id: "card-bad",
          title: "Bad",
          apiRoute: "/api/bad",
          influencedBy: [],
          status: "error",
        },
      ],
      filter: {
        canvas: null,
        manifestId: null,
        canvasId: null,
        orphans: false,
        recognized: false,
      },
      fetchedAt: new Date().toISOString(),
    };

    const dom: ExamplesDashboardDomMetadata = {
      title: "kimi-toolchain Dashboard",
      url: "http://127.0.0.1:5678/",
      ready: true,
      cardCount: 2,
      loadingCards: 0,
      errorCards: 1,
      landing: {},
      cards: [
        {
          id: "card-ok",
          title: "Ok",
          liveClass: "ok",
          cardLiveStatus: "ok",
          loading: false,
          hasError: false,
          snippet: "ok",
        },
        {
          id: "card-bad",
          title: "Bad",
          liveClass: "ok",
          cardLiveStatus: "ok",
          loading: false,
          hasError: false,
          snippet: "still rendering ok border",
        },
      ],
    };

    const mismatches = diffExamplesDashboardProbe(api, dom);
    expect(mismatches).toHaveLength(1);
    expect(mismatches[0]?.id).toBe("card-bad");
    expect(mismatches[0]?.reason).toContain("API error");
  });

  test.skipIf(!webViewSupported())(
    "evaluate metadata script on data URL dashboard shell",
    async () => {
      const html = `<!doctype html><html><head><title>kimi-toolchain Dashboard</title></head><body>
<div id="landing-zone"><div class="landing-stat" data-stat="cards"><div class="value">1/2</div><div class="label">cards passing</div></div></div>
<div class="card live-error" id="card-gates"><h2>Gates</h2><span class="card-live-status">error</span><div class="status err">failed</div></div>
<script>window.__EXAMPLES_DASHBOARD_READY__=true;</script></body></html>`;
      const url = `data:text/html,${encodeURIComponent(html)}`;

      await using view = new Bun.WebView({ width: 800, height: 600 });
      await view.navigate(url);
      await Bun.sleep(100);

      const dom = (await view.evaluate(
        buildExamplesDashboardMetadataEval()
      )) as ExamplesDashboardDomMetadata;
      expect(dom.ready).toBe(true);
      expect(dom.cardCount).toBe(1);
      expect(dom.cards[0]?.id).toBe("card-gates");
      expect(dom.cards[0]?.liveClass).toBe("error");
      expect(dom.landing.cards?.value).toBe("1/2");
    }
  );
});
