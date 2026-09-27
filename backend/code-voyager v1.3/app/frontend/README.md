# AutoDocumentation frontend

React + TypeScript + Vite frontend for the FastAPI backend.

## Run

From `AutoDocumentation/app/frontend`:

```bash
npm install
npm run dev
```

Open `http://127.0.0.1:5173/`.

The frontend expects FastAPI at `http://127.0.0.1:8000` by default. To change it, create `.env`:

```env
VITE_API_URL=http://127.0.0.1:8000
```

## Important about auto-reload

Vite is a long-running development server. The terminal command does **not** restart after every file change. Keep `npm run dev` running. When you save `.tsx`, `.ts`, or `.css`, Vite updates the browser through HMR automatically.
