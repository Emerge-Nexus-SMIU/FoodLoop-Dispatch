import 'dotenv/config';
import { db } from '../src/server/db';
import { reconcile } from '../src/server/service';
reconcile()
  .then(() => console.log('Expired windows reconciled.'))
  .finally(() => db.$disconnect());
