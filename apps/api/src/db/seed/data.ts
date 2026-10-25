// Illustrative demo data (SRS FR-001, Solution Design §D6.4) for a fictional San Francisco bistro, in USD.
// [Illustrative demo data] — not verified market data; prices are not supplier quotes.

export const SUPPLIERS = [
  { id: 'sup_bay', name: 'Bay Meat Supply', email: 'orders@baymeat.example', min: 200, type: 'soft', fee: 15, delivery: 0, cycle: 2, cutoff: '14:00', trusted: 1 },
  { id: 'sup_gg', name: 'Golden Gate Foodservice', email: 'orders@goldengatefs.example', min: 60, type: 'hard', fee: 0, delivery: 25, cycle: 2, cutoff: '15:00', trusted: 1 },
  { id: 'sup_mission', name: 'Mission Produce Co.', email: 'orders@missionproduce.example', min: 75, type: 'hard', fee: 0, delivery: 10, cycle: 2, cutoff: '13:00', trusted: 0 },
  { id: 'sup_sonoma', name: 'Sonoma Creamery', email: 'orders@sonomacreamery.example', min: 50, type: 'soft', fee: 10, delivery: 0, cycle: 2, cutoff: '12:00', trusted: 0 },
  { id: 'sup_pacific', name: 'Pacific Dry Goods', email: 'orders@pacificdry.example', min: 100, type: 'hard', fee: 0, delivery: 0, cycle: 6, cutoff: '11:00', trusted: 0 },
] as const;

type Ing = { id: string; name: string; unit: 'lb' | 'oz' | 'gal' | 'qt' | 'each'; category: string; perishable: 0 | 1; shelf: number; safety: number; overbuy: number };

