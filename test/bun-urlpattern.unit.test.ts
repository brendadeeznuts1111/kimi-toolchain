/**
 * Bun URLPattern API tests.
 *
 * Validates the URLPattern Web API surface:
 * - Constructor (string and URLPatternInit)
 * - test() — boolean match check
 * - exec() — extract matched groups
 * - Pattern properties: protocol, username, password, hostname, port, pathname, search, hash
 * - hasRegExpGroups — detect custom regex in pattern
 *
 * @see https://bun.com/docs/runtime/urlpattern
 */

import { describe, expect, test } from "bun:test";

// ── Constructor ──────────────────────────────────────────────────────

describe("bun-urlpattern constructor", () => {
  test("constructs from a string pattern", () => {
    const p = new URLPattern("https://example.com/users/:id");
    expect(p).toBeInstanceOf(URLPattern);
  });

  test("constructs from URLPatternInit with pathname only", () => {
    const p = new URLPattern({ pathname: "/users/:id" });
    expect(p).toBeInstanceOf(URLPattern);
  });

  test("constructs from URLPatternInit with all parts", () => {
    const p = new URLPattern({
      protocol: "https",
      hostname: "example.com",
      port: "443",
      pathname: "/users/:id",
      search: "*",
      hash: "*",
    });
    expect(p).toBeInstanceOf(URLPattern);
  });

  test("constructs with wildcard pathname", () => {
    const p = new URLPattern({ pathname: "/files/*" });
    expect(p).toBeInstanceOf(URLPattern);
  });

  test("constructs with regex group in pathname", () => {
    const p = new URLPattern({ pathname: "/users/:id(\\d+)" });
    expect(p).toBeInstanceOf(URLPattern);
  });

  test("constructs with empty URLPatternInit (matches everything)", () => {
    const p = new URLPattern({});
    expect(p).toBeInstanceOf(URLPattern);
  });
});

// ── test() ───────────────────────────────────────────────────────────

describe("URLPattern.test()", () => {
  test("returns true for matching URL with pathname param", () => {
    const p = new URLPattern({ pathname: "/users/:id" });
    expect(p.test("https://example.com/users/123")).toBe(true);
  });

  test("returns false for non-matching pathname", () => {
    const p = new URLPattern({ pathname: "/users/:id" });
    expect(p.test("https://example.com/posts/456")).toBe(false);
  });

  test("returns true for wildcard match", () => {
    const p = new URLPattern({ pathname: "/files/*" });
    expect(p.test("https://example.com/files/image.png")).toBe(true);
  });

  test("returns false for non-matching wildcard", () => {
    const p = new URLPattern({ pathname: "/files/*" });
    expect(p.test("https://example.com/images/photo.jpg")).toBe(false);
  });

  test("returns true for matching protocol", () => {
    const p = new URLPattern({ protocol: "https" });
    expect(p.test("https://example.com")).toBe(true);
  });

  test("returns false for non-matching protocol", () => {
    const p = new URLPattern({ protocol: "https" });
    expect(p.test("http://example.com")).toBe(false);
  });

  test("returns true for matching hostname", () => {
    const p = new URLPattern({ hostname: "example.com" });
    expect(p.test("https://example.com/path")).toBe(true);
  });

  test("returns false for non-matching hostname", () => {
    const p = new URLPattern({ hostname: "example.com" });
    expect(p.test("https://other.com/path")).toBe(false);
  });

  test("returns true for matching port", () => {
    const p = new URLPattern({ port: "8080" });
    expect(p.test("https://example.com:8080/path")).toBe(true);
  });

  test("returns false for non-matching port", () => {
    const p = new URLPattern({ port: "8080" });
    expect(p.test("https://example.com:3000/path")).toBe(false);
  });

  test("returns true for matching search", () => {
    const p = new URLPattern({ search: "q=*" });
    expect(p.test("https://example.com?q=bun")).toBe(true);
  });

  test("returns true for matching hash", () => {
    const p = new URLPattern({ hash: "section-*" });
    expect(p.test("https://example.com#section-intro")).toBe(true);
  });

  test("returns true for empty pattern matching any URL", () => {
    const p = new URLPattern({});
    expect(p.test("https://example.com/anything")).toBe(true);
  });

  test("test() with string URL", () => {
    const p = new URLPattern("https://example.com/api/:version");
    expect(p.test("https://example.com/api/v1")).toBe(true);
    expect(p.test("https://example.com/api/v2")).toBe(true);
    expect(p.test("https://example.com/web/v1")).toBe(false);
  });
});

// ── exec() ───────────────────────────────────────────────────────────

