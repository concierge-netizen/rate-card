// ═══════════════════════════════════════════════════════════════
// HANDS Logistics — Rates & Calculations
// Shared by admin.html and proposal.html
// ═══════════════════════════════════════════════════════════════

const STORAGE_RATES = {
  bay:        { name: "Full Bay (12 pallets)",        price: 460,  unitShort: "bay",    qtyLabel: "Quantity (bays)" },
  pallet:     { name: "Standard Pallet Position",     price: 45,   unitShort: "pallet", qtyLabel: "Quantity (pallets)" },
  overstock:  { name: "Overstock Pallet (top deck)",  price: 35,   unitShort: "pallet", qtyLabel: "Quantity (pallets)" },
  bulk_std:   { name: "Standard Bulk Floor",          price: 10,   unitShort: "sqft",   qtyLabel: "Quantity (sqft)" },
  bulk_prem:  { name: "Oversize/Irregular Bulk",      price: 12,   unitShort: "sqft",   qtyLabel: "Quantity (sqft)" },
  st_pallet:  { name: "Short-term Pallet",            price: 35,   unitShort: "pal·wk", qtyLabel: "Pallet-weeks (1wk min)", isShortTerm: true },
  st_bulk:    { name: "Short-term Bulk",              price: 3.50, unitShort: "sf·wk",  qtyLabel: "Sqft-weeks (1wk min)", isShortTerm: true }
};

const DELIVERY_RATES = {
  // Tiers (flat per-delivery)
  tier1:  { name: "Tier 1 — Local Single Stop",    price: 95,  type: "tier", unit: "delivery" },
  tier2:  { name: "Tier 2 — Multi-Stop (2-3)",     price: 185, type: "tier", unit: "delivery" },
  tier3:  { name: "Tier 3 — Extended Route",       price: 325, type: "tier", unit: "delivery" },
  tier4:  { name: "Tier 4 — Regional (80-150mi)",  price: 495, type: "tier", unit: "delivery" },
  tier5:  { name: "Tier 5 — Overnight",            price: 650, type: "tier", unit: "delivery" },
  // Add-ons
  pod:           { name: "Photo POD Documentation",  price: 50,  type: "addon", unit: "delivery" },
  whiteglove:    { name: "White Glove Setup",        price: 175, type: "addon", unit: "delivery" },
  reverse:       { name: "Return / Reverse Logistics", price: 200, type: "addon", unit: "delivery" },
  coc:           { name: "Chain of Custody",         price: 50,  type: "addon", unit: "flat" },
  // Time-based surcharges (percentage applied to tier lines only)
  rush:      { name: "Rush (<4hr notice)",      percent: 50, type: "surcharge", appliesTo: "tier" },
  afterhrs:  { name: "After-Hours (6pm-8am)",   percent: 35, type: "surcharge", appliesTo: "tier" },
  weekend:   { name: "Weekend / Holiday",       percent: 40, type: "surcharge", appliesTo: "tier" },
  // Flat surcharges
  waiting:   { name: "Waiting / Detention",       price: 75,  type: "surcharge", unit: "hour" },
  extrastop: { name: "Extra Stop (beyond tier)",  price: 75,  type: "surcharge", unit: "stop" },
  twoperson: { name: "Two-Person Crew",           price: 150, type: "surcharge", unit: "flat" },
  dock:      { name: "Venue / Load Dock",         price: 100, type: "surcharge", unit: "flat" },
  mileage:   { name: "Excess Mileage (>60mi)",    price: 0.85, type: "surcharge", unit: "mile" }
};

// ── FORMAT ──
function fmt(n) {
  if (n === 0 || !n) return "$0";
  return "$" + Number(n).toLocaleString("en-US", {
    minimumFractionDigits: (n % 1 ? 2 : 0),
    maximumFractionDigits: 2
  });
}

// ── STORAGE TOTALS ──
function calcStorageTotals(items) {
  let monthly = 0, shortTerm = 0;
  for (const it of items) {
    const rate = STORAGE_RATES[it.type];
    if (!rate) continue;
    const line = it.qty * rate.price;
    if (rate.isShortTerm) shortTerm += line;
    else monthly += line;
  }
  return { monthly, shortTerm };
}

// ── DELIVERY TOTAL ──
// Percentage surcharges apply to the sum of all tier lines.
// All other items are straight qty × price.
function calcDeliveryLine(item, allItems) {
  const rate = DELIVERY_RATES[item.type];
  if (!rate) return 0;

  if (rate.type === "surcharge" && rate.percent) {
    // This % surcharge applies to all tier lines × this surcharge's qty (usually 1)
    // But logically, the surcharge applies per-delivery, so we compute the surcharge
    // amount based on the total tier revenue × percent × this item's qty (qty acts as multiplier)
    const tierTotal = allItems
      .filter(i => {
        const r = DELIVERY_RATES[i.type];
        return r && r.type === "tier";
      })
      .reduce((sum, i) => sum + (i.qty * DELIVERY_RATES[i.type].price), 0);
    return tierTotal * (rate.percent / 100) * item.qty;
  }

  return (rate.price || 0) * item.qty;
}

function calcDeliveryTotal(items) {
  let total = 0;
  for (const it of items) {
    total += calcDeliveryLine(it, items);
  }
  return total;
}
