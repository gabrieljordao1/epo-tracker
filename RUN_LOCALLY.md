# Run EPO Tracker Locally — Claude Code Prompt

Copy and paste the prompt below into Claude Code on your laptop.

---

```
I have an EPO Tracker app in this folder with a FastAPI backend and Next.js frontend. I need you to get both running locally so I can see the demo in my browser. Here's exactly what to do:

## Step 1: Backend Setup
cd into the `backend/` folder and run:
1. `python3 -m venv venv && source venv/bin/activate` (create a virtual environment)
2. `pip install -r requirements.txt`
3. `uvicorn app.main:app --reload --port 8000`

Leave the backend running. It uses SQLite by default so no database setup needed.

## Step 2: Frontend Setup (in a new terminal)
cd into the `frontend/` folder and run:
1. `npm install`
2. `npm run dev`

This starts the frontend on http://localhost:3000

## Step 3: Seed Demo Data
Once both are running, hit the seed endpoint to populate sample data:
```
curl -X POST http://localhost:8000/api/demo/seed
```

## Step 4: Open the browser
Open http://localhost:3000 — I should see the full dashboard with sample EPO data, charts, activity feed, and the ability to filter/export.

The vendor portal is at http://localhost:3000/vendor?token=TOKEN (grab a token from the seed response).

## Important Notes:
- The backend `.env` file is already configured for development mode
- Demo mode works without any authentication — the frontend falls back to demo endpoints automatically
- If port 3000 is busy, Next.js will use 3001
- If you get Python version issues, make sure you're on Python 3.10+
- If you get Node version issues, make sure you're on Node 18+

Run both servers and confirm they're working, then tell me the URLs to open.
```