export const INGREDIENTS: Ing[] = [
  { id: 'ing_patty', name: 'Beef patty 6 oz', unit: 'each', category: 'meat', perishable: 1, shelf: 5, safety: 1, overbuy: 3 },
  { id: 'ing_thigh', name: 'Chicken thigh, boneless', unit: 'lb', category: 'poultry', perishable: 1, shelf: 4, safety: 1, overbuy: 3 },
  { id: 'ing_fries', name: 'Fries 3/8" frozen', unit: 'lb', category: 'frozen', perishable: 0, shelf: 90, safety: 1, overbuy: 3 },
  { id: 'ing_bacon', name: 'Bacon, thick cut', unit: 'lb', category: 'meat', perishable: 1, shelf: 14, safety: 1, overbuy: 3 },
  { id: 'ing_salmon', name: 'Salmon fillet', unit: 'lb', category: 'fish', perishable: 1, shelf: 3, safety: 1, overbuy: 2 },
  { id: 'ing_rockfish', name: 'Rockfish fillet', unit: 'lb', category: 'fish', perishable: 1, shelf: 3, safety: 1, overbuy: 2 },
  { id: 'ing_shortrib', name: 'Short rib, bone-in', unit: 'lb', category: 'meat', perishable: 1, shelf: 6, safety: 1, overbuy: 3 },
  { id: 'ing_breast', name: 'Chicken breast', unit: 'lb', category: 'poultry', perishable: 1, shelf: 4, safety: 1, overbuy: 3 },
  { id: 'ing_eggs', name: 'Eggs, large', unit: 'each', category: 'dairy', perishable: 1, shelf: 21, safety: 1, overbuy: 4 },
  { id: 'ing_butter', name: 'Butter, unsalted', unit: 'lb', category: 'dairy', perishable: 1, shelf: 60, safety: 1, overbuy: 7 },
  { id: 'ing_cream', name: 'Heavy cream', unit: 'qt', category: 'dairy', perishable: 1, shelf: 10, safety: 1, overbuy: 3 },
  { id: 'ing_milk', name: 'Whole milk', unit: 'gal', category: 'dairy', perishable: 1, shelf: 10, safety: 1, overbuy: 3 },
  { id: 'ing_cheddar', name: 'Cheddar, sharp', unit: 'lb', category: 'dairy', perishable: 1, shelf: 45, safety: 1, overbuy: 7 },
  { id: 'ing_parmesan', name: 'Parmesan', unit: 'lb', category: 'dairy', perishable: 1, shelf: 90, safety: 1, overbuy: 10 },
  { id: 'ing_mozz', name: 'Mozzarella, fresh', unit: 'lb', category: 'dairy', perishable: 1, shelf: 7, safety: 1, overbuy: 3 },
  { id: 'ing_bun', name: 'Brioche bun', unit: 'each', category: 'bakery', perishable: 1, shelf: 5, safety: 1, overbuy: 2 },
  { id: 'ing_romaine', name: 'Romaine hearts', unit: 'lb', category: 'produce', perishable: 1, shelf: 6, safety: 1, overbuy: 3 },
  { id: 'ing_greens', name: 'Mixed greens', unit: 'lb', category: 'produce', perishable: 1, shelf: 4, safety: 1, overbuy: 2 },
  { id: 'ing_tomato', name: 'Tomatoes, vine', unit: 'lb', category: 'produce', perishable: 1, shelf: 6, safety: 1, overbuy: 3 },
  { id: 'ing_onion', name: 'Yellow onions', unit: 'lb', category: 'produce', perishable: 1, shelf: 30, safety: 1, overbuy: 7 },
  { id: 'ing_potato', name: 'Russet potatoes', unit: 'lb', category: 'produce', perishable: 1, shelf: 30, safety: 1, overbuy: 7 },
  { id: 'ing_lemon', name: 'Lemons', unit: 'each', category: 'produce', perishable: 1, shelf: 21, safety: 1, overbuy: 7 },
  { id: 'ing_garlic', name: 'Garlic, peeled', unit: 'lb', category: 'produce', perishable: 1, shelf: 14, safety: 1, overbuy: 7 },
  { id: 'ing_basil', name: 'Fresh basil', unit: 'oz', category: 'herbs', perishable: 1, shelf: 2, safety: 1, overbuy: 1 },
  { id: 'ing_avocado', name: 'Avocados', unit: 'each', category: 'produce', perishable: 1, shelf: 5, safety: 1, overbuy: 2 },
  { id: 'ing_mushroom', name: 'Mushrooms, cremini', unit: 'lb', category: 'produce', perishable: 1, shelf: 5, safety: 1, overbuy: 2 },
  { id: 'ing_arborio', name: 'Arborio rice', unit: 'lb', category: 'dry', perishable: 0, shelf: 365, safety: 2, overbuy: 14 },
  { id: 'ing_spaghetti', name: 'Spaghetti', unit: 'lb', category: 'dry', perishable: 0, shelf: 365, safety: 2, overbuy: 14 },
  { id: 'ing_flour', name: 'All-purpose flour', unit: 'lb', category: 'dry', perishable: 0, shelf: 180, safety: 2, overbuy: 14 },
  { id: 'ing_oil', name: 'Olive oil, extra virgin', unit: 'gal', category: 'dry', perishable: 0, shelf: 365, safety: 2, overbuy: 21 },
  { id: 'ing_canola', name: 'Canola fryer oil', unit: 'gal', category: 'dry', perishable: 0, shelf: 365, safety: 2, overbuy: 14 },
  { id: 'ing_stock', name: 'Chicken stock', unit: 'qt', category: 'dry', perishable: 0, shelf: 180, safety: 2, overbuy: 14 },
  { id: 'ing_ketchup', name: 'Ketchup', unit: 'gal', category: 'dry', perishable: 0, shelf: 180, safety: 2, overbuy: 21 },
  { id: 'ing_salt', name: 'Kosher salt', unit: 'lb', category: 'dry', perishable: 0, shelf: 365, safety: 2, overbuy: 30 },
  { id: 'ing_choc', name: 'Dark chocolate', unit: 'lb', category: 'dry', perishable: 0, shelf: 365, safety: 2, overbuy: 14 },
  { id: 'ing_sugar', name: 'Sugar', unit: 'lb', category: 'dry', perishable: 0, shelf: 365, safety: 2, overbuy: 30 },
];

