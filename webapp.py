"""
KilimoSmart Maize – Flask Web Application
==========================================
Modern web UI with REST API endpoints wrapping the existing
vision, market, and geo utility modules.
"""

from __future__ import annotations

import json
import pathlib
import base64
import io
import logging
import os
from functools import wraps

from flask import Flask, render_template, request, jsonify, session, send_file, make_response, redirect, url_for
from flask_sqlalchemy import SQLAlchemy
from flask_login import LoginManager, UserMixin, login_user, logout_user, login_required, current_user
from PIL import Image
from sqlalchemy import inspect, text
from werkzeug.utils import secure_filename
from werkzeug.security import generate_password_hash, check_password_hash
from datetime import datetime, timedelta
import secrets
import hashlib
import pyotp
import qrcode

from utils.vision_tools import diagnose_leaf_disease
from utils.geo_tools import find_nearest_miller
from utils.market_tools import negotiate_price

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = Flask(
    __name__,
    template_folder="templates",
    static_folder="static",
)
app.secret_key = "kilimosmart-secret-key-2026"
app.config["MAX_CONTENT_LENGTH"] = 10 * 1024 * 1024  # 10 MB upload limit
app.config["SQLALCHEMY_DATABASE_URI"] = "sqlite:///kilimosmart.db"
app.config["SQLALCHEMY_TRACK_MODIFICATIONS"] = False
app.config["SESSION_COOKIE_SECURE"] = False  # Set True in production with HTTPS
app.config["SESSION_COOKIE_HTTPONLY"] = True
app.config["SESSION_COOKIE_SAMESITE"] = "Lax"
app.config["PERMANENT_SESSION_LIFETIME"] = timedelta(days=7)
ALLOWED_EXTENSIONS = {"jpg", "jpeg", "png", "webp"}
PROFILE_UPLOAD_DIR = pathlib.Path("static/uploads/profiles")
MAX_PROFILE_PHOTO_BYTES = 2 * 1024 * 1024

# Initialize database
db = SQLAlchemy(app)

# Initialize Flask-Login
login_manager = LoginManager()
login_manager.init_app(app)
login_manager.login_view = "login"

# ── User Model for Authentication ─────────────────────────────────────────
class User(UserMixin, db.Model):
    """Farmer user account with authentication"""
    id = db.Column(db.Integer, primary_key=True)
    email = db.Column(db.String(120), unique=True, nullable=False, index=True)
    password_hash = db.Column(db.String(255), nullable=False)
    name = db.Column(db.String(120), nullable=False)
    county = db.Column(db.String(120), default="Kiambu")
    acres = db.Column(db.Float, default=5.0)
    phone = db.Column(db.String(20), default="")
    profile_photo = db.Column(db.String(255), default="")
    totp_secret = db.Column(db.String(32), nullable=True)  # TOTP secret key
    totp_enabled = db.Column(db.Boolean, default=False)    # 2FA status
    reset_token_hash = db.Column(db.String(64), nullable=True, index=True)
    reset_token_expires_at = db.Column(db.DateTime, nullable=True)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    def set_password(self, password: str):
        """Hash and set password"""
        self.password_hash = generate_password_hash(password, method='pbkdf2:sha256')

    def check_password(self, password: str) -> bool:
        """Verify password against hash"""
        return check_password_hash(self.password_hash, password)

    def generate_totp_secret(self) -> str:
        """Generate a new TOTP secret for 2FA"""
        secret = pyotp.random_base32()
        self.totp_secret = secret
        return secret

    def get_totp_provisioning_uri(self) -> str:
        """Get the provisioning URI for QR code (otpauth://...)"""
        if not self.totp_secret:
            self.generate_totp_secret()
        totp = pyotp.TOTP(self.totp_secret)
        return totp.provisioning_uri(
            name=self.email,
            issuer_name='KilimoSmart'
        )

    def verify_totp(self, token: str) -> bool:
        """Verify a TOTP token (6-digit code)"""
        if not self.totp_secret:
            return False
        try:
            totp = pyotp.TOTP(self.totp_secret)
            # Allow ±1 time window for time sync issues
            return totp.verify(token, valid_window=1)
        except Exception as e:
            logger.error(f"[2FA] TOTP verification error: {e}")
            return False

    def generate_reset_token(self, expires_in_minutes: int = 15) -> str:
        """
        Generate a high-entropy password reset token and store its hash + expiry.
        Returns the raw token (to be sent via email).
        """
        raw_token = secrets.token_urlsafe(32)  # ~256-bit entropy
        token_hash = hashlib.sha256(raw_token.encode("utf-8")).hexdigest()
        self.reset_token_hash = token_hash
        self.reset_token_expires_at = datetime.utcnow() + timedelta(minutes=expires_in_minutes)
        return raw_token

    def verify_reset_token(self, raw_token: str) -> bool:
        """Check that the provided raw token matches the stored hash and is not expired."""
        if not raw_token or not self.reset_token_hash or not self.reset_token_expires_at:
            return False
        token_hash = hashlib.sha256(raw_token.encode("utf-8")).hexdigest()
        if token_hash != self.reset_token_hash:
            return False
        if datetime.utcnow() > self.reset_token_expires_at:
            return False
        return True

    def clear_reset_token(self) -> None:
        """Invalidate any existing password reset token."""
        self.reset_token_hash = None
        self.reset_token_expires_at = None

    def to_dict(self) -> dict:
        """Return user data as dict"""
        return {
            'id': self.id,
            'email': self.email,
            'name': self.name,
            'county': self.county,
            'acres': self.acres,
            'phone': self.phone,
            'profile_photo_url': self.profile_photo or '',
            'totp_enabled': self.totp_enabled,
        }

