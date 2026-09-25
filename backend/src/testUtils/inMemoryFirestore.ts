/**
 * Minimal in-memory Firestore fake for unit/integration tests.
 * Supports the small subset used by this codebase:
 *   collection().doc(id).set/get/update
 *   collection().where(field, '==', value).orderBy(...).get()
 *   collection().orderBy(...).get()
 *   collection().get()
 *   runTransaction(fn) — fn receives { get, set, update, delete } refs
 *
 * Transactions are serialized (one at a time, FIFO), mirroring the
 * single-writer semantics real Firestore transactions provide, so two
 * concurrent read-check-write transactions cannot both succeed.
 */

type Row = Record<string, any>;

export interface InMemoryFirestore {
  getFirestore(): any;
  seed(collection: string, id: string, data: Row): void;
  row(collection: string, id: string): Row | undefined;
  rows(collection: string): Array<{ id: string; data: Row }>;
  reset(): void;
}

export function createInMemoryFirestore(): InMemoryFirestore {
  const store = new Map<string, Map<string, Row>>();
  let autoId = 0;
  // Serializes runTransaction callbacks: the next transaction's callback
  // starts only after the previous one has fully settled.
  let txQueue: Promise<unknown> = Promise.resolve();

  const ensure = (name: string): Map<string, Row> => {
    if (!store.has(name)) store.set(name, new Map());
    return store.get(name)!;
  };

  const matches = (row: Row, field: string, op: string, value: any): boolean => {
    const current = row[field];
    switch (op) {
      case '==':
        return current === value;
      case '!=':
        return current !== value;
      case '<':
        return current !== undefined && current < value;
      case '<=':
        return current !== undefined && current <= value;
      case '>':
        return current !== undefined && current > value;
      case '>=':
        return current !== undefined && current >= value;
      default:
        return false;
    }
  };

  const makeDocs = (name: string, filter?: (row: Row) => boolean) => {
    const entries = [...ensure(name).entries()].filter(([, row]) => (filter ? filter(row) : true));
    return entries.map(([id, row]) => ({ id, data: () => row }));
  };

  const makeQuery = (name: string, filter?: (row: Row) => boolean): any => ({
    where: (field: string, op: string, value: any) =>
      makeQuery(name, (row) => (filter ? filter(row) : true) && matches(row, field, op, value)),
    orderBy: () => makeQuery(name, filter),
    get: async () => ({ docs: makeDocs(name, filter) }),
  });

  const mockFirestore = {
    collection: (name: string) => ({
      doc: (id?: string) => {
        const docId = id ?? `auto-${++autoId}`;
        return {
          id: docId,
          set: async (data: Row) => {
            ensure(name).set(docId, data);
          },
          get: async () => {
            const row = ensure(name).get(docId);
            return row
              ? { exists: true, id: docId, data: () => row }
              : { exists: false, id: docId, data: () => null };
          },
          update: async (data: Row) => {
            const row = ensure(name).get(docId);
            if (row) Object.assign(row, data);
          },
          delete: async () => {
            ensure(name).delete(docId);
          },
        };
      },
      where: (field: string, op: string, value: any) =>
        makeQuery(name, (row) => matches(row, field, op, value)),
      orderBy: () => makeQuery(name),
      get: async () => ({ docs: makeDocs(name) }),
    }),
    runTransaction: async <T>(fn: (tx: any) => Promise<T>): Promise<T> => {
      const tx = {
        get: async (ref: any) => ref.get(),
        set: async (ref: any, data: Row) => ref.set(data),
        update: async (ref: any, data: Row) => ref.update(data),
        delete: async (ref: any) => ref.delete(),
      };
      const run = txQueue.then(() => fn(tx));
      txQueue = run.then(
        () => undefined,
        () => undefined
      );
      return run;
    },
  };

  return {
    getFirestore: () => mockFirestore,
    seed: (collection: string, id: string, data: Row) => {
      ensure(collection).set(id, data);
    },
    row: (collection: string, id: string) => ensure(collection).get(id),
    rows: (collection: string) =>
      [...ensure(collection).entries()].map(([id, data]) => ({ id, data })),
    reset: () => {
      store.clear();
      autoId = 0;
    },
  };
}
