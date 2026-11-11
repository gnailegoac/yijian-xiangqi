// An in-memory stand-in for the DOM Storage interface (localStorage), for store tests (F0, frozen).
// Behaves like the real thing: string keys and values, insertion order, getItem returns null for a missing key.
// Two switches simulate a browser whose storage is unreachable or full, and a log records every mutation.

/**
 * @typedef {Object} StorageWrite
 * @property {'set'|'remove'|'clear'} op
 * @property {string|null} key        null for clear
 * @property {string|null} value      the stored string for set, else null
 * @property {boolean} ok             false when the call threw
 *
 * @typedef {Object} MemoryStorageControls
 * @property {boolean} failGet        while true, getItem, key and length throw a SecurityError (storage unreachable)
 * @property {boolean} failSet        while true, setItem throws a QuotaExceededError and stores nothing
 * @property {StorageWrite[]} log     every setItem, removeItem and clear call, in order
 * @property {() => Record<string, string>} dump    a plain copy of the content (never throws)
 *
 * @typedef {Storage & MemoryStorageControls} MemoryStorage
 */

/**
 * @param {Record<string, string>} [initial] content to start with (not logged)
 * @returns {MemoryStorage}
 */
export function createMemoryStorage(initial = {}) {
  /** @type {Map<string, string>} */
  const items = new Map(Object.entries(initial).map(([key, value]) => [key, String(value)]));
  const unreachable = () => new DOMException('The operation is insecure.', 'SecurityError');

  /** @type {MemoryStorage} */
  const storage = {
    failGet: false,
    failSet: false,
    log: [],
    get length() {
      if (storage.failGet) throw unreachable();
      return items.size;
    },
    /** @param {number} index */
    key(index) {
      if (storage.failGet) throw unreachable();
      return [...items.keys()][index] ?? null;
    },
    /** @param {string} key */
    getItem(key) {
      if (storage.failGet) throw unreachable();
      return items.get(String(key)) ?? null;
    },
    /** @param {string} key @param {string} value */
    setItem(key, value) {
      const entry = { op: /** @type {'set'} */ ('set'), key: String(key), value: String(value), ok: !storage.failSet };
      storage.log.push(entry);
      if (storage.failSet) throw new DOMException('The quota has been exceeded.', 'QuotaExceededError');
      items.set(entry.key, entry.value);
    },
    /** @param {string} key */
    removeItem(key) {
      storage.log.push({ op: 'remove', key: String(key), value: null, ok: true });
      items.delete(String(key));
    },
    clear() {
      storage.log.push({ op: 'clear', key: null, value: null, ok: true });
      items.clear();
    },
    dump() {
      return Object.fromEntries(items);
    },
  };
  return storage;
}
