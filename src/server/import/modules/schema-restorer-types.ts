/** Atributo exportado de una colección de Appwrite, con todas sus propiedades de esquema. */
export type ExportedAttribute = {
  /** ID único del atributo. */
  $id: string;
  /** Nombre de la clave del atributo. */
  key: string;
  /** Tipo del atributo (string, integer, boolean, relationship, etc.). */
  $type: string;
  /** Si el atributo es obligatorio al crear documentos. */
  required?: boolean;
  /** Valor por defecto del atributo. */
  default?: unknown;
  /** Si el atributo es un array. */
  array?: boolean;
  /** Tamaño máximo para atributos de tipo string. */
  size?: number;
  /** Elementos permitidos para atributos de tipo enum. */
  elements?: string[];
  /** Valor mínimo para atributos numéricos. */
  min?: number;
  /** Valor máximo para atributos numéricos. */
  max?: number;
  /** Si el valor debe estar encriptado. */
  encrypt?: boolean;
  /** ID de la colección relacionada (para atributos de tipo relationship). */
  relatedCollectionId?: string;
  /** Si la relación es bidireccional. */
  twoWay?: boolean;
  /** Clave del atributo de relación inversa. */
  twoWayKey?: string;
  /** Comportamiento al eliminar el documento relacionado. */
  onDelete?: string;
  /** Lado de la relación (parent o child). */
  side?: string;
  /** Formato esperado para atributos de tipo email, url, etc. */
  format?: string;
};

/** Índice exportado de una colección de Appwrite. */
export type ExportedIndex = {
  /** ID único del índice. */
  $id: string;
  /** Nombre del índice. */
  key: string;
  /** Tipo de índice (key, fulltext, unique, etc.). */
  type: string;
  /** Atributos que componen el índice. */
  attributes: string[];
  /** Orden de clasificación de cada atributo (asc o desc). */
  orders?: string[];
  /** Longitudes parciales para índices en atributos de tipo string. */
  lengths?: (number | null)[];
};

/** Esquema completo de una colección exportada, incluyendo su metadata, atributos e índices. */
export type ExportedCollectionSchema = {
  /** Metadata de la colección. */
  collection: {
    /** ID único de la colección. */
    $id: string;
    /** Nombre de la colección. */
    name: string;
    /** Permisos de la colección. */
    $permissions?: string[];
    /** Si la colección usa seguridad a nivel de documento. */
    documentSecurity?: boolean;
    /** Si la colección está habilitada. */
    enabled?: boolean;
    [key: string]: unknown;
  };
  /** Lista de atributos del esquema de la colección. */
  attributes: ExportedAttribute[];
  /** Lista de índices de la colección. */
  indexes: ExportedIndex[];
};

/** Esquema de una base de datos exportada con todas sus colecciones. */
export type ExportedDatabaseSchema = {
  /** Metadata de la base de datos. */
  database: { $id: string; name: string; [key: string]: unknown };
  /** Colecciones que pertenecen a esta base de datos. */
  collections: ExportedCollectionSchema[];
};

/** Esquema completo exportado de todas las bases de datos y colecciones. */
export type ExportedSchema = {
  /** Timestamp ISO 8601 de cuándo se exportó el esquema. */
  exportedAt: string;
  /** Lista de bases de datos exportadas con sus colecciones. */
  databases: ExportedDatabaseSchema[];
};

/** Resultado del proceso de restauración de un esquema de colecciones. */
export type SchemaRestoreResult = {
  /** Estado final de la restauración. */
  status: "complete" | "partial" | "failed";
  /** Cantidad de atributos creados exitosamente. */
  attributesCreated: number;
  /** Cantidad de atributos omitidos (ya existían). */
  attributesSkipped: number;
  /** Cantidad de índices creados exitosamente. */
  indexesCreated: number;
  /** Cantidad de índices omitidos (ya existían). */
  indexesSkipped: number;
  /** Mensajes de error encontrados durante la restauración. */
  errors: string[];
};
