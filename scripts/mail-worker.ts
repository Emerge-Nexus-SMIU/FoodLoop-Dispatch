import 'dotenv/config';
import { deliverMailBatch } from '../src/server/mail';
import { db } from '../src/server/db';
deliverMailBatch()
  .then((v) => console.log(JSON.stringify({ event: 'mail_batch', ...v })))
  .finally(() => db.$disconnect());
