# KilimoSmart Maize MVP 🌽

AI-powered maize disease diagnostics and market-access platform for Kenyan farmers.

## Features

| Feature | Description |
|---------|-------------|
| **AI Crop Diagnosis** | Upload or photograph a maize leaf → instant disease classification (Blight, Common Rust, Gray Leaf Spot, Healthy) |
| **Treatment Advice** | Bilingual (EN / SW) medication & prevention guidance per disease |
| **Market Grading** | Automatic KEBS-aligned quality grading (Grade 1–3) with price adjustment |
| **Nearest Miller** | GPS-based lookup of the closest maize millers with contact details |
| **M-Pesa Deposit** | Simulated STK Push for 10 % buyer deposit (prototype) |
| **Bilingual UI** | Full English / Kiswahili language toggle |

## Tech Stack

- **Backend:** Flask 3.x (REST API)
- **Frontend:** Vanilla HTML / CSS / JS (mobile-first dashboard)
- **AI Model:** TensorFlow Lite (PlantVillage-trained, 4-class maize classifier)
- **Geo:** geopy + local millers CSV

## Quick Start

```bash
# 1. Create & activate virtual environment
python -m venv venv
venv\Scripts\activate        # Windows
# source venv/bin/activate   # macOS / Linux

# 2. Install dependencies
pip install -r requirements.txt

# 3. Run the Flask web app
python webapp.py
```

Open **http://localhost:8080** in your browser.

## Project Structure

```
├── webapp.py              # Flask app (main entry point)
├── requirements.txt       # Python dependencies
├── assets/
│   └── sw_labels.json     # Bilingual UI labels (EN / SW)
├── data/
│   ├── millers.csv        # Registered maize millers
│   └── treatments.json    # Disease treatment advice
├── models/
│   ├── maize_expert_v2.tflite     # TFLite model
│   └── class_indices_v2.json      # Class ↔ index mapping
├── static/
│   ├── css/style.css      # Dashboard styles
│   └── js/app.js          # Client-side logic
├── templates/
│   └── index.html         # Single-page app template
└── utils/
    ├── vision_tools.py    # AI inference (TFLite + mock fallback)
    ├── geo_tools.py       # GPS nearest-miller lookup
    └── market_tools.py    # Grading & price negotiation
```

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/` | Serve the SPA |
| GET | `/api/health` | Health check |
| GET | `/api/labels/<lang>` | UI labels (en / sw) |
| POST | `/api/diagnose` | Upload image → diagnosis + treatment |
| POST | `/api/market` | Get market offer for a disease/location |
| GET | `/api/millers` | List millers (optional `?lat=&lon=`) |

## Mock Mode

If no TFLite model file is found, the vision module automatically falls back to a **deterministic mock predictor** that derives results from image pixel statistics — useful for demos and UI development without a GPU.

## License

See [LICENSE](LICENSE) for details.
