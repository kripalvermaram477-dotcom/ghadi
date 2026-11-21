import 'dotenv/config';
import { seed } from '../lib/seed.js';

await seed();
console.log('Seed done.');
process.exit(0);
