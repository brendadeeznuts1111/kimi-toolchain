/**
 * Fixture: configurable Web globals can be deleted from globalThis.
 * Spawned by bun-web-globals-contract tests; prints --pass-- on success.
 */

const GLOBALS = [
  "Blob",
  "TextDecoder",
  "TextEncoder",
  "Request",
  "Response",
  "Headers",
  "File",
  "Buffer",
] as const;

for (const name of GLOBALS) {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, name);
  if (!descriptor?.configurable) {
    console.error(`${name} is not configurable`);
    process.exit(1);
  }
  Reflect.deleteProperty(globalThis, name);
  if (name in globalThis) {
    console.error(`${name} still present after delete`);
    process.exit(1);
  }
}

console.log("--pass--");
