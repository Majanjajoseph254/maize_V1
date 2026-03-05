/**
 * Weather Data Utility
 * =====================
 * Generic utility for fetching weather data from various sources
 * and transforming it into AgroWeatherWidget-compatible format.
 */

class WeatherDataService {
  constructor() {
    this.apiEndpoint = '/api/weather';
    this.cacheKey = 'weather_cache';
    this.cacheDuration = 30 * 60 * 1000; // 30 minutes
    this.cache = null;
    this.cacheTime = null;
  }

  /**
   * Fetch weather data with caching
   */
  async fetchWeatherData(lat = null, lon = null) {
    // Check cache first
    if (this.cache && this.isCacheValid()) {
      console.log('[Weather] Using cached data');
      return this.cache;
    }

    try {
      const params = new URLSearchParams();
      if (lat !== null) params.append('lat', lat);
      if (lon !== null) params.append('lon', lon);

      const url = params.toString() ? `${this.apiEndpoint}?${params}` : this.apiEndpoint;
      const response = await fetch(url);

      if (!response.ok) {
        throw new Error(`Weather API returned ${response.status}`);
      }

      const data = await response.json();
      this.cache = data;
      this.cacheTime = Date.now();

      console.log('[Weather] Data fetched and cached');
      return data;
    } catch (error) {
      console.error('[Weather] Fetch failed:', error);
      throw error;
    }
  }

  /**
   * Check if cache is still valid
   */
  isCacheValid() {
    return this.cache && this.cacheTime && (Date.now() - this.cacheTime < this.cacheDuration);
  }

  /**
   * Clear cache
   */
  clearCache() {
    this.cache = null;
    this.cacheTime = null;
    console.log('[Weather] Cache cleared');
  }

  /**
   * Format weather data for display
   */
  formatWeatherData(rawData) {
    return {
      location: rawData.location || 'Farm Location',
      temp: Math.round(rawData.temperature || 20),
      tempMax: Math.round(rawData.temp_max || 25),
      tempMin: Math.round(rawData.temp_min || 15),
      humidity: Math.round(rawData.humidity || 60),
      soilMoisture: Math.round(rawData.soil_moisture || 50),
      rainfall: parseFloat(rawData.rainfall || 0).toFixed(1),
      rainChance: Math.round(rawData.rain_chance || 0),
      windSpeed: Math.round(rawData.wind_speed || 5),
      condition: rawData.condition || 'Clear',
      icon: this.getWeatherIcon(rawData.condition),
      forecast: rawData.forecast || [],
    };
  }

  /**
   * Map weather condition to emoji icon
   */
  getWeatherIcon(condition) {
    const conditionLower = (condition || '').toLowerCase();

    if (conditionLower.includes('clear') || conditionLower.includes('sunny')) return '☀️';
    if (conditionLower.includes('cloud')) return '☁️';
    if (conditionLower.includes('rain')) return '🌧️';
    if (conditionLower.includes('thunder') || conditionLower.includes('storm')) return '⛈️';
    if (conditionLower.includes('wind')) return '💨';
    if (conditionLower.includes('snow')) return '❄️';
    if (conditionLower.includes('fog') || conditionLower.includes('mist')) return '🌫️';

    return '⛅'; // Default
  }
}

// Global instance
window.weatherDataService = new WeatherDataService();
