export type ExportedAttribute = {
  $id: string;
  key: string;
  $type: string;
  required?: boolean;
  default?: unknown;
  array?: boolean;
  size?: number;
  elements?: string[];
  min?: number;
  max?: number;
  encrypt?: boolean;
  relatedCollectionId?: string;
  twoWay?: boolean;
  twoWayKey?: string;
  onDelete?: string;
  side?: string;
  format?: string;
};

export type ExportedIndex = {
  $id: string;
  key: string;
  type: string;
  attributes: string[];
  orders?: string[];
  lengths?: (number | null)[];
};

export type ExportedCollectionSchema = {
  collection: {
    $id: string;
    name: string;
    $permissions?: string[];
    documentSecurity?: boolean;
    enabled?: boolean;
    [key: string]: unknown;
  };
  attributes: ExportedAttribute[];
  indexes: ExportedIndex[];
};

export type ExportedDatabaseSchema = {
  database: { $id: string; name: string; [key: string]: unknown };
  collections: ExportedCollectionSchema[];
};

export type ExportedSchema = {
  exportedAt: string;
  databases: ExportedDatabaseSchema[];
};

export type SchemaRestoreResult = {
  status: "complete" | "partial" | "failed";
  attributesCreated: number;
  attributesSkipped: number;
  indexesCreated: number;
  indexesSkipped: number;
  errors: string[];
};