describe("URLPattern.exec()", () => {
  test("extracts pathname groups for :id param", () => {
    const p = new URLPattern({ pathname: "/users/:id" });
    const result = p.exec("https://example.com/users/123");
    expect(result).not.toBeNull();
    expect(result!.pathname.groups.id).toBe("123");
  });

  test("returns null for non-matching URL", () => {
    const p = new URLPattern({ pathname: "/users/:id" });
    const result = p.exec("https://example.com/posts/456");
    expect(result).toBeNull();
  });

  test("extracts wildcard group with index 0", () => {
    const p = new URLPattern({ pathname: "/files/*" });
    const result = p.exec("https://example.com/files/image.png");
    expect(result).not.toBeNull();
    expect(result!.pathname.groups[0]).toBe("image.png");
  });

  test("extracts multiple pathname params", () => {
    const p = new URLPattern({ pathname: "/users/:userId/posts/:postId" });
    const result = p.exec("https://example.com/users/42/posts/7");
    expect(result).not.toBeNull();
    expect(result!.pathname.groups.userId).toBe("42");
    expect(result!.pathname.groups.postId).toBe("7");
  });

  test("extracts protocol group", () => {
    const p = new URLPattern({ protocol: "(\\w+)" });
    const result = p.exec("https://example.com");
    expect(result).not.toBeNull();
    expect(result!.protocol.groups[0]).toBe("https");
  });

  test("extracts hostname group", () => {
    const p = new URLPattern({ hostname: "*example.com" });
    const result = p.exec("https://api.example.com");
    expect(result).not.toBeNull();
    expect(result!.hostname.groups[0]).toBe("api.");
  });

  test("exec() with string pattern URL", () => {
    const p = new URLPattern("https://example.com/api/:version");
    const result = p.exec("https://example.com/api/v1");
    expect(result).not.toBeNull();
    expect(result!.pathname.groups.version).toBe("v1");
  });
});

// ── URLPatternResult structure ───────────────────────────────────────

describe("URLPatternResult structure", () => {
  test("result has all component properties", () => {
    const p = new URLPattern({ pathname: "/users/:id" });
    const result = p.exec("https://example.com/users/123");
    expect(result).not.toBeNull();
    expect(result).toHaveProperty("protocol");
    expect(result).toHaveProperty("username");
    expect(result).toHaveProperty("password");
    expect(result).toHaveProperty("hostname");
    expect(result).toHaveProperty("port");
    expect(result).toHaveProperty("pathname");
    expect(result).toHaveProperty("search");
    expect(result).toHaveProperty("hash");
  });

  test("each component has input and groups", () => {
    const p = new URLPattern({ pathname: "/users/:id" });
    const result = p.exec("https://example.com/users/123");
    expect(result).not.toBeNull();
    expect(result!.pathname).toHaveProperty("input");
    expect(result!.pathname).toHaveProperty("groups");
    expect(result!.protocol).toHaveProperty("input");
    expect(result!.protocol).toHaveProperty("groups");
    expect(result!.hostname).toHaveProperty("input");
    expect(result!.hostname).toHaveProperty("groups");
  });

  test("pathname.input contains the matched path", () => {
    const p = new URLPattern({ pathname: "/users/:id" });
    const result = p.exec("https://example.com/users/123");
    expect(result!.pathname.input).toBe("/users/123");
  });

  test("protocol.input contains the matched protocol", () => {
    const p = new URLPattern({ protocol: "https", pathname: "/users/:id" });
    const result = p.exec("https://example.com/users/123");
    expect(result!.protocol.input).toBe("https");
  });

  test("hostname.input contains the matched hostname", () => {
    const p = new URLPattern({ hostname: "example.com", pathname: "/users/:id" });
    const result = p.exec("https://example.com/users/123");
    expect(result!.hostname.input).toBe("example.com");
  });

  test("groups is an object with named params", () => {
    const p = new URLPattern({ pathname: "/users/:id" });
    const result = p.exec("https://example.com/users/123");
    expect(typeof result!.pathname.groups).toBe("object");
    expect(result!.pathname.groups).toHaveProperty("id");
    expect(result!.pathname.groups.id).toBe("123");
  });

  test("wildcard groups use numeric index 0", () => {
    const p = new URLPattern({ pathname: "/files/*" });
    const result = p.exec("https://example.com/files/image.png");
    expect(result!.pathname.groups[0]).toBe("image.png");
  });

  test("empty groups object when pattern has no params", () => {
    const p = new URLPattern({ pathname: "/about" });
    const result = p.exec("https://example.com/about");
    expect(result).not.toBeNull();
    expect(Object.keys(result!.pathname.groups)).toHaveLength(0);
  });

  test("full URL result with all components populated", () => {
    const p = new URLPattern({
      protocol: "https",
      hostname: "example.com",
      pathname: "/api/:version",
      search: "q=*",
      hash: "section-*",
    });
    const result = p.exec("https://example.com/api/v1?q=bun#section-intro");
    expect(result).not.toBeNull();
    expect(result!.protocol.input).toBe("https");
    expect(result!.hostname.input).toBe("example.com");
    expect(result!.pathname.input).toBe("/api/v1");
    expect(result!.pathname.groups.version).toBe("v1");
    expect(result!.search.input).toBe("q=bun");
    expect(result!.hash.input).toBe("section-intro");
  });

  test("non-default port is captured in result", () => {
    const p = new URLPattern({
      protocol: "http",
      hostname: "example.com",
      port: "8080",
      pathname: "/api",
    });
    const result = p.exec("http://example.com:8080/api");
    expect(result).not.toBeNull();
    expect(result!.port.input).toBe("8080");
  });
});

