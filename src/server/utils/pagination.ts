import { Query } from "node-appwrite";

import { withRetry } from "./retry";

export type AppwriteListResponse<TKey extends string, TItem> = {
  total: number;
} & Record<TKey, TItem[]>;

export async function listAll<TKey extends string, TItem>(
  key: TKey,
  list: (queries: string[]) => Promise<AppwriteListResponse<TKey, TItem>>,
  options: { limit?: number; safetyLimit?: number } = {},
): Promise<{ total: number; rows: TItem[] }> {
  const rows: TItem[] = [];
  let total = 0;

  for await (const page of paginateRows(key, list, options)) {
    total = page.total;
    rows.push(...page.rows);
  }

  return { total, rows };
}

export async function* paginateRows<TKey extends string, TItem>(
  key: TKey,
  list: (queries: string[]) => Promise<AppwriteListResponse<TKey, TItem>>,
  options: { limit?: number; safetyLimit?: number } = {},
): AsyncGenerator<{ total: number; rows: TItem[] }> {
  const limit = options.limit ?? 100;
  const safetyLimit = options.safetyLimit ?? 100_000;
  let offset = 0;

  while (true) {
    const response = await withRetry(() => list([Query.limit(limit), Query.offset(offset)]));
    const batch = response[key] ?? [];
    yield { total: response.total ?? offset + batch.length, rows: batch };

    if (batch.length < limit) {
      return;
    }

    offset += limit;

    if (offset > safetyLimit) {
      throw new Error(`Pagination safety limit exceeded after ${offset} records`);
    }
  }
}
