import { describe, expect, it } from "vitest";

import { stringifyJson, stringifyNdjson } from "./json";

describe("json serialization", () => {
  it("serializes bigint values safely", () => {
    expect(stringifyJson({ value: BigInt(10) })).toContain('"value": "10"');
    expect(stringifyNdjson({ value: BigInt(10) })).toBe('{"value":"10"}\n');
  });
});