@login_manager.user_loader
def load_user(user_id: int):
    """Flask-Login user loader callback"""
    return User.query.get(int(user_id))


def _allowed_file(filename: str) -> bool:
    return "." in filename and filename.rsplit(".", 1)[1].lower() in ALLOWED_EXTENSIONS


def _is_safe_url(url: str) -> bool:
    """Check if URL is safe redirect target (relative path only)."""
    if not url:
        return False
    # Only allow relative paths starting with /
    if url.startswith("/") and not url.startswith("//") and not url.startswith("http"):
        return True
    return False


def _ensure_schema_columns() -> None:
    """Add new columns on existing SQLite DBs without destructive migrations."""
    PROFILE_UPLOAD_DIR.mkdir(parents=True, exist_ok=True)

    try:
        table_names = set(inspect(db.engine).get_table_names())
        if "user" not in table_names:
            return

        columns = {col["name"] for col in inspect(db.engine).get_columns("user")}
        statements: list[str] = []

        if "profile_photo" not in columns:
            statements.append("ALTER TABLE user ADD COLUMN profile_photo VARCHAR(255)")

        for statement in statements:
            db.session.execute(text(statement))

        if statements:
            db.session.commit()
            logger.info("[DB] Applied lightweight schema migration for User table")
    except Exception as exc:
        db.session.rollback()
        logger.error("[DB] Schema migration check failed: %s", exc)


def _build_mvp_summary(diagnosis: str, severity: str, confidence: float) -> str:
    """Return a human-friendly diagnosis summary for farmer-facing report cards."""
    sev = str(severity or "low").upper()
    pct = round(float(confidence or 0) * 100, 1)
    return f"Detected {diagnosis} with {pct}% confidence. Severity is {sev}."

# ── Load bilingual labels ─────────────────────────────────────────────────
LABELS_PATH = pathlib.Path("assets/sw_labels.json")
with open(LABELS_PATH, encoding="utf-8") as f:
    LABELS = json.load(f)

# ── Load treatments ───────────────────────────────────────────────────────
TREATMENTS_PATH = pathlib.Path("data/treatments.json")
with open(TREATMENTS_PATH, encoding="utf-8") as f:
    TREATMENTS = json.load(f)

# ── Load millers data ─────────────────────────────────────────────────────
import pandas as pd

_MILLERS_CSV = "data/millers.csv"


def _millers_as_native_dicts():
    """Return all millers as a list[dict] with native Python types."""
    df = pd.read_csv(_MILLERS_CSV, dtype={"contact": str})
    records = df.to_dict(orient="records")
    return [
        {k: (v.item() if hasattr(v, "item") else v) for k, v in row.items()}
        for row in records
    ]


# ── Routes ────────────────────────────────────────────────────────────────

@app.route("/api/health")
def health():
    """Simple health-check endpoint."""
    return jsonify({"status": "ok", "service": "KilimoSmart Maize MVP"})


@app.route("/")
def index():
    """Serve the single-page application."""
    return render_template("index.html")


@app.route("/manifest.json")
def manifest():
    """Serve the Web App Manifest for PWA support."""
    with open("manifest.json", "r", encoding="utf-8") as f:
        manifest_data = json.load(f)
    response = make_response(jsonify(manifest_data))
    response.headers["Content-Type"] = "application/manifest+json"
    response.cache_control.max_age = 86400  # Cache for 1 day
    return response


