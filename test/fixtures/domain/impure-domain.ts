// test/fixtures/domain/impure-domain.ts
// This file pretends to be in src/domain/ but uses effects directly.

function getEffect(name: string): unknown {
  return name;
}

export function doSomething() {
  const image = getEffect("kimi.effect.image"); // ❌ domain importing effect
  return Promise.resolve(image); // ❌ bare promise
}
