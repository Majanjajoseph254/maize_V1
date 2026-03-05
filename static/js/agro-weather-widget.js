/**
 * AgroWeatherWidget - Maize-specific weather intelligence
 * ========================================================
 * Displays current conditions, Growing Degree Days (GDD),
 * rainfall tracking, and soil moisture warnings.
 * 
 * Features:
 * - Real-time GDD accumulation (base temp 10°C for maize)
 * - Soil moisture critical alerts (<20%)
 * - Rainfall tracking for irrigation planning
 * - 5-day forecast summary
 */

class AgroWeatherWidget {
  constructor(containerId = 'agro-weather-widget') {
    this.container = document.getElementById(containerId);
    this.baseTemp = 10; // °C - Maize base temperature
    this.optimalTemp = 25; // °C - Optimal growth temperature
    this.moistureWarningThreshold = 20; // % - Critical moisture level
    
    this.weatherData = null;
    this.gddAccumulated = 0;
    this.isLoading = false;
    this.lastUpdateTime = null;
  }

  /**
   * Initialize widget and fetch weather data
   */
  async init() {
    if (!this.container) {
      console.error('[AgroWeather] Container not found');
      return false;
    }

    try {
      this.isLoading = true;
      this.render();
      
      // Fetch weather data
      await this.fetchWeatherData();
      
      this.isLoading = false;
      this.render();
      
      console.log('[AgroWeather] ✅ Widget initialized');
      return true;
    } catch (error) {
      console.error('[AgroWeather] Init failed:', error);
      this.renderError(error.message);
      return false;
    }
  }

  /**
   * Fetch weather data from API
   * Expects endpoint that returns: { temp, humidity, soilMoisture, rainfall, forecast: [] }
   */
  async fetchWeatherData() {
    try {
      const response = await fetch('/api/weather', {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
      });

      if (!response.ok) {
        throw new Error(`Weather API error: ${response.status}`);
      }

      const raw = await response.json();

      // Normalize API payload into widget-friendly structure to avoid NaN values
      if (window.weatherDataService && typeof window.weatherDataService.formatWeatherData === 'function') {
        this.weatherData = window.weatherDataService.formatWeatherData(raw);
      } else {
        // Fallback: map minimal fields manually
        this.weatherData = {
          location: raw.location,
          temp: raw.temperature,
          tempMax: raw.temp_max,
          tempMin: raw.temp_min,
          humidity: raw.humidity,
          soilMoisture: raw.soil_moisture,
          rainfall: raw.rainfall,
          rainChance: raw.rain_chance,
          windSpeed: raw.wind_speed,
          condition: raw.condition,
          icon: raw.icon,
          forecast: raw.forecast,
        };
      }

      this.lastUpdateTime = new Date().toISOString();
      
      // Calculate GDD
      this.calculateGDD(this.weatherData);
      
      console.log('[AgroWeather] Weather data received:', this.weatherData);
    } catch (error) {
      // Fallback: use mock data if API unavailable (for offline/development)
      console.warn('[AgroWeather] Using mock data:', error.message);
      this.weatherData = this.getMockWeatherData();
      this.calculateGDD(this.weatherData);
    }
  }

  /**
   * Calculate Growing Degree Days (GDD)
   * Formula: ((Tmax + Tmin) / 2) - Tbase
   * Only count days where avg temp > base temp
   */
  calculateGDD(data) {
    if (!data.temp || !data.tempMax || !data.tempMin) {
      console.warn('[AgroWeather] Incomplete temperature data for GDD');
      this.gddAccumulated = 0;
      return;
    }

    const avgTemp = (data.tempMax + data.tempMin) / 2;
    this.gddAccumulated = Math.max(0, avgTemp - this.baseTemp);
    
    console.log(`[AgroWeather] GDD calculated: ${this.gddAccumulated.toFixed(1)}°C`);
  }

  /**
   * Get mock weather data (for demo/offline)
   */
  getMockWeatherData() {
    return {
      location: 'Embu County',
      temp: 24,
      tempMax: 28,
      tempMin: 16,
      humidity: 65,
      soilMoisture: 18,
      rainfall: 2.5,
      rainChance: 30,
      windSpeed: 8,
      condition: 'Partly Cloudy',
      icon: '⛅',
      forecast: [
        { day: 'Mon', high: 27, low: 15, rain: 10, icon: '☀️' },
        { day: 'Tue', high: 26, low: 14, rain: 20, icon: '⛅' },
        { day: 'Wed', high: 25, low: 13, rain: 40, icon: '🌧️' },
        { day: 'Thu', high: 28, low: 16, rain: 5, icon: '☀️' },
        { day: 'Fri', high: 29, low: 17, rain: 0, icon: '☀️' },
      ],
    };
  }