// [supplierId, ingredientId, sku, packSize, unitPrice, leadTimeDays, preferred]
export const OFFERS: [string, string, string, number, number, number, 0 | 1][] = [
  ['sup_bay', 'ing_patty', 'BM-PAT6', 24, 1.65, 1, 1],
  ['sup_bay', 'ing_thigh', 'BM-CTB', 10, 3.4, 1, 1],
  ['sup_bay', 'ing_bacon', 'BM-BAC', 15, 5.2, 1, 1],
  ['sup_bay', 'ing_salmon', 'BM-SAL', 10, 12.8, 1, 1],
  ['sup_bay', 'ing_rockfish', 'BM-RKF', 10, 9.9, 1, 1],
  ['sup_bay', 'ing_shortrib', 'BM-SRB', 20, 7.8, 1, 1],
  ['sup_bay', 'ing_breast', 'BM-CBR', 10, 3.9, 1, 1],
  ['sup_gg', 'ing_patty', 'GG-44120', 48, 1.52, 1, 0],
  ['sup_gg', 'ing_thigh', 'GG-23310', 40, 3.25, 1, 0],
  ['sup_gg', 'ing_fries', 'GG-81002', 30, 1.1, 1, 1],
  ['sup_gg', 'ing_bacon', 'GG-30115', 15, 5.45, 1, 0],
  ['sup_gg', 'ing_salmon', 'GG-50210', 10, 12.4, 1, 0],
  ['sup_gg', 'ing_rockfish', 'GG-50330', 10, 9.6, 1, 0],
  ['sup_gg', 'ing_breast', 'GG-23120', 40, 3.7, 1, 0],
  ['sup_gg', 'ing_eggs', 'GG-60110', 180, 0.3, 1, 0],
  ['sup_gg', 'ing_butter', 'GG-60220', 36, 4.25, 1, 0],
  ['sup_gg', 'ing_cream', 'GG-60330', 12, 3.75, 1, 0],
  ['sup_gg', 'ing_cheddar', 'GG-60440', 10, 6.1, 1, 0],
  ['sup_gg', 'ing_bun', 'GG-70110', 48, 0.55, 1, 1],
  ['sup_gg', 'ing_romaine', 'GG-80120', 24, 2.35, 1, 0],
  ['sup_gg', 'ing_tomato', 'GG-80230', 25, 2.6, 1, 0],
  ['sup_gg', 'ing_onion', 'GG-80340', 50, 0.95, 1, 0],
  ['sup_gg', 'ing_garlic', 'GG-80450', 5, 5.1, 1, 0],
  ['sup_gg', 'ing_avocado', 'GG-80560', 48, 1.45, 1, 0],
  ['sup_gg', 'ing_arborio', 'GG-90110', 25, 2.3, 1, 0],
  ['sup_gg', 'ing_spaghetti', 'GG-90220', 20, 1.7, 1, 0],
  ['sup_gg', 'ing_oil', 'GG-90330', 4, 29.5, 1, 0],
  ['sup_gg', 'ing_canola', 'GG-90440', 5, 13.5, 1, 0],
  ['sup_mission', 'ing_romaine', 'MP-ROM24', 24, 2.1, 1, 1],
  ['sup_mission', 'ing_greens', 'MP-MIX3', 3, 6.5, 1, 1],
  ['sup_mission', 'ing_tomato', 'MP-TOV25', 25, 2.4, 1, 1],
  ['sup_mission', 'ing_onion', 'MP-ONY50', 50, 0.9, 1, 1],
  ['sup_mission', 'ing_potato', 'MP-RUS50', 50, 0.85, 1, 1],
  ['sup_mission', 'ing_lemon', 'MP-LEM115', 115, 0.32, 1, 1],
  ['sup_mission', 'ing_garlic', 'MP-GAR5', 5, 4.8, 1, 1],
  ['sup_mission', 'ing_basil', 'MP-BAS16', 16, 0.75, 1, 1],
  ['sup_mission', 'ing_avocado', 'MP-AVO48', 48, 1.3, 1, 1],
  ['sup_mission', 'ing_mushroom', 'MP-CRM10', 10, 3.8, 1, 1],
  ['sup_sonoma', 'ing_eggs', 'SC-EGG180', 180, 0.28, 1, 1],
  ['sup_sonoma', 'ing_butter', 'SC-BUT36', 36, 4.1, 1, 1],
  ['sup_sonoma', 'ing_cream', 'SC-CRM12', 12, 3.6, 1, 1],
  ['sup_sonoma', 'ing_milk', 'SC-MLK4', 4, 4.2, 1, 1],
  ['sup_sonoma', 'ing_cheddar', 'SC-CHD10', 10, 6.4, 1, 1],
  ['sup_sonoma', 'ing_parmesan', 'SC-PAR5', 5, 14.5, 1, 1],
  ['sup_sonoma', 'ing_mozz', 'SC-MOZ6', 6, 7.2, 1, 1],
  ['sup_pacific', 'ing_arborio', 'PD-ARB25', 25, 2.1, 2, 1],
  ['sup_pacific', 'ing_spaghetti', 'PD-SPG20', 20, 1.6, 2, 1],
  ['sup_pacific', 'ing_flour', 'PD-FLR50', 50, 0.62, 2, 1],
  ['sup_pacific', 'ing_oil', 'PD-EVO4', 4, 28, 2, 1],
  ['sup_pacific', 'ing_canola', 'PD-CAN5', 5, 14, 2, 1],
  ['sup_pacific', 'ing_stock', 'PD-STK12', 12, 2.4, 2, 1],
  ['sup_pacific', 'ing_ketchup', 'PD-KET4', 4, 9.8, 2, 1],
  ['sup_pacific', 'ing_salt', 'PD-SLT3', 3, 2.2, 2, 1],
  ['sup_pacific', 'ing_choc', 'PD-CHO10', 10, 7.5, 2, 1],
  ['sup_pacific', 'ing_sugar', 'PD-SUG25', 25, 0.8, 2, 1],
];

