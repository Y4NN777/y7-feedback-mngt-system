export type AppwriteColumn =
  | {
      readonly key: string;
      readonly type: "boolean" | "integer" | "datetime";
      readonly required: boolean;
    }
  | {
      readonly key: string;
      readonly type: "varchar";
      readonly size: number;
      readonly required: boolean;
      readonly encrypt?: boolean;
    }
  | {
      readonly key: string;
      readonly type: "text";
      readonly required: boolean;
      readonly encrypt?: boolean;
    };

export interface AppwriteIndex {
  readonly key: string;
  readonly type: "key" | "unique";
  readonly columns: readonly string[];
}

export interface AppwriteTableDefinition {
  readonly id: string;
  readonly name: string;
  readonly permissions: readonly [];
  readonly rowSecurity: true;
  readonly enabled: true;
  readonly columns: readonly AppwriteColumn[];
  readonly indexes: readonly AppwriteIndex[];
}