@app.after_request
def set_cache_headers(response):
    """
    Set cache headers for static assets to maximize offline efficiency.
    - Static assets (CSS, JS, images): 30 days
    - API responses: no cache (always fresh)
    - HTML pages: 1 hour (to allow updates while respecting offline)
    """
    if request.path.startswith("/static/"):
        response.cache_control.max_age = 2592000  # 30 days
        response.cache_control.public = True
    elif request.path.startswith("/api/"):
        response.cache_control.no_cache = True
        response.cache_control.must_revalidate = True
    elif request.path.endswith(".html") or request.path == "/":
        response.cache_control.max_age = 3600  # 1 hour for pages
    return response


@app.route("/api/labels/<lang>")
def get_labels(lang):
    """Return UI labels for the given language."""
    if lang not in LABELS:
        lang = "en"
    return jsonify(LABELS[lang])


@app.route("/api/diagnose", methods=["POST"])
def diagnose():
    """
    Accept an uploaded image, run class-first leaf filtering + disease analysis.
    Expects multipart form with 'image' file field.
    """
    if "image" not in request.files:
        return jsonify({"error": "No image provided"}), 400

    file = request.files["image"]
    if file.filename == "" or not _allowed_file(file.filename):
        return jsonify({"error": "Invalid file. Accepted formats: JPG, PNG, WEBP"}), 400

    try:
        debug = request.args.get("debug", "0").strip().lower() in {"1", "true", "yes", "on"}
        img = Image.open(file.stream).convert("RGB")
        raw_result = diagnose_leaf_disease(img, include_internal_scores=debug)

        # Preserve searching/rejected payload contract for low-confidence frames.
        if raw_result.get("status") in {"searching", "rejected"}:
            return jsonify(raw_result)

        diagnosis_name = str(raw_result.get("diagnosis") or "Unknown")
        confidence = float(raw_result.get("confidence") or 0.0)
        severity = str(raw_result.get("severity") or "low")
        treatment_data = TREATMENTS.get(diagnosis_name, {})

        payload = {
            "status": "success",
            "diagnosis": diagnosis_name,
            "confidence": round(confidence, 4),
            "severity": severity,
            "analyzed_at": datetime.utcnow().isoformat() + "Z",
            "mvp_summary": _build_mvp_summary(diagnosis_name, severity, confidence),
        }

        if "detected_object" in raw_result:
            payload["detected_object"] = raw_result["detected_object"]

        if treatment_data.get("sw_name"):
            payload["disease_sw"] = treatment_data["sw_name"]

        if treatment_data.get("medication") or treatment_data.get("prevention"):
            payload["treatment"] = {
                "medication": treatment_data.get("medication", "Not specified"),
                "prevention": treatment_data.get("prevention", "Not specified"),
            }

        if debug and raw_result.get("internal_scores"):
            payload["internal_scores"] = raw_result["internal_scores"]

        return jsonify(payload)
    except Exception as e:
        logger.exception("Diagnosis failed")
        return jsonify({"error": str(e)}), 500


@app.route("/api/market", methods=["POST"])
def market():
    """
    Get market price & nearest miller for a given disease/location.
    Expects JSON: {disease, lat, lon, lang}
    """
    data = request.get_json(force=True)
    disease = data.get("disease", "Healthy")
    lat = data.get("lat", -1.2995)
    lon = data.get("lon", 36.8400)
    lang = data.get("lang", "en")

    try:
        miller = find_nearest_miller(lat, lon)
        grade, final_price, explanation = negotiate_price(
            miller["base_price_kes"], disease, lang=lang,
        )
        return jsonify({
            "miller": {
                "name": miller["name"],
                "location": miller["location"],
                "contact": miller["contact"],
                "distance_km": miller.get("distance_km", "—"),
                "base_price": miller["base_price_kes"],
            },
            "grade": grade,
            "final_price": final_price,
            "explanation": explanation,
        })
    except Exception as e:
        logger.exception("Market lookup failed")
        return jsonify({"error": str(e)}), 500


@app.route("/api/millers", methods=["GET"])
def get_millers():
    """Return all millers with optional location-based sorting."""
    lat = request.args.get("lat", type=float)
    lon = request.args.get("lon", type=float)

    if lat is not None and lon is not None:
        millers = find_nearest_miller(lat, lon, top_n=8)
        if isinstance(millers, dict):
            millers = [millers]
    else:
        millers = _millers_as_native_dicts()

    return jsonify(millers)