// Menu: [id, name, price, base daily portions, temperature sensitivity per +10 °F]
export const MENU: [string, string, number, number, number][] = [
  ['mi_burger', 'Classic Burger', 19, 20, 0],
  ['mi_baconburger', 'Bacon Cheeseburger', 22, 12, 0],
  ['mi_chicksand', 'Fried Chicken Sandwich', 18, 16, 0],
  ['mi_roastthigh', 'Roast Chicken Thigh', 26, 10, -0.02],
  ['mi_caesar', 'Caesar Salad', 15, 18, 0.05],
  ['mi_salmon', 'Grilled Salmon', 32, 11, 0.02],
  ['mi_tacos', 'Fish Tacos', 21, 13, 0.05],
  ['mi_shortrib', 'Braised Short Rib', 36, 8, -0.05],
  ['mi_risotto', 'Mushroom Risotto', 24, 9, -0.04],
  ['mi_pomodoro', 'Spaghetti Pomodoro', 20, 12, 0],
  ['mi_flatbread', 'Margherita Flatbread', 17, 10, 0.01],
  ['mi_club', 'Chicken Club', 19, 9, 0.02],
  ['mi_fries', 'Fries Basket', 8, 15, 0],
  ['mi_potdecreme', 'Chocolate Pot de Crème', 11, 10, 0.01],
];

