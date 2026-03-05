/**
 * OfflineDB - IndexedDB Wrapper for KilimoSmart PWA
 * ===================================================
 * Manages offline data storage for farmer profiles, scan history,
 * market data, and cached API responses.
 * 
 * Databases:
 * - kilimosmart_farmer: User profile & field data
 * - kilimosmart_scans: Disease diagnosis history
 * - kilimosmart_cache: API response cache
 */

class OfflineDB {
  constructor() {
    this.dbName = 'kilimosmart_farmer';
    this.scanDbName = 'kilimosmart_scans';
    this.cacheDbName = 'kilimosmart_cache';
    this.dbVersion = 1;
    this.db = null;
    this.scanDb = null;
    this.cacheDb = null;
  }

  /**
   * Initialize all databases
   */
  async init() {
    try {
      if (!('indexedDB' in window)) {
        console.warn('[DB] IndexedDB not available - offline features disabled');
        return false;
      }

      await this.initFarmerDB();
      await this.initScanDB();
      await this.initCacheDB();
      console.log('[DB] ✅ All databases initialized');
      return true;
    } catch (error) {
      console.error('[DB] Init failed:', error);
      return false;
    }
  }

  // ═════════════════════════════════════════════════════════════════
  // FARMER DATABASE (Profile & field data)
  // ═════════════════════════════════════════════════════════════════

