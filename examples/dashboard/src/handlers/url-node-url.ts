// ── URL (node:url) ─────────────────────────────────────────────────
import { jsonResponse } from "./shared.ts";

export async function apiUrlNode(): Promise<Response> {
  // We need the import at runtime to avoid static import issues
  const nodeUrl = await import("node:url");

  // IDN: domainToASCII / domainToUnicode
  const idn = [
    {
      input: "日本語.jp",
      ascii: nodeUrl.domainToASCII("日本語.jp"),
      unicode: nodeUrl.domainToUnicode("xn--wgv71a119e.jp"),
    },
    {
      input: "español.com",
      ascii: nodeUrl.domainToASCII("español.com"),
      unicode: nodeUrl.domainToUnicode("xn--espaol-zwa.com"),
    },
    {
      input: "中文.com",
      ascii: nodeUrl.domainToASCII("中文.com"),
      unicode: nodeUrl.domainToUnicode("xn--fiq228c.com"),
    },
  ];

  // fileURLToPath / pathToFileURL roundtrip
  const filePath = "/tmp/kimi-dashboard-test.txt";
  const fileUrl = nodeUrl.pathToFileURL(filePath).href;
  const backToPath = nodeUrl.fileURLToPath(fileUrl);

  // url.format
  const formatted = nodeUrl.format({
    protocol: "https",
    hostname: "bun.sh",
    port: "443",
    pathname: "/docs/runtime",
    search: "?q=bun",
  });

  // urlToHttpOptions
  const parsed = new URL("https://user@bun.sh:443/docs/runtime?q=bun");
  const httpOpts = nodeUrl.urlToHttpOptions(parsed);

  return jsonResponse({
    idn,
    fileRoundtrip: { path: filePath, url: fileUrl, backToPath },
    format: {
      input:
        "{ protocol:'https', hostname:'bun.sh', port:'443', pathname:'/docs/runtime', search:'?q=bun' }",
      result: formatted,
    },
    urlToHttpOptions: httpOpts,
    note: "node:url — domainToASCII/domainToUnicode (IDN/Punycode), fileURLToPath/pathToFileURL (roundtrip), format (build URL), urlToHttpOptions (URL→http.request options).",
  });
}
