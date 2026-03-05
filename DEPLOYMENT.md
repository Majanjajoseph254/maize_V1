# KilimoSmart Deployment Guide

## Deployment Options

### Option 1: Vercel (Recommended for Rapid Prototyping)
Vercel can host this Flask app using serverless functions, though with some limitations.

**Limitations:**
- No persistent file storage between deployments (uploads will be lost)
- Max 10MB deployment size
- No file system write access for SQLite databases

**Setup:**
1. Sign up at https://vercel.com
2. Install Vercel CLI: `npm install -g vercel`
3. Authenticate: `vercel login`
4. Deploy from this directory: `vercel --prod`
5. Set environment variables in Vercel dashboard

**Environment Variables to Set:**
```
FLASK_ENV=production
SECRET_KEY=your-secure-random-key-here
```

**Alternative: GitHub Integration (Recommended)**
1. Connect your GitHub repository to Vercel
2. Set environment variables in Vercel project settings
3. Automatic deployments on push to main branch

---

### Option 2: Railway.app (Recommended for Production)
Railway is better suited for persistent Flask applications with databases.

**Advantages:**
- Persistent file storage
- Easy database integration (PostgreSQL recommended)
- Free tier available
- Better support for traditional WSGI apps

**Setup:**
1. Sign up at https://railway.app
2. Connect your GitHub repository
3. Link your repository through Railway dashboard
4. Set environment variables:
   - `FLASK_ENV=production`
   - `SECRET_KEY=your-secure-random-key`
   - `DATABASE_URL` (if using PostgreSQL)
5. Railway auto-deploys on push to main

**Database Migration:**
For production, replace SQLite with PostgreSQL:
```bash
pip install psycopg2-binary
```

Update `webapp.py`:
```python
DATABASE_URL = os.getenv('DATABASE_URL', 'sqlite:///./instance/maize_app.db')
app.config['SQLALCHEMY_DATABASE_URI'] = DATABASE_URL.replace('postgres://', 'postgresql://') if DATABASE_URL else 'sqlite:///./instance/maize_app.db'
```

---

### Option 3: Fly.io
Another excellent production-ready option with persistent storage.

**Setup:**
1. Install Fly CLI: `brew install flyctl` (or download for Windows)
2. Sign up: `flyctl auth signup`
3. Initialize: `flyctl launch` in project directory
4. Configure Fly.toml as needed
5. Deploy: `flyctl deploy`

---

### Option 4: Render.com
Great for free tier with persistent storage.

**Setup:**
1. Sign up at https://render.com
2. Connect GitHub repo
3. Create Web Service
4. Set build command: `pip install -r requirements.txt`
5. Set start command: `python webapp.py` or use gunicorn
6. Set environment variables
7. Deploy

---

## Current Vercel Configuration

**Files Created:**
- `vercel.json` - Deployment configuration
- `api/index.py` - Serverless function handler
- `.vercelignore` - Files to exclude from deployment

**How it Works:**
1. Vercel runs `api/index.py` as a serverless function
2. All requests route through the Flask app
3. Static files (CSS, JS, HTML) are served directly

---

## Quick Vercel Deployment (GitHub Integration)

1. Push to GitHub:
   ```bash
   git push origin main
   ```

2. Go to https://vercel.com/new
3. Import your GitHub repository
4. Add environment variables:
   - `FLASK_ENV` = `production`
   - `SECRET_KEY` = (generate random string)

5. Click "Deploy"

---

## Local Testing Before Deployment

```bash
# Test with production-like settings
export FLASK_ENV=production
python webapp.py
```

---

## Important Notes

### For Vercel:
- SQLite database will not persist between deployments
- File uploads (profile photos) will be lost after deployment
- For production use, recommend Railway, Fly.io, or Render with PostgreSQL

### For Railway/Fly.io/Render:
- Full persistence with traditional database
- Better suited for production workloads
- Supports file uploads permanently

---

## Recommended Production Stack

```
Frontend:  Static files (CSS/JS) on Vercel/Cloudflare
Backend:   Flask on Railway/Fly.io with PostgreSQL
          or Render.com with PostgreSQL
Database:  PostgreSQL
Storage:   Cloud storage for user uploads (AWS S3, Google Cloud Storage, etc.)
```

---

## Troubleshooting

**Deployment fails with "module not found":**
- Check requirements.txt includes all dependencies
- Rebuild: `vercel --prod`

**Database errors on Vercel:**
- Vercel doesn't support persistent SQLite
- Use the GitHub Integration approach with Railway recommendations

**Uploads not persisting:**
- Vercel doesn't have persistent file storage
- Switch to Railway/Fly.io for production

---

## Support

For production deployment help:
- **Vercel Docs:** https://vercel.com/docs/frameworks/flask
- **Railway Docs:** https://docs.railway.app
- **Fly.io Docs:** https://fly.io/docs