@app.route("/api/weather", methods=["GET"])
def get_weather():
    """
    Return real weather data from OpenWeather API for AgroWeatherWidget.
    Implements smart caching (30min TTL) to respect rate limits.
    
    Optional query params:
    - lat: latitude (default: -0.35 for Embu, Kenya)
    - lon: longitude (default: 37.45 for Embu, Kenya)  
    - county: county name for display only
    - force_refresh: set to 'true' to bypass cache
    
    Returns: {
        location, temperature, temp_max, temp_min, humidity, soil_moisture,
        rainfall, rain_chance, wind_speed, condition, icon, forecast[],
        cached: bool, cache_age_minutes: int
    }
    """
    import requests
    from datetime import datetime, timedelta
    import time
    
    # Default coordinates: Embu, Kenya (agricultural region)
    lat = float(request.args.get("lat", "-0.35"))
    lon = float(request.args.get("lon", "37.45"))
    county = request.args.get("county", "Embu")
    force_refresh = request.args.get("force_refresh", "false").lower() == "true"
    
    # Cache key and checking
    cache_key = f"weather_{lat}_{lon}"
    if cache_key not in app.config:
        app.config[cache_key] = {"data": None, "timestamp": 0}
    
    cache = app.config[cache_key]
    now = time.time()
    cache_age = (now - cache["timestamp"]) / 60  # minutes
    cache_ttl = 30  # minutes
    
    # Return cached data if fresh (and not forced refresh)
    if not force_refresh and cache["data"] and cache_age < cache_ttl:
        result = cache["data"].copy()
        result["cached"] = True
        result["cache_age_minutes"] = int(cache_age)
        return jsonify(result)
    
    try:
        # Fetch from OpenWeather API (free tier, no key required)
        # Using Open-Meteo (alternative free provider, no rate limits)
        url = f"https://api.open-meteo.com/v1/forecast"
        params = {
            "latitude": lat,
            "longitude": lon,
            "current": "temperature_2m,relative_humidity_2m,weather_code,wind_speed_10m,precipitation,rain",
            "hourly": "temperature_2m,precipitation_probability",
            "daily": "weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum,precipitation_probability_max",
            "temperature_unit": "celsius",
            "wind_speed_unit": "kmh",
            "timezone": "Africa/Nairobi",
        }
        
        response = requests.get(url, params=params, timeout=5)
        response.raise_for_status()
        data = response.json()
        
        # Extract current weather
        current = data.get("current", {})
        daily = data.get("daily", {})
        
        temp = float(current.get("temperature_2m", 23))
        humidity = int(current.get("relative_humidity_2m", 60))
        wind_speed = float(current.get("wind_speed_10m", 8))
        rainfall = float(current.get("precipitation", 0))
        weather_code = current.get("weather_code", 0)
        
        # Map WMO weather codes to readable conditions & icons
        weather_map = {
            0: ("Clear Sky", "☀️"),
            1: ("Mostly Clear", "☀️"),
            2: ("Partly Cloudy", "⛅"),
            3: ("Overcast", "☁️"),
            45: ("Foggy", "🌫️"),
            48: ("Foggy", "🌫️"),
            51: ("Light Drizzle", "🌧️"),
            53: ("Moderate Drizzle", "🌧️"),
            55: ("Dense Drizzle", "🌧️"),
            61: ("Slight Rain", "🌧️"),
            63: ("Moderate Rain", "🌧️"),
            65: ("Heavy Rain", "⛈️"),
            71: ("Slight Snow", "🌨️"),
            73: ("Moderate Snow", "🌨️"),
            75: ("Heavy Snow", "🌨️"),
            77: ("Snow Grains", "🌨️"),
            80: ("Slight Rain Showers", "🌧️"),
            81: ("Moderate Rain Showers", "🌧️"),
            82: ("Violent Rain Showers", "⛈️"),
            85: ("Slight Snow Showers", "🌨️"),
            86: ("Heavy Snow Showers", "🌨️"),
            95: ("Thunderstorm", "⛈️"),
            96: ("Thunderstorm with Hail", "⛈️"),
            99: ("Thunderstorm with Hail", "⛈️"),
        }
        condition, icon = weather_map.get(weather_code, ("Unknown", "❓"))
        
        # Estimate soil moisture from humidity & rainfall
        # Formula: SM% ≈ (humidity% × 0.7) + (rainfall_mm × 2)
        # Clamps between 0-100%
        estimated_sm = min(100, (humidity * 0.7) + (rainfall * 2))
        
        # Parse daily forecast
        dates = daily.get("time", [])
        temps_max = daily.get("temperature_2m_max", [])
        temps_min = daily.get("temperature_2m_min", [])
        weather_codes = daily.get("weather_code", [])
        rain_chances = daily.get("precipitation_probability_max", [])
        
        forecast = []
        for i in range(1, min(6, len(dates))):  # 5-day forecast
            day_date = datetime.fromisoformat(dates[i])
            day_name = day_date.strftime("%a")
            temp_high = int(temps_max[i])
            temp_low = int(temps_min[i])
            rain_chance = rain_chances[i] if i < len(rain_chances) else 0
            code = weather_codes[i] if i < len(weather_codes) else 0
            _, day_icon = weather_map.get(code, ("", "⛅"))
            
            forecast.append({
                "day": day_name,
                "high": temp_high,
                "low": temp_low,
                "rain": rain_chance,
                "icon": day_icon,
            })
        
        # Build response
        weather = {
            "location": county,
            "temperature": round(temp, 1),
            "temp_max": round(float(temps_max[0]) if temps_max else temp + 5, 1),
            "temp_min": round(float(temps_min[0]) if temps_min else temp - 5, 1),
            "humidity": humidity,
            "soil_moisture": round(estimated_sm, 1),
            "rainfall": round(rainfall, 1),
            "rain_chance": int(rain_chances[0] if rain_chances else 0),
            "wind_speed": round(wind_speed, 1),
            "condition": condition,
            "icon": icon,
            "forecast": forecast,
            "cached": False,
            "cache_age_minutes": 0,
            "data_source": "Open-Meteo (Open Weather Data)",
        }
        
        # Cache the result
        cache["data"] = weather.copy()
        cache["timestamp"] = now
        
        return jsonify(weather)
        
    except requests.exceptions.RequestException as e:
        print(f"[API] Weather API error: {e}")
        
        # Fallback to cached data even if expired
        if cache["data"]:
            result = cache["data"].copy()
            result["cached"] = True
            result["cache_age_minutes"] = int(cache_age)
            result["data_source"] = "Cached data (API unavailable)"
            return jsonify(result), 200
        
        # Ultimate fallback: return generic safe weather
        return jsonify({
            "location": county,
            "temperature": 23,
            "temp_max": 28,
            "temp_min": 18,
            "humidity": 60,
            "soil_moisture": 50,
            "rainfall": 0,
            "rain_chance": 0,
            "wind_speed": 8,
            "condition": "Data Unavailable",
            "icon": "❓",
            "forecast": [
                {"day": (datetime.now() + timedelta(days=i)).strftime("%a"), "high": 25, "low": 18, "rain": 20, "icon": "⛅"}
                for i in range(1, 6)
            ],
            "cached": False,
            "cache_age_minutes": 0,
            "data_source": "Offline fallback",
            "error": str(e),
        }), 206  # 206 = Partial Content