  /**
   * Check if soil moisture is critical
   */
  isMoistureCritical() {
    return this.weatherData && this.weatherData.soilMoisture < this.moistureWarningThreshold;
  }

  /**
   * Get GDD interpretation for maize growth stage
   */
  getGDDStage() {
    const gdd = this.gddAccumulated;
    if (gdd < 50) return { stage: 'Germination', color: 'blue', emoji: '🌱' };
    if (gdd < 200) return { stage: 'Seedling', color: 'green', emoji: '🌿' };
    if (gdd < 400) return { stage: 'Vegetative Growth', color: 'green', emoji: '🌾' };
    if (gdd < 800) return { stage: 'Flowering', color: 'yellow', emoji: '🌻' };
    return { stage: 'Grain Fill', color: 'orange', emoji: '🌽' };
  }

  /**
   * Render the widget UI
   */
  render() {
    if (!this.container) return;

    if (this.isLoading) {
      this.container.innerHTML = this.renderLoading();
      return;
    }

    if (!this.weatherData) {
      this.container.innerHTML = this.renderError('No weather data');
      return;
    }

    const html = this.renderWidget();
    this.container.innerHTML = html;
    
    // Attach event listeners
    this.attachListeners();
  }

  renderLoading() {
    return `
      <div class="agro-weather-loading">
        <div class="agro-weather-spinner"></div>
        <p>Fetching weather data...</p>
      </div>
    `;
  }

  renderError(message) {
    return `
      <div class="agro-weather-error">
        <span class="error-icon">⚠️</span>
        <p>Weather unavailable: ${message}</p>
      </div>
    `;
  }

  renderWidget() {
    const data = this.weatherData;
    const isCritical = this.isMoistureCritical();
    const gddStage = this.getGDDStage();
    const moistureLevel = Math.min(100, Math.max(0, data.soilMoisture || 0));

    return `
      <div class="agro-weather-card">
        <!-- Header with location & timestamp -->
        <div class="agro-weather-header">
          <div class="agro-location">
            <span class="agro-icon">📍</span>
            <div>
              <h3 class="agro-location-name">${data.location || 'Your Farm'}</h3>
              <p class="agro-update-time">Updated ${this.getTimeSince(this.lastUpdateTime)}</p>
            </div>
          </div>
          <button class="agro-refresh-btn" id="agro-refresh" title="Refresh weather">
            🔄
          </button>
        </div>

        <!-- Critical Alerts -->
        ${isCritical ? `
          <div class="agro-alert agro-alert-critical">
            <span class="alert-icon">🚨</span>
            <div class="alert-content">
              <strong>Soil Moisture Critical</strong>
              <p>${data.soilMoisture}% moisture - Irrigation needed immediately</p>
            </div>
          </div>
        ` : ''}

        <!-- Current Conditions Grid -->
        <div class="agro-conditions-grid">
          <!-- Temperature & GDD -->
          <div class="agro-condition-card agro-temp-card">
            <div class="condition-content">
              <div class="condition-icon">${data.icon || '🌡️'}</div>
              <div class="condition-data">
                <div class="condition-temp">
                  <span class="temp-value">${Math.round(data.temp)}°</span>
                  <span class="temp-unit">C</span>
                </div>
                <p class="condition-label">${data.condition}</p>
              </div>
            </div>
            <div class="condition-meta">
              <span class="temp-range">
                <span class="temp-max">${Math.round(data.tempMax)}°</span>
                <span class="meta-sep">/</span>
                <span class="temp-min">${Math.round(data.tempMin)}°</span>
              </span>
            </div>
          </div>

          <!-- GDD Indicator -->
          <div class="agro-condition-card agro-gdd-card">
            <div class="gdd-badge">
              <div class="gdd-icon">${gddStage.emoji}</div>
              <div class="gdd-info">
                <p class="gdd-value">${this.gddAccumulated.toFixed(1)}°</p>
                <p class="gdd-label">GDD</p>
              </div>
            </div>
            <p class="gdd-stage">Stage: ${gddStage.stage}</p>
          </div>

          <!-- Humidity -->
          <div class="agro-condition-card agro-humidity-card">
            <div class="condition-icon">💧</div>
            <div class="condition-data">
              <p class="condition-value">${data.humidity || 0}%</p>
              <p class="condition-label">Humidity</p>
            </div>
          </div>

          <!-- Rainfall -->
          <div class="agro-condition-card agro-rain-card">
            <div class="condition-icon">🌧️</div>
            <div class="condition-data">
              <p class="condition-value">${data.rainfall || 0}mm</p>
              <p class="condition-label">Rainfall</p>
              <p class="rain-chance">${data.rainChance || 0}% today</p>
            </div>
          </div>
        </div>

        <!-- Soil Moisture Meter -->
        <div class="agro-moisture-section">
          <div class="moisture-header">
            <p class="moisture-label">Soil Moisture</p>
            <span class="moisture-value ${isCritical ? 'critical' : ''}">${moistureLevel}%</span>
          </div>
          <div class="moisture-bar">
            <div class="moisture-fill" style="width: ${moistureLevel}%"></div>
          </div>
          <div class="moisture-zones">
            <span class="zone critical" title="Critical">Dry</span>
            <span class="zone warning" title="Warning">Low</span>
            <span class="zone optimal" title="Optimal">Good</span>
            <span class="zone caution" title="High">Wet</span>
          </div>
        </div>

        <!-- 5-Day Forecast -->
        <div class="agro-forecast-section">
          <h4 class="forecast-title">5-Day Outlook</h4>
          <div class="agro-forecast-grid">
            ${data.forecast?.map((day, idx) => `
              <div class="forecast-card">
                <p class="forecast-day">${day.day}</p>
                <div class="forecast-icon">${day.icon}</div>
                <p class="forecast-temp">
                  <span class="forecast-high">${day.high}°</span>
                  <span class="forecast-low">${day.low}°</span>
                </p>
                <p class="forecast-rain">${day.rain}%</p>
              </div>
            `).join('') || ''}
          </div>
        </div>

        <!-- Action Buttons -->
        <div class="agro-actions">
          ${isCritical ? `
            <button class="agro-action-btn agro-btn-urgent" id="agro-irrigate">
              💧 Schedule Irrigation
            </button>
          ` : ''}
          <button class="agro-action-btn agro-btn-secondary" id="agro-details">
            📊 Detailed Analysis
          </button>
        </div>
      </div>
    `;
  }