export const RECIPES: Record<string, [string, number][]> = {
  mi_burger: [['ing_patty', 1], ['ing_bun', 1], ['ing_cheddar', 0.06], ['ing_romaine', 0.04], ['ing_tomato', 0.08], ['ing_onion', 0.05], ['ing_fries', 0.35], ['ing_ketchup', 0.005]],
  mi_baconburger: [['ing_patty', 1], ['ing_bun', 1], ['ing_bacon', 0.12], ['ing_cheddar', 0.08], ['ing_onion', 0.04], ['ing_fries', 0.35]],
  mi_chicksand: [['ing_thigh', 0.4], ['ing_bun', 1], ['ing_romaine', 0.04], ['ing_flour', 0.08], ['ing_canola', 0.03], ['ing_fries', 0.35]],
  mi_roastthigh: [['ing_thigh', 0.5], ['ing_potato', 0.4], ['ing_garlic', 0.02], ['ing_butter', 0.05], ['ing_lemon', 0.5]],
  mi_caesar: [['ing_romaine', 0.35], ['ing_parmesan', 0.04], ['ing_eggs', 1], ['ing_lemon', 0.5], ['ing_garlic', 0.01], ['ing_oil', 0.01]],
  mi_salmon: [['ing_salmon', 0.45], ['ing_greens', 0.1], ['ing_lemon', 0.5], ['ing_butter', 0.05]],
  mi_tacos: [['ing_rockfish', 0.35], ['ing_avocado', 0.5], ['ing_onion', 0.05], ['ing_greens', 0.05], ['ing_canola', 0.02]],
  mi_shortrib: [['ing_shortrib', 0.9], ['ing_potato', 0.4], ['ing_cream', 0.06], ['ing_onion', 0.1], ['ing_garlic', 0.02]],
  mi_risotto: [['ing_arborio', 0.2], ['ing_mushroom', 0.25], ['ing_parmesan', 0.05], ['ing_butter', 0.05], ['ing_stock', 0.5], ['ing_cream', 0.05]],
  mi_pomodoro: [['ing_spaghetti', 0.3], ['ing_tomato', 0.35], ['ing_basil', 0.2], ['ing_oil', 0.02], ['ing_garlic', 0.02], ['ing_parmesan', 0.02]],
  mi_flatbread: [['ing_flour', 0.35], ['ing_mozz', 0.25], ['ing_tomato', 0.2], ['ing_basil', 0.3], ['ing_oil', 0.02]],
  mi_club: [['ing_breast', 0.35], ['ing_bacon', 0.08], ['ing_bun', 1], ['ing_tomato', 0.08], ['ing_romaine', 0.04], ['ing_avocado', 0.25]],
  mi_fries: [['ing_fries', 0.5], ['ing_canola', 0.02], ['ing_ketchup', 0.01], ['ing_salt', 0.01]],
  mi_potdecreme: [['ing_choc', 0.12], ['ing_cream', 0.15], ['ing_eggs', 2], ['ing_sugar', 0.05], ['ing_milk', 0.03]],
};

/** Weekday multipliers Sun..Sat. */
export const WEEKDAY_FACTOR = [1.05, 0.75, 0.8, 0.9, 1.0, 1.3, 1.4];
/** Planted effects (A-5): −10% on rain days; holidays +15%, eves +10%. */
export const RAIN_EFFECT = -0.1;

export const USERS = [
  { id: 'usr_sara', name: 'Sara (Owner)', email: 'sara@harborvine.example', role: 'owner' },
  { id: 'usr_daniel', name: 'Daniel (Chef)', email: 'daniel@harborvine.example', role: 'chef' },
  { id: 'usr_leo', name: 'Leo (Staff)', email: 'leo@harborvine.example', role: 'staff' },
] as const;
export const DEMO_PASSWORD = 'stockpilot-demo';

/**
 * Opening stock targets, as the planned need on the demo morning (Solution Design §D2.2, §D2.4 worked examples):
 * needs inside these pack windows reproduce the documented split (all three from Golden Gate).
 */
export const NEED_TARGETS: Record<string, number> = { ing_patty: 90, ing_thigh: 36, ing_fries: 45 };
/** Usable stock as a multiple of average daily demand for the risk cases. */
export const STOCK_COVER: Record<string, number> = {
  ing_romaine: 0.5, // critical: less than the 1-day lead time
  ing_greens: 1.5, // low: below lead time + safety days
  ing_basil: 0, // shelf-capped: 2-day shelf life < 3-day coverage horizon
  ing_mushroom: 1.2,
  ing_lemon: 1.5,
  ing_mozz: 1.0,
  ing_potato: 1.6,
};
