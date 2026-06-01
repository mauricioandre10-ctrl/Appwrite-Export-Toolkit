import { describe, expect, it } from "vitest";

import { extractUserIdsFromPermissions, findLikelyFileReferences } from "./backup-validator";

describe("extractUserIdsFromPermissions", () => {
  it("extracts unique user IDs from Appwrite permission strings", () => {
    expect(
      extractUserIdsFromPermissions([
        'read("user:abc123")',
        'update("user:def456")',
        'delete("user:abc123")',
        'read("users")',
      ]),
    ).toEqual(["abc123", "def456"]);
  });
});

describe("findLikelyFileReferences", () => {
  it("finds file references in common document fields", () => {
    expect(
      findLikelyFileReferences(
        {
          photo: "file_123456",
          imageUrls: ["img_abcdef", "https://example.com/image.png"],
          nested: { attachment: "att_999999" },
        },
        "doc",
      ),
    ).toEqual([
      { path: "doc.photo", fileId: "file_123456" },
      { path: "doc.imageUrls", fileId: "img_abcdef" },
      { path: "doc.nested.attachment", fileId: "att_999999" },
    ]);
  });
});
