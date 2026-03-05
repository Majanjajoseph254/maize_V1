/**
 * Scan History Dashboard
 * ======================
 * Displays farmer's disease diagnosis history from offline IndexedDB.
 * Features:
 * - Real-time scan list (newest first)
 * - Filters by disease, confidence, date range
 * - Statistics: total scans, disease breakdown, health trends
 * - Search/sort capabilities
 * - Export data for backup
 */

class ScanHistoryDashboard {
  constructor(containerId = 'scan-history-dashboard') {
    this.container = document.getElementById(containerId);
    this.scans = [];
    this.filteredScans = [];
    this.stats = {
      totalScans: 0,
      healthyScans: 0,
      diseaseScans: 0,
      uniqueDiseases: new Set(),
      averageConfidence: 0,
    };
    this.filters = {
      disease: 'all',
      confidence: 'all',
      dateRange: 30,
      searchTerm: '',
    };
    this.sortBy = 'date-desc';
  }

  /**
   * Initialize dashboard and load scans from IndexedDB
   */
  async init() {
    if (!this.container) {
      console.error('[ScanHistory] Container not found');
      return false;
    }

    try {
      this.renderLoading();
      
      // Wait for offline DB to initialize
      if (!window.offlineDB) {
        console.warn('[ScanHistory] Offline DB not ready');
        await new Promise(resolve => {
          document.addEventListener('offline-db-ready', resolve, { once: true });
          setTimeout(resolve, 5000);
        });
      }

      // Load scans from IndexedDB
      this.scans = await window.offlineDB.getScans(1000, 180); // 6 months
      this.calculateStats();
      this.applyFilters();

      console.log(`[ScanHistory] ✅ Loaded ${this.scans.length} scans`);
      this.render();
      this.attachListeners();

      return true;
    } catch (error) {
      console.error('[ScanHistory] Init failed:', error);
      this.renderError(error.message);
      return false;
    }
  }

  /**
   * Calculate statistics from scan data
   */
  calculateStats() {
    this.stats = {
      totalScans: this.scans.length,
      healthyScans: 0,
      diseaseScans: 0,
      uniqueDiseases: new Set(),
      averageConfidence: 0,
      confidenceBreakdown: {
        high: 0,    // 80-100%
        medium: 0,  // 50-79%
        low: 0,     // <50%
      },
      diseaseFrequency: {},
    };

    if (this.scans.length === 0) return;

    let totalConfidence = 0;

    this.scans.forEach(scan => {
      const isHealthy = scan.disease === 'Healthy' || scan.disease === 'healthy';
      
      if (isHealthy) {
        this.stats.healthyScans++;
      } else {
        this.stats.diseaseScans++;
        this.stats.uniqueDiseases.add(scan.disease);

        // Count disease frequency
        if (!this.stats.diseaseFrequency[scan.disease]) {
          this.stats.diseaseFrequency[scan.disease] = 0;
        }
        this.stats.diseaseFrequency[scan.disease]++;
      }

      // Confidence breakdown
      const confidence = (scan.confidence || 0) * 100;
      totalConfidence += confidence;

      if (confidence >= 80) {
        this.stats.confidenceBreakdown.high++;
      } else if (confidence >= 50) {
        this.stats.confidenceBreakdown.medium++;
      } else {
        this.stats.confidenceBreakdown.low++;
      }
    });

    this.stats.averageConfidence = (totalConfidence / this.scans.length).toFixed(1);
    this.stats.healthPercentage = (
      (this.stats.healthyScans / this.stats.totalScans) * 100
    ).toFixed(0);
  }

  /**
   * Apply filters and sorting
   */
  applyFilters() {
    let filtered = [...this.scans];

    // Filter by disease
    if (this.filters.disease !== 'all') {
      filtered = filtered.filter(scan => scan.disease === this.filters.disease);
    }

    // Filter by confidence
    if (this.filters.confidence !== 'all') {
      filtered = filtered.filter(scan => {
        const conf = (scan.confidence || 0) * 100;
        if (this.filters.confidence === 'high') return conf >= 80;
        if (this.filters.confidence === 'medium') return conf >= 50 && conf < 80;
        if (this.filters.confidence === 'low') return conf < 50;
      });
    }

    // Filter by date range
    if (this.filters.dateRange && this.filters.dateRange > 0) {
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - this.filters.dateRange);
      filtered = filtered.filter(
        scan => new Date(scan.timestamp) >= cutoffDate
      );
    }