  async initFarmerDB() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.dbName, this.dbVersion);

      request.onerror = () => {
        console.error('[DB-Farmer] Open failed:', request.error);
        reject(request.error);
      };

      request.onsuccess = () => {
        this.db = request.result;
        console.log('[DB-Farmer] ✅ Opened');
        resolve();
      };

      request.onupgradeneeded = (event) => {
        const db = event.target.result;

        // Store: farmer profile (name, county, acres, etc.)
        if (!db.objectStoreNames.contains('profile')) {
          const profileStore = db.createObjectStore('profile', { keyPath: 'id' });
          profileStore.createIndex('email', 'email', { unique: true });
        }

        // Store: field metadata
        if (!db.objectStoreNames.contains('fields')) {
          const fieldsStore = db.createObjectStore('fields', { keyPath: 'id', autoIncrement: true });
          fieldsStore.createIndex('crop', 'crop', { unique: false });
        }

        // Store: device settings
        if (!db.objectStoreNames.contains('settings')) {
          db.createObjectStore('settings', { keyPath: 'key' });
        }

        console.log('[DB-Farmer] Upgraded');
      };
    });
  }

  /**
   * Save farmer profile
   */
  async saveFarmerProfile(profile) {
    if (!this.db) return false;

    const payload = {
      id: 'farmer_1',
      ...profile,
      updatedAt: new Date().toISOString(),
    };

    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(['profile'], 'readwrite');
      const store = tx.objectStore('profile');
      const request = store.put(payload);

      request.onsuccess = () => {
        console.log('[DB-Farmer] Profile saved:', payload.name);
        resolve(payload);
      };
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * Get farmer profile
   */
  async getFarmerProfile() {
    if (!this.db) return null;

    return new Promise((resolve) => {
      const tx = this.db.transaction(['profile'], 'readonly');
      const store = tx.objectStore('profile');
      const request = store.get('farmer_1');

      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => resolve(null);
    });
  }

  /**
   * Save field/parcel data
   */
  async saveField(fieldData) {
    if (!this.db) return false;

    const payload = {
      ...fieldData,
      createdAt: new Date().toISOString(),
    };

    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(['fields'], 'readwrite');
      const store = tx.objectStore('fields');
      const request = store.add(payload);

      request.onsuccess = () => {
        console.log('[DB-Farmer] Field saved:', fieldData.name);
        resolve({ id: request.result, ...payload });
      };
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * Get all crop fields
   */
  async getFields(cropType = null) {
    if (!this.db) return [];

    return new Promise((resolve) => {
      const tx = this.db.transaction(['fields'], 'readonly');
      const store = tx.objectStore('fields');

      let request;
      if (cropType) {
        const index = store.index('crop');
        request = index.getAll(cropType);
      } else {
        request = store.getAll();
      }

      request.onsuccess = () => resolve(request.result || []);
      request.onerror = () => resolve([]);
    });
  }

  // ═════════════════════════════════════════════════════════════════
  // SCAN DATABASE (Disease diagnosis history)
  // ═════════════════════════════════════════════════════════════════

  async initScanDB() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.scanDbName, this.dbVersion);

      request.onerror = () => reject(request.error);

      request.onsuccess = () => {
        this.scanDb = request.result;
        console.log('[DB-Scans] ✅ Opened');
        resolve();
      };

      request.onupgradeneeded = (event) => {
        const db = event.target.result;

        // Store: scan results (disease diagnosis with timestamps)
        if (!db.objectStoreNames.contains('scans')) {
          const scansStore = db.createObjectStore('scans', { keyPath: 'id', autoIncrement: true });
          scansStore.createIndex('date', 'timestamp', { unique: false });
          scansStore.createIndex('disease', 'disease', { unique: false });
          scansStore.createIndex('synced', 'synced', { unique: false });
        }

        console.log('[DB-Scans] Upgraded');
      };
    });
  }

  /**
   * Save a disease scan result
   */
  async saveScan(scanData) {
    if (!this.scanDb) return false;

    const payload = {
      ...scanData,
      timestamp: new Date().toISOString(),
      synced: false, // Mark for later sync when online
    };

    return new Promise((resolve, reject) => {
      const tx = this.scanDb.transaction(['scans'], 'readwrite');
      const store = tx.objectStore('scans');
      const request = store.add(payload);

      request.onsuccess = () => {
        console.log('[DB-Scans] Scan saved:', scanData.disease);
        resolve({ id: request.result, ...payload });
      };
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * Get all scans (optionally filter by date range)
   */
  async getScans(limit = 100, daysBack = 30) {
    if (!this.scanDb) return [];

    return new Promise((resolve) => {
      const tx = this.scanDb.transaction(['scans'], 'readonly');
      const store = tx.objectStore('scans');
      const index = store.index('date');

      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - daysBack);

      const range = IDBKeyRange.lowerBound(cutoffDate.toISOString());
      const request = index.getAll(range);

      request.onsuccess = () => {
        const results = (request.result || []).sort((a, b) => 
          new Date(b.timestamp) - new Date(a.timestamp)
        );
        resolve(results.slice(0, limit));
      };
      request.onerror = () => resolve([]);
    });
  }

  /**
   * Get unsynced scans (for upload when reconnected)
   */
  async getUnsyncedScans() {
    if (!this.scanDb) return [];

    return new Promise((resolve) => {
      const tx = this.scanDb.transaction(['scans'], 'readonly');
      const store = tx.objectStore('scans');
      const index = store.index('synced');
      const request = index.getAll(false);

      request.onsuccess = () => resolve(request.result || []);
      request.onerror = () => resolve([]);
    });
  }

  /**
   * Mark scan as synced
   */
  async markScanSynced(scanId) {
    if (!this.scanDb) return false;

    return new Promise((resolve) => {
      const tx = this.scanDb.transaction(['scans'], 'readwrite');
      const store = tx.objectStore('scans');
      const getRequest = store.get(scanId);

      getRequest.onsuccess = () => {
        const scan = getRequest.result;
        if (scan) {
          scan.synced = true;
          const updateRequest = store.put(scan);
          updateRequest.onsuccess = () => {
            console.log('[DB-Scans] Marked as synced:', scanId);
            resolve(true);
          };
          updateRequest.onerror = () => resolve(false);
        }
      };
    });
  }

  // ═════════════════════════════════════════════════════════════════
  // CACHE DATABASE (API response cache)
  // ═════════════════════════════════════════════════════════════════

  async initCacheDB() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.cacheDbName, this.dbVersion);

      request.onerror = () => reject(request.error);

      request.onsuccess = () => {
        this.cacheDb = request.result;
        console.log('[DB-Cache] ✅ Opened');
        resolve();
      };

      request.onupgradeneeded = (event) => {
        const db = event.target.result;

        // Store: API response cache
        if (!db.objectStoreNames.contains('responses')) {
          const cacheStore = db.createObjectStore('responses', { keyPath: 'url' });
          cacheStore.createIndex('expiry', 'expiry', { unique: false });
        }

        console.log('[DB-Cache] Upgraded');
      };
    });
  }

  /**
   * Save API response to cache
   */
  async cacheResponse(url, data, ttlMinutes = 60) {
    if (!this.cacheDb) return false;

    const expiryTime = new Date(Date.now() + ttlMinutes * 60000).toISOString();
    const payload = {
      url,
      data,
      expiry: expiryTime,
      cachedAt: new Date().toISOString(),
    };

    return new Promise((resolve) => {
      const tx = this.cacheDb.transaction(['responses'], 'readwrite');
      const store = tx.objectStore('responses');
      const request = store.put(payload);

      request.onsuccess = () => {
        console.log('[DB-Cache] Cached:', url);
        resolve(true);
      };
      request.onerror = () => resolve(false);
    });
  }

  /**
   * Get cached response (if not expired)
   */
  async getCachedResponse(url) {
    if (!this.cacheDb) return null;

    return new Promise((resolve) => {
      const tx = this.cacheDb.transaction(['responses'], 'readonly');
      const store = tx.objectStore('responses');
      const request = store.get(url);

      request.onsuccess = () => {
        const result = request.result;
        if (!result) {
          resolve(null);
          return;
        }

        // Check if expired
        if (new Date(result.expiry) < new Date()) {
          console.log('[DB-Cache] Expired:', url);
          resolve(null);
          return;
        }

        console.log('[DB-Cache] Cache HIT:', url);
        resolve(result.data);
      };
      request.onerror = () => resolve(null);
    });
  }

  /**
   * Clear expired cache entries
   */
  async clearExpiredCache() {
    if (!this.cacheDb) return false;

    return new Promise((resolve) => {
      const tx = this.cacheDb.transaction(['responses'], 'readwrite');
      const store = tx.objectStore('responses');
      const index = store.index('expiry');

      const now = new Date().toISOString();
      const range = IDBKeyRange.upperBound(now);
      const request = index.openCursor(range);

      let count = 0;
      request.onsuccess = (event) => {
        const cursor = event.target.result;
        if (cursor) {
          cursor.delete();
          count++;
          cursor.continue();
        } else {
          console.log(`[DB-Cache] Cleaned ${count} expired entries`);
          resolve(true);
        }
      };
      request.onerror = () => resolve(false);
    });
  }

  // ═════════════════════════════════════════════════════════════════
  // UTILITY METHODS
  // ═════════════════════════════════════════════════════════════════

  /**
   * Export all data to JSON (for backup)
   */
  async exportData() {
    const profile = await this.getFarmerProfile();
    const fields = await this.getFields();
    const scans = await this.getScans(1000);

    return {
      version: this.dbVersion,
      exportedAt: new Date().toISOString(),
      profile,
      fields,
      scans,
    };
  }

  /**
   * Clear all local data
   */
  async clearAllData() {
    return Promise.all([
      this.clearDB(this.db, ['profile', 'fields', 'settings']),
      this.clearDB(this.scanDb, ['scans']),
      this.clearDB(this.cacheDb, ['responses']),
    ]);
  }

  async clearDB(db, stores) {
    if (!db) return false;

    return new Promise((resolve) => {
      const tx = db.transaction(stores, 'readwrite');
      const requests = stores.map(storeName => tx.objectStore(storeName).clear());

      tx.oncomplete = () => {
        console.log('[DB] Cleared:', stores.join(', '));
        resolve(true);
      };
      tx.onerror = () => resolve(false);
    });
  }
}

// Global instance
window.offlineDB = new OfflineDB();

// Auto-init on page load
window.addEventListener('DOMContentLoaded', () => {
  offlineDB.init().then((initialized) => {
    if (initialized) {
      console.log('[App] Offline storage ready');
      document.dispatchEvent(new Event('offline-db-ready'));
    }
  });
});