# ── 2FA (Two-Factor Authentication) Decorator ──────────────────────────────

def tfa_required(f):
    """Decorator to require 2FA verification for sensitive operations"""
    @wraps(f)
    def decorated_function(*args, **kwargs):
        if not current_user.is_authenticated:
            return redirect(url_for("login"))
        
        # Check if user has 2FA enabled and verified in session
        if current_user.totp_enabled and not session.get("2fa_verified"):
            return redirect(url_for("verify_2fa", next=request.path))
        
        return f(*args, **kwargs)
    
    return decorated_function


# ── Authentication Routes ─────────────────────────────────────────────────

@app.route("/login", methods=["GET", "POST"])
def login():
    """Login page and endpoint"""
    if current_user.is_authenticated:
        return redirect(url_for("dashboard"))
    
    if request.method == "POST":
        data = request.get_json() or request.form
        email = data.get("email", "").lower().strip()
        password = data.get("password", "")
        remember = request.form.get("remember_me") == "on" or data.get("remember_me", False)
        
        if not email or not password:
            return (
                jsonify({"error": "Email and password required"}),
                400,
            ) if request.is_json else make_response(
                render_template("login.html", error="Email and password required"),
                400
            )
        
        user = User.query.filter_by(email=email).first()
        
        if user is None or not user.check_password(password):
            return (
                jsonify({"error": "Invalid email or password"}),
                401,
            ) if request.is_json else make_response(
                render_template("login.html", error="Invalid email or password"),
                401
            )
        
        session.permanent = True
        login_user(user, remember=remember)
        logger.info(f"[Auth] User logged in: {email}")
        
        # Get safe next URL
        next_page = request.args.get("next") or data.get("next")
        next_page = next_page if _is_safe_url(next_page) else None
        
        # Route based on 2FA status
        if user.totp_enabled:
            redirect_url = url_for("verify_2fa", next=next_page) if next_page else url_for("verify_2fa")
            return jsonify({"success": True, "redirect": redirect_url}) if request.is_json else redirect(redirect_url)
        else:
            redirect_url = url_for("setup_2fa", next=next_page) if next_page else url_for("setup_2fa")
            return jsonify({"success": True, "redirect": redirect_url}) if request.is_json else redirect(redirect_url)
    
    return render_template("login.html")