  /**
   * Get human-readable time since last update
   */
  getTimeSince(isoTime) {
    if (!isoTime) return 'never';
    
    const diff = Date.now() - new Date(isoTime).getTime();
    const minutes = Math.floor(diff / 60000);
    
    if (minutes < 1) return 'just now';
    if (minutes < 60) return `${minutes}m ago`;
    
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    
    const days = Math.floor(hours / 24);
    return `${days}d ago`;
  }

  /**
   * Attach event listeners to interactive elements
   */
  attachListeners() {
    const refreshBtn = document.getElementById('agro-refresh');
    const irrigateBtn = document.getElementById('agro-irrigate');
    const detailsBtn = document.getElementById('agro-details');

    if (refreshBtn) {
      refreshBtn.addEventListener('click', () => {
        this.init(); // Re-fetch weather
      });
    }

    if (irrigateBtn) {
      irrigateBtn.addEventListener('click', () => {
        this.handleIrrigationAlert();
      });
    }

    if (detailsBtn) {
      detailsBtn.addEventListener('click', () => {
        this.handleDetailedAnalysis();
      });
    }
  }

  /**
   * Handle irrigation alert action
   */
  handleIrrigationAlert() {
    console.log('[AgroWeather] Irrigation scheduled');
    const toast = document.createElement('div');
    toast.className = 'agro-toast agro-toast-info';
    toast.innerHTML = `
      <span>💧</span>
      <p>Irrigation reminder set for today</p>
    `;
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 3000);
  }

  /**
   * Handle detailed analysis action
   */
  handleDetailedAnalysis() {
    console.log('[AgroWeather] Showing detailed analysis');
    // TODO: Emit event or navigate to detailed weather page
    const event = new CustomEvent('agro-weather-details', {
      detail: this.weatherData,
    });
    window.dispatchEvent(event);
  }
}

// Auto-init on page load if container exists
window.addEventListener('DOMContentLoaded', () => {
  if (document.getElementById('agro-weather-widget')) {
    window.agroWeatherWidget = new AgroWeatherWidget('agro-weather-widget');
    window.agroWeatherWidget.init();
  }
});
