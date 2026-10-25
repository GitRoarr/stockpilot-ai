import { config } from '../../config.js';
import { openDb, setDb } from '../sqlite.js';
import { seedDemo } from './demo.js';

// `npm run seed [-- --offline]`: resets the database to the illustrative demo (SRS FR-001) and prints the logins.
const offline = process.argv.includes('--offline');
const db = openDb(config.DATABASE_PATH);
setDb(db);
const t0 = Date.now();
const r = await seedDemo({ offline });
console.log(`\nStockPilot AI — sample data loaded into ${config.DATABASE_PATH} (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
console.log('[Sample data] Harbor & Vine Bistro, San Francisco — USD. Not verified market data.\n');
console.log(`Counts: ${Object.entries(r.counts).map(([k, v]) => `${k}=${v}`).join(', ')}`);
console.log(`Weather history: ${r.weatherSource}; holidays: ${r.holidays}`);
if (r.demoPlan) console.log(`Demo morning plan: $${r.demoPlan.total.toFixed(2)} vs baseline $${r.demoPlan.baseline.toFixed(2)} (saving $${r.demoPlan.saving.toFixed(2)}, ${r.demoPlan.method}); Golden Gate: ${r.demoPlan.goldenGateLines.join(', ')}`);
for (const w of r.warnings) console.log(`! ${w}`);
console.log('\nLogins:');
for (const u of r.users) console.log(`  ${u.role.padEnd(6)} ${u.email.padEnd(28)} password: ${u.password}`);
db.close();