@app.route("/register", methods=["GET", "POST"])
def register():
    """Registration page and endpoint"""
    if current_user.is_authenticated:
        return redirect(url_for("dashboard"))
    
    if request.method == "POST":
        data = request.get_json() or request.form
        email = data.get("email", "").lower().strip()
        password = data.get("password", "")
        confirm_password = data.get("confirm_password", "")
        name = data.get("name", "").strip()
        county = data.get("county", "Kiambu").strip()
        
        # Validation
        if not email or not password or not name:
            error = "Email, password, and name are required"
            return (
                jsonify({"error": error}),
                400,
            ) if request.is_json else make_response(
                render_template("register.html", error=error),
                400
            )
        
        if password != confirm_password:
            error = "Passwords don't match"
            return (
                jsonify({"error": error}),
                400,
            ) if request.is_json else make_response(
                render_template("register.html", error=error),
                400
            )
        
        # Enforce strong password policy (align with reset policy)
        ok, policy_error = _password_meets_policy(password)
        if not ok:
            return (
                jsonify({"error": policy_error}),
                400,
            ) if request.is_json else make_response(
                render_template("register.html", error=policy_error),
                400
            )
        
        # Check if user exists
        if User.query.filter_by(email=email).first():
            error = "Email already registered"
            return (
                jsonify({"error": error}),
                409,
            ) if request.is_json else make_response(
                render_template("register.html", error=error),
                409
            )
        
        # Create new user
        user = User(
            email=email,
            name=name,
            county=county,
            acres=5.0,
        )
        user.set_password(password)
        db.session.add(user)
        db.session.commit()
        
        logger.info(f"[Auth] New user registered: {email}")
        
        # Auto-login
        login_user(user)
        
        return (
            jsonify({"success": True, "redirect": "/2fa/setup"})
        ) if request.is_json else redirect(url_for("setup_2fa"))
    
    return render_template("register.html")


@app.route("/logout")
@login_required
def logout():
    """Logout user and clear all auth state"""
    email = current_user.email
    logout_user()
    session.clear()  # Clear auth + 2FA verification + all session state
    logger.info(f"[Auth] User logged out: {email}")
    return redirect(url_for("login"))


# ── Two-Factor Authentication Routes ───────────────────────────────────────

@app.route("/2fa/setup", methods=["GET", "POST"])
@login_required
def setup_2fa():
    """Setup 2FA: Generate secret (once per session) and show QR code"""
    if request.method == "POST":
        try:
            # Only generate secret if user doesn't already have one in this session
            if not current_user.totp_secret:
                secret = current_user.generate_totp_secret()
                db.session.commit()
            
            provisioning_uri = current_user.get_totp_provisioning_uri()
            logger.info(f"[2FA] Setup initiated for user: {current_user.email}")
            
            return jsonify({
                "success": True,
                "secret": current_user.totp_secret,
                "provisioning_uri": provisioning_uri,
                "qr_code_url": url_for("get_qr_code", secret=current_user.totp_secret),
            })
        except Exception as e:
            logger.error(f"[2FA] Setup error: {e}")
            return jsonify({"error": str(e)}), 400
    
    # GET: Show setup page
    return render_template("setup-2fa.html", user_email=current_user.email)


@app.route("/2fa/qrcode")
def get_qr_code():
    """Generate QR code image for TOTP"""
    try:
        secret = request.args.get("secret", "")
        if not secret:
            return jsonify({"error": "Secret required"}), 400
        
        # Create QR code
        provisioning_uri = pyotp.TOTP(secret).provisioning_uri(
            name=current_user.email if current_user.is_authenticated else "KilimoSmart",
            issuer_name="KilimoSmart"
        )
        
        qr = qrcode.QRCode(
            version=1,
            error_correction=qrcode.constants.ERROR_CORRECT_L,
            box_size=10,
            border=4,
        )
        qr.add_data(provisioning_uri)
        qr.make(fit=True)
        
        img = qr.make_image(fill_color="black", back_color="white")
        
        # Save to bytes buffer
        buf = io.BytesIO()
        img.save(buf, format="PNG")
        buf.seek(0)
        
        return send_file(buf, mimetype="image/png")
    except Exception as e:
        logger.error(f"[2FA] QR code generation error: {e}")
        return jsonify({"error": str(e)}), 500


