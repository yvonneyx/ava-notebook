let database: Promise<IDBDatabase> | undefined;

function openDatabase() {
  return (database ??= new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open('ava-notebook-direct', 1);
    request.onupgradeneeded = () => {
      for (const name of ['runs', 'sources', 'drafts'])
        request.result.createObjectStore(name);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => {
      database = undefined;
      reject(new Error('无法打开浏览器存储，请检查浏览器的网站数据权限。'));
    };
  }));
}

export async function readLocal<T>(
  store: string,
  key: string,
): Promise<T | undefined> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const request = db.transaction(store).objectStore(store).get(key);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function listLocal<T>(store: string): Promise<T[]> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const request = db.transaction(store).objectStore(store).getAll();
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function writeLocal(store: string, key: string, value: unknown) {
  const db = await openDatabase();
  return new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(store, 'readwrite');
    transaction.objectStore(store).put(value, key);
    transaction.oncomplete = () => resolve();
    transaction.onabort = () =>
      reject(new Error('浏览器存储失败，请检查剩余空间。'));
    transaction.onerror = () => reject(transaction.error);
  });
}

export async function deleteLocal(store: string, key: string) {
  const db = await openDatabase();
  return new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(store, 'readwrite');
    transaction.objectStore(store).delete(key);
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(new Error('删除失败，请重试。'));
    transaction.onerror = () => reject(transaction.error);
  });
}

export async function archiveLocalRun(id: string, archive: { id: string }) {
  const db = await openDatabase();
  return new Promise<void>((resolve, reject) => {
    const transaction = db.transaction('runs', 'readwrite');
    const store = transaction.objectStore('runs');
    store.put(archive, archive.id);
    store.delete(id);
    transaction.oncomplete = () => resolve();
    transaction.onabort = () =>
      reject(new Error('旧版案例保存失败，请检查浏览器存储空间。'));
    transaction.onerror = () => reject(transaction.error);
  });
}
