const openDb = (name, upgrade) => {
    return new Promise((resolve, reject) => {
        const req = indexedDB.open(name);
        req.onupgradeneeded = () => upgrade(req.result);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
};
const getDb = (() => {
    const dbs = new Map();
    return (name, initialize) => {
        if (!dbs.has(name)) {
            dbs.set(name, openDb(name, initialize));
        }
        return dbs.get(name);
    };
})();
const getSimpleDb = (name) => {
    return getDb(name, (db) => {
        db.createObjectStore("data");
    });
};
export const setItem = async (key, value) => {
    const db = await getSimpleDb("lsish"); // "localStorage-ish"
    const tx = db.transaction(["data"], "readwrite");
    const os = tx.objectStore("data");
    os.put(value, key);
    return new Promise((resolve, reject) => {
        tx.oncomplete = resolve;
        tx.onerror = reject;
    });
};
export const getItem = async (key) => {
    const db = await getSimpleDb("lsish");
    const tx = db.transaction(["data"], "readonly");
    const os = tx.objectStore("data");
    const req = os.get(key);
    return new Promise((resolve, reject) => {
        req.onsuccess = () => resolve(req.result);
        req.onerror = reject;
    });
};

export const getAllItems = async (prefix = '') => {
    const db = await getSimpleDb("lsish");
    const tx = db.transaction(["data"], "readonly");
    const os = tx.objectStore("data");
    const query = IDBKeyRange.bound(prefix, prefix + '\uffff', false, false);
    const req = os.getAll(query);
    return new Promise((resolve, reject) => {
        req.onsuccess = () => resolve(req.result);
        req.onerror = reject;
    });
};