@app.route("/2fa/verify", methods=["GET", "POST"])
@login_required
def verify_2fa():
    """Verify 2FA code and set session"""
    if request.method == "POST":
        data = request.get_json() or request.form
        code = data.get("code", "").strip()
        
        if not code or len(code) != 6:
            return (
                jsonify({"error": "Invalid code format. Enter 6 digits."}),
                400,
            ) if request.is_json else make_response(
                render_template("verify-2fa.html", error="Invalid code format. Enter 6 digits."),
                400
            )
        
        if not current_user.verify_totp(code):
            logger.warning(f"[2FA] Invalid or expired TOTP code for user: {current_user.email}")
            message = "Code expired or clock desync detected. Please open your authenticator app and try a fresh code."
            return (
                jsonify({"error": message}),
                401,
            ) if request.is_json else make_response(
                render_template("verify-2fa.html", error=message),
                401
            )
        
        # Mark 2FA as verified in session
        session["2fa_verified"] = True
        
        # If first-time setup, enable 2FA permanently
        if not current_user.totp_enabled:
            current_user.totp_enabled = True
            db.session.commit()
            logger.info(f"[2FA] 2FA enabled for user: {current_user.email}")
        
        # Get safe next URL
        next_page = request.args.get("next") or data.get("next")
        redirect_to = next_page if _is_safe_url(next_page) else url_for("dashboard")
        
        logger.info(f"[2FA] Verification successful: {current_user.email}")
        
        return (
            jsonify({"success": True, "redirect": redirect_to})
        ) if request.is_json else redirect(redirect_to)
    
    # GET: Show verification page
    return render_template("verify-2fa.html")


@app.route("/api/user")
@login_required
def get_current_user():
    """Get current authenticated user info"""
    return jsonify(current_user.to_dict())


@app.route("/api/user", methods=["PUT"])
@login_required
def update_user():
    """Update user profile"""
    try:
        data = request.get_json(force=True) or {}
        
        if "name" in data:
            current_user.name = data["name"].strip()
        if "county" in data:
            current_user.county = data["county"].strip()
        if "acres" in data:
            current_user.acres = float(data["acres"])
        if "phone" in data:
            current_user.phone = data["phone"].strip()
        
        db.session.commit()
        logger.info(f"[Auth] User profile updated: {current_user.email}")
        
        return jsonify({"success": True, "user": current_user.to_dict()})
    except Exception as e:
        logger.error(f"[Auth] Profile update failed: {e}")
        return jsonify({"error": str(e)}), 400


@app.route("/api/user/photo", methods=["POST"])
@login_required
def upload_profile_photo():
    """Upload and persist a farmer profile image."""
    if "photo" not in request.files:
        return jsonify({"error": "No photo provided"}), 400

    photo = request.files["photo"]
    if not photo or photo.filename == "":
        return jsonify({"error": "Invalid photo upload"}), 400

    if not _allowed_file(photo.filename):
        return jsonify({"error": "Invalid file. Accepted formats: JPG, PNG, WEBP"}), 400

    photo.stream.seek(0, os.SEEK_END)
    file_size = photo.stream.tell()
    photo.stream.seek(0)
    if file_size > MAX_PROFILE_PHOTO_BYTES:
        return jsonify({"error": "Photo too large. Max size is 2 MB."}), 400

    PROFILE_UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
    ext = pathlib.Path(secure_filename(photo.filename)).suffix.lower() or ".jpg"
    filename = f"user_{current_user.id}_{int(datetime.utcnow().timestamp())}_{secrets.token_hex(4)}{ext}"
    destination = PROFILE_UPLOAD_DIR / filename

    # Replace prior profile image to keep storage bounded.
    if current_user.profile_photo:
        old_path = pathlib.Path(current_user.profile_photo.lstrip("/"))
        old_path_str = old_path.as_posix()
        upload_dir_str = PROFILE_UPLOAD_DIR.as_posix()
        if old_path.exists() and old_path.is_file() and old_path_str.startswith(upload_dir_str):
            old_path.unlink(missing_ok=True)

    photo.save(destination)
    current_user.profile_photo = f"/static/uploads/profiles/{filename}"
    db.session.commit()

    return jsonify({
        "success": True,
        "profile_photo_url": current_user.profile_photo,
        "user": current_user.to_dict(),
    })


def _send_password_reset_email(user: User, raw_token: str) -> None:
    """
    Send a password reset email.
    In this MVP we log the reset URL instead of integrating SMTP.
    """
    reset_url = url_for("reset_password", token=raw_token, _external=True)
    logger.info("[Auth] Password reset link for %s: %s", user.email, reset_url)


@app.route("/api/auth/forgot-password", methods=["POST"])
def api_forgot_password():
    """
    JSON API to initiate password reset.
    Always returns success message to avoid email enumeration.
    """
    try:
        data = request.get_json(force=True) or {}
    except Exception:
        data = {}

    email = (data.get("email") or "").strip().lower()

    if email:
        user = User.query.filter_by(email=email).first()
        if user:
            try:
                token = user.generate_reset_token(expires_in_minutes=15)
                db.session.commit()
                _send_password_reset_email(user, token)
            except Exception as e:
                logger.error("[Auth] Failed to generate password reset token: %s", e)

    # Always respond with generic success
    return jsonify(
        {
            "success": True,
            "message": "If that email exists in our system, a reset link has been sent and will expire in 15 minutes.",
        }
    )