    // Search term
    if (this.filters.searchTerm) {
      const term = this.filters.searchTerm.toLowerCase();
      filtered = filtered.filter(
        scan => 
          (scan.disease || '').toLowerCase().includes(term) ||
          (scan.mvp_summary || '').toLowerCase().includes(term)
      );
    }

    // Sort
    filtered.sort((a, b) => {
      if (this.sortBy === 'date-desc') {
        return new Date(b.timestamp) - new Date(a.timestamp);
      }
      if (this.sortBy === 'date-asc') {
        return new Date(a.timestamp) - new Date(b.timestamp);
      }
      if (this.sortBy === 'confidence-high') {
        return (b.confidence || 0) - (a.confidence || 0);
      }
      if (this.sortBy === 'confidence-low') {
        return (a.confidence || 0) - (b.confidence || 0);
      }
      return 0;
    });

    this.filteredScans = filtered;
  }

  /**
   * Main render function
   */
  render() {
    if (this.scans.length === 0) {
      this.container.innerHTML = this.renderEmpty();
      return;
    }

    const html = `
      <div class="scan-history-container">
        <!-- Header -->
        <div class="scan-history-header">
          <h2>📋 Scan History</h2>
          <div class="header-actions">
            <button class="scan-export-btn" id="scan-export" title="Export as JSON">
              📥 Export
            </button>
          </div>
        </div>

        <!-- Statistics Cards -->
        ${this.renderStats()}

        <!-- Filters -->
        <div class="scan-filters-section">
          <div class="scan-filters-grid">
            <!-- Disease Filter -->
            <div class="filter-group">
              <label>Disease</label>
              <select id="scan-filter-disease" class="scan-filter-select">
                <option value="all">All Conditions</option>
                ${Array.from(this.stats.uniqueDiseases)
                  .map(disease => `<option value="${disease}">${disease}</option>`)
                  .join('')}
              </select>
            </div>

            <!-- Confidence Filter -->
            <div class="filter-group">
              <label>Confidence</label>
              <select id="scan-filter-confidence" class="scan-filter-select">
                <option value="all">All</option>
                <option value="high">High (80%+)</option>
                <option value="medium">Medium (50-79%)</option>
                <option value="low">Low (&lt;50%)</option>
              </select>
            </div>

            <!-- Date Range -->
            <div class="filter-group">
              <label>Date Range</label>
              <select id="scan-filter-date" class="scan-filter-select">
                <option value="7">Last 7 days</option>
                <option value="30" selected>Last 30 days</option>
                <option value="90">Last 3 months</option>
                <option value="180">Last 6 months</option>
                <option value="0">All time</option>
              </select>
            </div>

            <!-- Sort -->
            <div class="filter-group">
              <label>Sort By</label>
              <select id="scan-sort" class="scan-filter-select">
                <option value="date-desc">Newest First</option>
                <option value="date-asc">Oldest First</option>
                <option value="confidence-high">Most Confident</option>
                <option value="confidence-low">Least Confident</option>
              </select>
            </div>

            <!-- Search -->
            <div class="filter-group filter-search">
              <input type="text" id="scan-search" 
                     class="scan-filter-search" 
                     placeholder="Search scans..."
                     aria-label="Search scan history">
            </div>

            <!-- Clear Filters -->
            <button id="scan-filter-clear" class="scan-filter-clear" title="Reset filters">
              ✕ Clear Filters
            </button>
          </div>
          <p class="filter-results-count">${this.filteredScans.length} of ${this.scans.length} scans</p>
        </div>

        <!-- Scan List -->
        <div class="scan-list">
          ${this.filteredScans.map((scan, idx) => this.renderScanCard(scan, idx)).join('')}
        </div>
      </div>
    `;

    this.container.innerHTML = html;
  }

  /**
   * Render statistics cards
   */
  renderStats() {
    const { totalScans, healthyScans, diseaseScans, healthPercentage, averageConfidence } = this.stats;

    return `
      <div class="scan-stats-grid">
        <div class="stat-card scan-stat-card">
          <div class="stat-icon">📊</div>
          <div class="stat-data">
            <p class="stat-value">${totalScans}</p>
            <p class="stat-label">Total Scans</p>
          </div>
        </div>

        <div class="stat-card scan-stat-card">
          <div class="stat-icon 🌱">🌱</div>
          <div class="stat-data">
            <p class="stat-value">${healthPercentage}%</p>
            <p class="stat-label">Healthy (${healthyScans})</p>
          </div>
        </div>

        <div class="stat-card scan-stat-card">
          <div class="stat-icon">⚠️</div>
          <div class="stat-data">
            <p class="stat-value">${diseaseScans}</p>
            <p class="stat-label">Diseases Found</p>
          </div>
        </div>

        <div class="stat-card scan-stat-card">
          <div class="stat-icon">🎯</div>
          <div class="stat-data">
            <p class="stat-value">${averageConfidence}%</p>
            <p class="stat-label">Avg. Confidence</p>
          </div>
        </div>
      </div>
    `;
  }

  /**
   * Render individual scan card
   */
  renderScanCard(scan, index) {
    const date = new Date(scan.timestamp);
    const dateStr = date.toLocaleDateString();
    const timeStr = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const confidence = ((scan.confidence || 0) * 100).toFixed(0);
    const isHealthy = scan.disease === 'Healthy' || scan.disease === 'healthy';

    const confidenceColor = confidence >= 80 ? 'high' : confidence >= 50 ? 'medium' : 'low';
    const diseaseIcon = isHealthy ? '🌱' : '⚠️';

    return `
      <div class="scan-card scan-card-${confidenceColor}" id="scan-${index}">
        <div class="scan-card-header">
          <div class="scan-disease-info">
            <span class="scan-disease-icon">${diseaseIcon}</span>
            <div>
              <h4 class="scan-disease-name">${scan.disease || 'Unknown'}</h4>
              <p class="scan-summary">${scan.mvp_summary || scan.message || 'No description'}</p>
            </div>
          </div>
          <div class="scan-meta">
            <span class="scan-date">${dateStr}</span>
            <span class="scan-time">${timeStr}</span>
          </div>
        </div>

        <div class="scan-card-body">
          <!-- Confidence Bar -->
          <div class="scan-confidence">
            <div class="confidence-header">
              <span class="confidence-label">Confidence</span>
              <span class="confidence-value">${confidence}%</span>
            </div>
            <div class="confidence-bar">
              <div class="confidence-fill" style="width: ${confidence}%"></div>
            </div>
          </div>

          ${!isHealthy ? `
            <!-- Treatment Info -->
            <div class="scan-treatment" style="margin-top: 12px;">
              <h5 class="treatment-title">Recommended Treatment</h5>
              <div class="treatment-content">
                ${scan.treatment ? `
                  <p><strong>Medication:</strong> ${scan.treatment.medication || '—'}</p>
                  <p><strong>Prevention:</strong> ${scan.treatment.prevention || '—'}</p>
                ` : '<p>—</p>'}
              </div>
            </div>
          ` : ''}
        </div>

        <div class="scan-card-footer">
          <button class="scan-action-btn" data-scan-index="${index}" title="View details">
            📄 Details
          </button>
          <button class="scan-action-btn scan-action-delete" data-scan-index="${index}" title="Delete this scan">
            🗑️ Delete
          </button>
        </div>
      </div>
    `;
  }

  /**
   * Render empty state
   */
  renderEmpty() {
    return `
      <div class="scan-history-empty">
        <div class="empty-icon">📋</div>
        <h3>No Scans Yet</h3>
        <p>Start diagnosing your maize leaves to build your scan history.</p>
        <button class="btn btn-primary" onclick="navigateTo('diagnose')">
          🔬 Start Scanning
        </button>
      </div>
    `;
  }

  renderLoading() {
    this.container.innerHTML = `
      <div class="scan-history-loading">
        <div class="loading-spinner"></div>
        <p>Loading your scan history...</p>
      </div>
    `;
  }

  renderError(message) {
    this.container.innerHTML = `
      <div class="scan-history-error">
        <span class="error-icon">⚠️</span>
        <h3>Could Not Load History</h3>
        <p>${message}</p>
      </div>
    `;
  }

  /**
   * Attach event listeners
   */
  attachListeners() {
    // Filters
    document.getElementById('scan-filter-disease')?.addEventListener('change', (e) => {
      this.filters.disease = e.target.value;
      this.applyFilters();
      this.render();
      this.attachListeners();
    });

    document.getElementById('scan-filter-confidence')?.addEventListener('change', (e) => {
      this.filters.confidence = e.target.value;
      this.applyFilters();
      this.render();
      this.attachListeners();
    });

    document.getElementById('scan-filter-date')?.addEventListener('change', (e) => {
      this.filters.dateRange = parseInt(e.target.value);
      this.applyFilters();
      this.render();
      this.attachListeners();
    });

    document.getElementById('scan-sort')?.addEventListener('change', (e) => {
      this.sortBy = e.target.value;
      this.applyFilters();
      this.render();
      this.attachListeners();
    });

    document.getElementById('scan-search')?.addEventListener('input', (e) => {
      this.filters.searchTerm = e.target.value;
      this.applyFilters();
      this.render();
      this.attachListeners();
    });

    document.getElementById('scan-filter-clear')?.addEventListener('click', () => {
      this.filters = {
        disease: 'all',
        confidence: 'all',
        dateRange: 30,
        searchTerm: '',
      };
      this.sortBy = 'date-desc';
      this.applyFilters();
      this.render();
      this.attachListeners();
    });

    // Action buttons
    document.querySelectorAll('.scan-action-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const index = parseInt(e.target.dataset.scanIndex);
        if (e.target.classList.contains('scan-action-delete')) {
          this.deleteScan(this.filteredScans[index]);
        } else {
          this.viewScanDetails(this.filteredScans[index]);
        }
      });
    });

    // Export
    document.getElementById('scan-export')?.addEventListener('click', () => {
      this.exportData();
    });
  }

  /**
   * Delete a scan from history
   */
  async deleteScan(scan) {
    if (!confirm('Delete this scan? This cannot be undone.')) return;

    const scanIndex = this.scans.findIndex(s => s.id === scan.id);
    if (scanIndex > -1) {
      this.scans.splice(scanIndex, 1);
      this.calculateStats();
      this.applyFilters();
      this.render();
      this.attachListeners();

      console.log('[ScanHistory] Scan deleted:', scan.id);
    }
  }

  /**
   * View scan details
   */
  viewScanDetails(scan) {
    const modal = document.createElement('div');
    modal.className = 'scan-detail-modal';
    modal.innerHTML = `
      <div class="scan-detail-content">
        <button class="modal-close" onclick="this.parentElement.parentElement.remove()">✕</button>
        <h2>${scan.disease}</h2>
        <p><strong>Confidence:</strong> ${((scan.confidence || 0) * 100).toFixed(1)}%</p>
        <p><strong>Date:</strong> ${new Date(scan.timestamp).toLocaleString()}</p>
        <p><strong>Summary:</strong> ${scan.mvp_summary}</p>
        ${scan.treatment ? `
          <h3>Treatment</h3>
          <p><strong>Medication:</strong> ${scan.treatment.medication}</p>
          <p><strong>Prevention:</strong> ${scan.treatment.prevention}</p>
        ` : ''}
      </div>
    `;
    document.body.appendChild(modal);
  }

  /**
   * Export scan data as JSON
   */
  exportData() {
    const exportData = {
      exportedAt: new Date().toISOString(),
      totalScans: this.scans.length,
      scans: this.scans,
      stats: {
        ...this.stats,
        uniqueDiseases: Array.from(this.stats.uniqueDiseases),
      },
    };

    const blob = new Blob([JSON.stringify(exportData, null, 2)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `scan-history-${Date.now()}.json`;
    link.click();
    URL.revokeObjectURL(url);

    console.log('[ScanHistory] Data exported');
  }
}

// Auto-init on page load
window.addEventListener('DOMContentLoaded', () => {
  if (document.getElementById('scan-history-dashboard')) {
    window.scanHistoryDashboard = new ScanHistoryDashboard('scan-history-dashboard');
    window.scanHistoryDashboard.init();
  }
});
