function isObject(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function failCreateForTable<T extends object>(tables: T, tableId: string): T {
  return new Proxy(tables, {
    get(target, property, receiver) {
      const value: unknown = Reflect.get(target, property, receiver);
      if (typeof value !== "function") return value;
      if (property !== "createRow" && property !== "createOperations") {
        return (...args: readonly unknown[]) =>
          Reflect.apply(value, target, args) as unknown;
      }
      return (...args: readonly unknown[]) => {
        const input = args[0];
        const targetsTable =
          isObject(input) &&
          (input.tableId === tableId ||
            (Array.isArray(input.operations) &&
              input.operations.some(
                (operation) => isObject(operation) && operation.tableId === tableId,
              )));
        if (targetsTable) {
          return Promise.reject(new Error("APPWRITE_G1_FORCED_ROW_FAILURE"));
        }
        return Reflect.apply(value, target, args) as unknown;
      };
    },
  });
}
