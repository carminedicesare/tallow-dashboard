# Tallow Dashboard — Deploy Guide

## Quick Start (local preview)

```bash
cd tallow-dashboard
npm install
cp .env.example .env   # then fill in your real keys
npm run dev            # opens at http://localhost:3000
```

---

## Getting Your API Keys

### 1. Shopify Admin API Token
1. Go to your Shopify Admin → **Settings** → **Apps and sales channels**
2. Click **Develop apps** (top right) → **Create an app**
3. Give it a name (e.g. "Tallow Dashboard")
4. Go to **Configuration** → **Admin API integration** → click **Configure**
5. Under "Orders", check **`read_orders`**
6. Click **Save**, then **Install app**
7. Copy the **Admin API access token** (shown once — save it!)
8. Your store URL is `your-store.myshopify.com` (no `https://`)

Set in `.env`:
```
VITE_SHOPIFY_STORE_URL=your-store.myshopify.com
VITE_SHOPIFY_ADMIN_TOKEN=shpat_xxxxxxxxxxxxxxxxxxxx
```

---

### 2. Meta Ads API Token + Account ID
1. Go to [developers.facebook.com](https://developers.facebook.com) → **My Apps** → create or select your app
2. In the left sidebar go to **Tools** → **Graph API Explorer**
3. Select your app in the top dropdown
4. Click **Generate Access Token** → add permissions: `ads_read`, `ads_management`
5. For a long-lived token (recommended): use the [Access Token Debugger](https://developers.facebook.com/tools/debug/accesstoken/) to extend it
6. Find your Ad Account ID: go to [Meta Business Manager](https://business.facebook.com) → **Ad Accounts** → your account ID starts with `act_`

Set in `.env`:
```
VITE_META_ACCESS_TOKEN=EAAxxxxxxxxxx
VITE_META_AD_ACCOUNT_ID=act_xxxxxxxxxx
```

> **Note on CORS:** Meta's Graph API allows direct browser requests to `graph.facebook.com`, but for security the dashboard routes these through `/api/meta` on Vercel (server-side), keeping your token out of the browser.

---

### 3. Anthropic Claude API Key
1. Go to [console.anthropic.com](https://console.anthropic.com)
2. Click **API Keys** in the left sidebar → **Create Key**
3. Give it a name and copy the key (shown once)

Set in `.env`:
```
VITE_ANTHROPIC_API_KEY=sk-ant-xxxxxxxxxxxx
```

---

## Deploy to Vercel

### One-time setup
1. Push the project to a new GitHub repo named `tallow-dashboard`
   ```bash
   git init
   git add .
   git commit -m "Initial commit"
   gh repo create tallow-dashboard --public --source=. --push
   ```
2. Go to [vercel.com](https://vercel.com) → **Add New Project** → import `tallow-dashboard`
3. Vercel will auto-detect Vite. Click **Deploy** (first deploy will fail — keys not set yet)
4. Go to your Vercel project → **Settings** → **Environment Variables**
5. Add each key from your `.env` file:
   - `VITE_SHOPIFY_STORE_URL`
   - `VITE_SHOPIFY_ADMIN_TOKEN`
   - `VITE_META_ACCESS_TOKEN`
   - `VITE_META_AD_ACCOUNT_ID`
   - `VITE_ANTHROPIC_API_KEY`
6. Go to **Deployments** → click **Redeploy** on the latest deployment

Your dashboard will be live at `https://tallow-dashboard.vercel.app` (or similar).

---

## Filling in COGS

Edit `src/cogsConfig.js` — find the block at the top and fill in your numbers:

```js
export const COGS = {
  '4oz-original': { name: '4 oz Original', unitCost: 8.50,  price: 34.99 },
  '8oz-original': { name: '8 oz Original', unitCost: 14.00, price: 49.99 },
  'face-balm':    { name: '4 oz Face Balm', unitCost: 9.00, price: 39.99 },
  'lip-balm':     { name: 'Lip Balm',       unitCost: 2.50, price: 14.99 },
}
```

- `unitCost` = what it costs you to make/buy one unit
- `price` = your retail price (used as fallback if not in Shopify data)
- SKU keys must exactly match what's in Shopify (Admin → Products → Variants → SKU field)

After editing, commit and push — Vercel will auto-redeploy.

---

## Architecture Notes

```
tallow-dashboard/
├── index.html              # App entry point
├── vite.config.js          # Vite config
├── vercel.json             # Vercel routing config
├── .env.example            # Key template (copy to .env)
├── api/
│   ├── shopify.js          # Vercel serverless: proxies Shopify API
│   ├── claude.js           # Vercel serverless: proxies Anthropic API
│   └── meta/[...params].js # Vercel serverless: proxies Meta API
└── src/
    ├── main.jsx            # React root
    ├── App.jsx             # Full dashboard UI + logic
    ├── index.css           # All styles (dark mode, no external libs)
    ├── cogsConfig.js       # ← You edit this file
    └── services/
        ├── shopifyService.js  # Shopify data layer + mock fallback
        ├── metaService.js     # Meta Ads data layer + mock fallback
        └── claudeService.js   # Claude Q&A layer
```

**Why serverless proxy functions?** Shopify and Anthropic don't allow direct browser API calls (CORS). The `/api/*` functions run server-side on Vercel, keep your keys private, and forward responses to the frontend.

**Mock data:** If any API key is missing, that service falls back to sample data automatically. The dashboard always renders — you'll see a yellow "Sample Data" badge in the header.

**Cache:** Data is cached in `localStorage` for 12 hours. Hit "↻ Refresh" to force a fresh pull.