// ── Pattern properties ───────────────────────────────────────────────

describe("URLPattern properties", () => {
  test("has protocol property", () => {
    const p = new URLPattern({ protocol: "https" });
    expect(typeof p.protocol).toBe("string");
    expect(p.protocol).toContain("https");
  });

  test("has username property", () => {
    const p = new URLPattern({ username: "admin" });
    expect(typeof p.username).toBe("string");
  });

  test("has password property", () => {
    const p = new URLPattern({ password: "secret" });
    expect(typeof p.password).toBe("string");
  });

  test("has hostname property", () => {
    const p = new URLPattern({ hostname: "example.com" });
    expect(typeof p.hostname).toBe("string");
    expect(p.hostname).toContain("example.com");
  });

  test("has port property", () => {
    const p = new URLPattern({ port: "8080" });
    expect(typeof p.port).toBe("string");
  });

  test("has pathname property", () => {
    const p = new URLPattern({ pathname: "/users/:id" });
    expect(typeof p.pathname).toBe("string");
    expect(p.pathname).toContain(":id");
  });

  test("has search property", () => {
    const p = new URLPattern({ search: "q=*" });
    expect(typeof p.search).toBe("string");
  });

  test("has hash property", () => {
    const p = new URLPattern({ hash: "section-*" });
    expect(typeof p.hash).toBe("string");
  });
});

// ── hasRegExpGroups ──────────────────────────────────────────────────

describe("URLPattern.hasRegExpGroups", () => {
  test("returns false for simple param patterns", () => {
    const p = new URLPattern({ pathname: "/users/:id" });
    expect(p.hasRegExpGroups).toBe(false);
  });

  test("returns true for patterns with custom regex", () => {
    const p = new URLPattern({ pathname: "/users/:id(\\d+)" });
    expect(p.hasRegExpGroups).toBe(true);
  });

  test("returns false for wildcard patterns", () => {
    const p = new URLPattern({ pathname: "/files/*" });
    expect(p.hasRegExpGroups).toBe(false);
  });

  test("returns true for regex group in hostname", () => {
    const p = new URLPattern({ hostname: "(:sub.)?example.com" });
    expect(p.hasRegExpGroups).toBe(true);
  });

  test("returns false for plain string patterns", () => {
    const p = new URLPattern({ pathname: "/about" });
    expect(p.hasRegExpGroups).toBe(false);
  });

  test("returns true for regex protocol group", () => {
    const p = new URLPattern({ protocol: "(\\w+)" });
    expect(p.hasRegExpGroups).toBe(true);
  });
});

// ── Integration: routing scenarios ───────────────────────────────────

describe("URLPattern routing scenarios", () => {
  test("REST API routing: GET /api/users/:id", () => {
    const p = new URLPattern({ pathname: "/api/users/:id" });
    expect(p.test("https://api.example.com/api/users/42")).toBe(true);
    const result = p.exec("https://api.example.com/api/users/42");
    expect(result!.pathname.groups.id).toBe("42");
  });

  test("REST API routing: nested resources /api/users/:userId/posts/:postId", () => {
    const p = new URLPattern({ pathname: "/api/users/:userId/posts/:postId" });
    expect(p.test("https://api.example.com/api/users/1/posts/2")).toBe(true);
    const result = p.exec("https://api.example.com/api/users/1/posts/2");
    expect(result!.pathname.groups.userId).toBe("1");
    expect(result!.pathname.groups.postId).toBe("2");
  });

  test("File serving: /static/* captures full path", () => {
    const p = new URLPattern({ pathname: "/static/*" });
    expect(p.test("https://example.com/static/css/main.css")).toBe(true);
    const result = p.exec("https://example.com/static/css/main.css");
    expect(result!.pathname.groups[0]).toBe("css/main.css");
  });

  test("Multiple patterns for different routes", () => {
    const patterns = [
      new URLPattern({ pathname: "/api/users" }),
      new URLPattern({ pathname: "/api/users/:id" }),
      new URLPattern({ pathname: "/api/posts" }),
      new URLPattern({ pathname: "/api/posts/:id" }),
    ];
    const url = "https://example.com/api/users/123";
    const matched = patterns.filter((p) => p.test(url));
    expect(matched).toHaveLength(1);
  });

  test("Protocol + hostname + pathname combined matching", () => {
    const p = new URLPattern({
      protocol: "https",
      hostname: "api.example.com",
      pathname: "/v:version/:resource",
    });
    expect(p.test("https://api.example.com/v1/users")).toBe(true);
    expect(p.test("http://api.example.com/v1/users")).toBe(false);
    expect(p.test("https://other.com/v1/users")).toBe(false);
    const result = p.exec("https://api.example.com/v2/posts");
    expect(result!.pathname.groups.version).toBe("2");
    expect(result!.pathname.groups.resource).toBe("posts");
  });
});
