export type ExportWarning = {
  code: string;
  message: string;
  module?: string;
  resourceId?: string;
};

export type ExportResult<TData> = {
  module: string;
  exportedAt: string;
  data: TData;
  warnings: ExportWarning[];
};
