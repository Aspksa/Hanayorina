require('dotenv').config({ quiet: true });
const { Client } = require('pg');
const values = ['PGHOST', 'PGDATABASE', 'PGUSER'].map(k => process.env[k]);
if (!values.some(Boolean)) { console.log('PostgreSQL: не настроен'); process.exit(0); }
if (!values.every(Boolean)) { console.log('PostgreSQL: настройка неполная'); process.exit(1); }
const client = new Client({ connectionTimeoutMillis: 5000 });
client.connect().then(() => client.query('SELECT 1')).then(() => console.log('PostgreSQL: подключение работает')).catch(() => { console.log('PostgreSQL: подключиться не удалось. Проверьте .env и службу базы.'); process.exitCode = 1; }).finally(() => client.end().catch(() => {}));
