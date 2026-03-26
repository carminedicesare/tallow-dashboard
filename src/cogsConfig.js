/**
 * cogsConfig.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Unit costs, retail prices, and per-order fee structure for Hide Tallow.
 * Update this file whenever costs change, then push to GitHub to redeploy.
 * ─────────────────────────────────────────────────────────────────────────────
 */

// ── Per-unit COGS ─────────────────────────────────────────────────────────────

export const COGS = {
  // ── Everyday Jar ($4.05/unit) ──────────────────────────────────────────────
  'Everyday_Jar_Lavender': {
    name: 'Everyday Jar — Lavender',
    unitCost: 4.05,
    price: 16.00,
    category: 'Everyday Jar',
  },
  'Everyday_Jar_Lemongrass': {
    name: 'Everyday Jar — Lemongrass',
    unitCost: 4.05,
    price: 16.00,
    category: 'Everyday Jar',
  },
  'Everyday_Jar_Vanilla': {
    name: 'Everyday Jar — Vanilla',
    unitCost: 4.05,
    price: 16.00,
    category: 'Everyday Jar',
  },
  'Everyday_Jar_Unscented': {
    name: 'Everyday Jar — Unscented',
    unitCost: 4.05,
    price: 15.00,
    category: 'Everyday Jar',
  },

  // ── On The Go Tin ($3.05/unit) ─────────────────────────────────────────────
  'OTGTin_Lavender': {
    name: 'OTG Tin — Lavender',
    unitCost: 3.05,
    price: 12.00,
    category: 'On The Go Tin',
  },
  'OTGTin_Lemongrass': {
    name: 'OTG Tin — Lemongrass',
    unitCost: 3.05,
    price: 12.00,
    category: 'On The Go Tin',
  },
  'OTGTin_Unscented': {
    name: 'OTG Tin — Unscented',
    unitCost: 3.05,
    price: 11.00,
    category: 'On The Go Tin',
  },
  'OTGTin_Vanilla': {
    name: 'OTG Tin — Vanilla',
    unitCost: 3.05,
    price: 12.00,
    category: 'On The Go Tin',
  },

  // ── Daily Bar ($5.00 manufacturing flat rate from producer) ──────────────
  'DailyBar_Lavender': {
    name: 'Daily Bar — Lavender',
    unitCost: 5.00,
    price: 15.00,
    category: 'Daily Bar',
  },
  'DailyBar_Lemongrass': {
    name: 'Daily Bar — Lemongrass',
    unitCost: 5.00,
    price: 15.00,
    category: 'Daily Bar',
  },

  // ── Pocket Stick (self-manufactured, raw materials only) ─────────────────
  // Tube $0.44 + Tallow $0.003 + Beeswax $0.06 + Label $0.19 = $0.69
  'PocketStick_Spearmint': {
    name: 'Pocket Stick — Spearmint',
    unitCost: 0.69,
    price: 6.00,
    category: 'Pocket Stick',
  },
  'PocketStick_Unscented': {
    name: 'Pocket Stick — Unscented',
    unitCost: 0.69,
    price: 5.00,
    category: 'Pocket Stick',
  },
  'PocketStick_Vanilla': {
    name: 'Pocket Stick — Vanilla',
    unitCost: 0.69,
    price: 6.00,
    category: 'Pocket Stick',
  },
}

// ── Per-Order Fees ────────────────────────────────────────────────────────────
// Deducted at the order level when calculating net profit.

export const ORDER_FEES = {
  threepl_first_item:      2.50,   // 3PL pick fee for first item
  threepl_additional_item: 0.50,   // 3PL pick fee for each additional item
  packaging:               0.30,   // box/mailer per order
  shopify_processing_rate: 0.029,  // 2.9% Shopify Basic plan
  shopify_processing_flat: 0.30,   // flat $0.30 per transaction
}

// ── Monthly Fixed Costs ───────────────────────────────────────────────────────
// Used to show true net profit. Update as needed.

export const MONTHLY_FIXED = {
  shopify_subscription:   29,    // Basic plan paid annually ($348/yr = $29/mo)
  threepl_account_mgmt:  100,    // $25/week × 4
  threepl_storage:        79,    // $19.25/week × 4 (approx)
  marketing_agency:     1250,    // Monthly retainer
  // total fixed: $1,458/mo
}
