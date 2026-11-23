import DEFAULTS from '@shared/cms-defaults.json';

export { DEFAULTS };

/* =========================================================
   PRICES. Built-in values, shown until the server answers.
   Real prices come from Admin → Products & prices.
   "was" = regular single-bottle price × bottles in the pack
   (Tk 35 per 500 mL, Tk 100 per 2 L).
   ========================================================= */
export const PRODUCTS = {
  'single-500': { name: 'Single · 500 mL', unit: 1, size: '500 mL', price: 30, was: 35 },
  'single-2000': { name: 'Single · 2 L', unit: 1, size: '2 L', price: 90, was: 100 },
  'day-500': { name: 'Day Pack · 4 × 500 mL', unit: 4, size: '500 mL', price: 120, was: 140 },
  'case-500': { name: 'Case · 24 × 500 mL', unit: 24, size: '500 mL', price: 720, was: 840 },
  'case-2000': { name: 'Case · 6 × 2 L', unit: 6, size: '2 L', price: 540, was: 600 },
  'case5-2000': { name: '5 cases · 30 × 2 L', unit: 30, size: '2 L', price: 2700, was: 3000 },
};

/* Three cards per bottle size. The texts (title, sub, badge, bullets, button)
   come from shared/cms-defaults.json and Admin → Website content → Shop cards. */
export const PLANS = {
  500: [
    { sku: 'single-500', show: 1 },
    { sku: 'day-500', show: 4, x: '×4', soft: true },
    { sku: 'case-500', show: 6, x: '×24', best: true },
  ],
  2000: [
    { sku: 'single-2000', show: 1, soft: true },
    { sku: 'case-2000', show: 6, x: '×6' },
    { sku: 'case5-2000', show: 6, x: '×30', best: true },
  ],
};

/* The four ingredient cards: symbol shown on the sticky bottle, its label and tilt. */
export const INGREDIENTS = [
  { n: 1, sym: 'K', label: 'Potassium', rot: -4 },
  { n: 2, sym: 'Zn · Se', label: 'Zinc & Selenium', rot: 3 },
  { n: 3, sym: 'Mg', label: 'Magnesium', rot: -2 },
  { n: 4, sym: 'Proprietary', label: 'Ion-Blend', rot: 4 },
];

export const tk = (n) => 'Tk ' + n.toLocaleString('en-IN');
export const sizeOf = (sku) => (sku.endsWith('-2000') ? 2000 : 500);

/** Aquanimity Q (traced from the brand mark). */
export const Q_PATH = 'M568.5 486.5C535.5 483.1 515.7 476.5 472.8 454.6C451.0 443.5 444.3 441.1 428.1 438.4C410.5 435.5 382.9 437.3 367.0 442.4C360.3 444.5 355.9 446.5 340.5 454.2C297.1 476.0 246.3 487.7 210.2 484.1C190.4 482.1 167.9 474.8 141.5 462.0C92.4 438.0 52.8 400.4 27.8 354.0C-9.8 284.0 -8.5 197.0 31.3 127.3C63.4 71.0 116.1 29.6 179.0 10.9C224.3 -2.5 278.2 -2.8 322.5 10.3C381.0 27.4 428.9 61.9 462.2 110.5C492.0 154.1 506.2 206.0 502.9 259.0C501.3 284.3 495.6 310.3 486.8 331.8C484.5 337.4 484.3 337.5 479.0 336.0C459.5 330.2 434.5 327.1 408.3 327.0L388.0 327.0L391.8 320.8C400.6 306.5 407.4 288.8 410.9 271.3C414.0 255.9 413.9 231.0 410.6 215.7C405.3 191.3 397.5 174.1 382.8 154.3C364.9 130.3 335.1 109.1 305.0 99.0C287.1 93.1 273.4 91.0 252.0 91.0C235.9 91.0 231.1 91.4 220.7 93.4C162.7 105.0 117.8 142.7 98.5 196.0C93.0 211.3 90.9 224.8 90.9 244.0C90.8 261.7 92.2 271.9 96.6 286.5C108.4 325.5 138.6 360.7 176.8 379.9C197.8 390.5 208.4 393.2 228.0 393.1C249.9 393.1 262.4 389.5 289.9 375.3C312.9 363.4 327.6 357.8 349.0 353.0C369.1 348.5 380.1 347.5 407.5 347.6C438.4 347.6 451.2 349.2 477.0 356.3C492.7 360.6 512.2 369.2 538.5 383.4C554.0 391.8 570.3 396.5 587.4 397.6L599.0 398.3L599.0 443.1L599.0 488.0L589.8 487.9C584.7 487.8 575.1 487.2 568.5 486.5Z';
