/**
 * migrate_egrid.cjs
 *
 * One-time migration: reads Backend/egrid_plants.json and upserts all plants
 * into the egrid_plants table on the Render PostgreSQL database.
 *
 * Run from project root (needs DATABASE_URL in .env or environment):
 *   node Backend/migrate_egrid.cjs
 *
 * Safe to re-run — uses INSERT ... ON CONFLICT DO UPDATE.
 */

'use strict';

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const fs   = require('fs');
const path = require('path');
const { Pool } = require('pg');

const EGRID_JSON = path.join(__dirname, 'egrid_plants.json');
const BATCH_SIZE = 500; // rows per INSERT statement

async function main() {
    if (!fs.existsSync(EGRID_JSON)) {
        console.error('egrid_plants.json not found. Run the preprocessor first:');
        console.error('  node fetching/preprocess_egrid.cjs');
        process.exit(1);
    }

    const { plants } = JSON.parse(fs.readFileSync(EGRID_JSON, 'utf8'));
    console.log(`Loaded ${plants.length} plants from egrid_plants.json`);

    const pool = new Pool({
        connectionString: process.env.DATABASE_URL,
        ssl: process.env.DATABASE_URL?.includes('render.com')
            ? { rejectUnauthorized: false }
            : undefined,
    });

    const client = await pool.connect();

    try {
        // Create table + indexes if they don't exist
        await client.query(`
            CREATE TABLE IF NOT EXISTS egrid_plants (
                id              INTEGER PRIMARY KEY,
                name            VARCHAR(255) NOT NULL,
                state           CHAR(2),
                lat             DOUBLE PRECISION NOT NULL,
                lon             DOUBLE PRECISION NOT NULL,
                fuel_code       VARCHAR(10),
                fuel_type       VARCHAR(20),
                co2_metric_tons BIGINT DEFAULT 0,
                mwh_gen         BIGINT,
                cap_mw          REAL,
                subrgn          VARCHAR(10)
            )
        `);
        await client.query(`CREATE INDEX IF NOT EXISTS egrid_plants_lat_idx ON egrid_plants (lat)`);
        await client.query(`CREATE INDEX IF NOT EXISTS egrid_plants_lon_idx ON egrid_plants (lon)`);

        // Add subrgn column if table already existed without it
        await client.query(`ALTER TABLE egrid_plants ADD COLUMN IF NOT EXISTS subrgn VARCHAR(10)`);

        console.log('Table and indexes ready.');

        // Batch upsert
        let inserted = 0;
        const totalBatches = Math.ceil(plants.length / BATCH_SIZE);

        for (let i = 0; i < plants.length; i += BATCH_SIZE) {
            const batch = plants.slice(i, i + BATCH_SIZE);
            const batchNum = Math.floor(i / BATCH_SIZE) + 1;

            // Build parameterised VALUES list
            const values = [];
            const params = [];
            let paramIdx = 1;

            for (const p of batch) {
                values.push(
                    `($${paramIdx++}, $${paramIdx++}, $${paramIdx++}, $${paramIdx++}, $${paramIdx++}, $${paramIdx++}, $${paramIdx++}, $${paramIdx++}, $${paramIdx++}, $${paramIdx++}, $${paramIdx++})`
                );
                params.push(
                    p.id,
                    p.name,
                    p.state || null,
                    p.lat,
                    p.lon,
                    p.fuelCode || null,
                    p.fuelType || null,
                    p.co2MetricTons ?? 0,
                    p.mwhGen ?? null,
                    p.capMW ?? null,
                    p.subrgn || null,
                );
            }

            await client.query(
                `INSERT INTO egrid_plants
                    (id, name, state, lat, lon, fuel_code, fuel_type, co2_metric_tons, mwh_gen, cap_mw, subrgn)
                 VALUES ${values.join(', ')}
                 ON CONFLICT (id) DO UPDATE SET
                    name            = EXCLUDED.name,
                    state           = EXCLUDED.state,
                    lat             = EXCLUDED.lat,
                    lon             = EXCLUDED.lon,
                    fuel_code       = EXCLUDED.fuel_code,
                    fuel_type       = EXCLUDED.fuel_type,
                    co2_metric_tons = EXCLUDED.co2_metric_tons,
                    mwh_gen         = EXCLUDED.mwh_gen,
                    cap_mw          = EXCLUDED.cap_mw,
                    subrgn          = EXCLUDED.subrgn`,
                params
            );

            inserted += batch.length;
            console.log(`  Batch ${batchNum}/${totalBatches} — ${inserted}/${plants.length} plants upserted`);
        }

        console.log(`\nDone. ${inserted} plants in egrid_plants table.`);
    } finally {
        client.release();
        await pool.end();
    }
}

main().catch(err => {
    console.error('Migration failed:', err.message);
    process.exit(1);
});
