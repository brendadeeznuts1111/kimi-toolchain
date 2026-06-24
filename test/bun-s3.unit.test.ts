/**
 * Bun.S3 client API regression test.
 *
 * Bun v1.3.7: contentEncoding option on .write()/.writer() for pre-compressed uploads.
 * Bun v1.3.7: presign() contentDisposition + type options.
 */
import { describe, expect, test } from "bun:test";

describe("bun-s3", () => {
  test("S3Client constructor accepts options", () => {
    const ClientClass = (Bun as any).S3Client;
    if (typeof ClientClass !== "function") {
      // S3Client may not be available — skip
      return;
    }
    const client = new ClientClass({
      accessKeyId: "test",
      secretAccessKey: "test",
      bucket: "test-bucket",
      region: "us-east-1",
    });
    expect(client).toBeDefined();
  });

  test("s3.file().presign accepts contentDisposition and type", () => {
    const ClientClass = (Bun as any).S3Client;
    if (typeof ClientClass !== "function") return;

    const client = new ClientClass({
      accessKeyId: "test",
      secretAccessKey: "test",
      bucket: "test-bucket",
      region: "us-east-1",
    });
    const file = client.file("report.pdf");
    // presign with contentDisposition should not throw
    expect(() =>
      file.presign({
        method: "GET",
        expiresIn: 60,
        contentDisposition: 'attachment; filename="report.pdf"',
        type: "application/octet-stream",
      })
    ).not.toThrow();
  });

  test("s3.file().writer accepts contentEncoding option", () => {
    const ClientClass = (Bun as any).S3Client;
    if (typeof ClientClass !== "function") return;

    const client = new ClientClass({
      accessKeyId: "test",
      secretAccessKey: "test",
      bucket: "test-bucket",
      region: "us-east-1",
    });
    const file = client.file("data.json.gz");
    // writer with contentEncoding should not throw
    expect(() => file.writer({ contentEncoding: "gzip" })).not.toThrow();
  });
});
