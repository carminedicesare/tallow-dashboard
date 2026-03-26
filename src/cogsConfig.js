/**
 * cogsConfig.js
 * ──────────────────────────────────────────────────────────────────────────────
 * Edit this file to set your real product costs and prices.
 *
 * unitCost  → what it costs YOU to make/buy one unit (COGS)
 * price     → what you charge the customer (retail price)
 *
 * The SKU keys (e.g. "4oz-original") must exactly match the SKUs you use
 * in Shopify. Check: Shopify Admin → Products → [product] → Variants → SKU
 * ──────────────────────────────────────────────────────────────────────────────
 */

export const COGS = {
  '4oz-original': {
    name: '4 oz Original',
    unitCost: 0,   // ← fill in your actual cost per unit
    price: 0,      // ← fill in your retail price
  },
  '8oz-original': {
    name: '8 oz Original',
    unitCost: 0,
    price: 0,
  },
  'face-balm': {
    name: '4 oz Face Balm',
    unitCost: 0,
    price: 0,
  },
  'lip-balm': {
    name: 'Lip Balm',
    unitCost: 0,
    price: 0,
  },
}

// Add more SKUs as needed, following the same pattern:
// 'your-sku': { name: 'Display Name', unitCost: 0, price: 0 },
