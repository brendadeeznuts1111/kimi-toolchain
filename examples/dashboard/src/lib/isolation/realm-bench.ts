import { createRealmIsolation } from "./realm.ts";

export function benchmarkRealmEvaluate(): number {
  const start = performance.now();
  const iso = createRealmIsolation();
  void iso.evaluateScript("1 + 1");
  return performance.now() - start;
}