@app.route("/forgot-password", methods=["GET"])
def forgot_password():
    """Public HTML page to request a password reset link."""
    if current_user.is_authenticated:
        return redirect(url_for("dashboard"))
    return render_template("forgot-password.html")


def _password_meets_policy(password: str) -> tuple[bool, str | None]:
    """Server-side password policy for resets (8+, uppercase, number, special)."""
    if len(password) < 8:
        return False, "Password must be at least 8 characters long."
    if not any(c.isupper() for c in password):
        return False, "Password must include at least one uppercase letter."
    if not any(c.isdigit() for c in password):
        return False, "Password must include at least one number."
    if not any(c in "!@#$%^&*(),.?\":{}|<>" for c in password):
        return False, "Password must include at least one special character."
    return True, None


@app.route("/reset-password/<token>", methods=["GET", "POST"])
def reset_password(token: str):
    """
    Password reset page.
    Validates the token against the stored hash and expiry and enforces strong passwords.
    Respects 2FA policy after reset.
    """
    if current_user.is_authenticated:
        return redirect(url_for("dashboard"))

    # Find user by token hash
    token_hash = hashlib.sha256(token.encode("utf-8")).hexdigest()
    user = User.query.filter_by(reset_token_hash=token_hash).first()

    if not user or not user.verify_reset_token(token):
        error = "This reset link is invalid or has expired. Please request a new one."
        return render_template("reset-password.html", error=error, token=None)

    if request.method == "POST":
        data = request.form or request.get_json() or {}
        new_password = (data.get("password") or "").strip()
        confirm_password = (data.get("confirm_password") or "").strip()

        if not new_password or not confirm_password:
            error = "Please enter and confirm your new password."
            return render_template("reset-password.html", error=error, token=token)

        if new_password != confirm_password:
            error = "Passwords do not match."
            return render_template("reset-password.html", error=error, token=token)

        ok, policy_error = _password_meets_policy(new_password)
        if not ok:
            return render_template("reset-password.html", error=policy_error, token=token)

        user.set_password(new_password)
        user.clear_reset_token()
        db.session.commit()
        logger.info("[Auth] Password reset successful for user: %s", user.email)

        # Auto-login user after reset
        login_user(user)
        
        # Respect 2FA policy - require verify/setup
        if user.totp_enabled:
            return redirect(url_for("verify_2fa"))
        else:
            return redirect(url_for("setup_2fa"))

    # GET: render reset form
    return render_template("reset-password.html", token=token)


# ── Protected Routes ──────────────────────────────────────────────────────

@app.before_request
def before_request():
    """Check authentication and 2FA before serving pages"""
    if not app.config.get("_schema_checked"):
        _ensure_schema_columns()
        app.config["_schema_checked"] = True

    # Allow public routes (including auth routes)
    public_routes = {
        "login", "register", "static", "health", "get_qr_code",
        "forgot_password", "reset_password", "api_forgot_password"
    }
    
    if request.endpoint in public_routes:
        return
    
    # Allow 2FA setup/verify for authenticated users even if not yet verified
    if request.endpoint in {"setup_2fa", "verify_2fa"} and current_user.is_authenticated:
        return
    
    # Require authentication for all other routes
    if not current_user.is_authenticated:
        return redirect(url_for("login", next=request.path))
    
    # Enforce 2FA verification if user has 2FA enabled
    if current_user.totp_enabled and not session.get("2fa_verified"):
        # User has 2FA enabled but hasn't verified yet - redirect to verify
        return redirect(url_for("verify_2fa", next=request.path))


@app.route("/dashboard")
@login_required
def dashboard():
    """Protected dashboard page"""
    return render_template("index.html")


# ── Run ───────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    with app.app_context():
        db.create_all()  # Create database tables
        _ensure_schema_columns()
        
        # Create demo user if not exists
        if not User.query.filter_by(email="demo@kilimosmart.local").first():
            demo_user = User(
                email="demo@kilimosmart.local",
                name="Demo Farmer",
                county="Embu",
                acres=5.0,
                phone="+254 712 345 678",
            )
            demo_user.set_password("demo123")
            db.session.add(demo_user)
            db.session.commit()
            logger.info("[Auth] Demo user created: demo@kilimosmart.local / demo123")
    
    app.run(host="0.0.0.0", port=8080, debug=True)
