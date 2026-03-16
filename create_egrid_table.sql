-- create_egrid_table.sql
-- Run once on the Render PostgreSQL database to create the eGRID plants table.
--
-- Usage:
--   psql $DATABASE_URL -f Backend/create_egrid_table.sql

CREATE TABLE IF NOT EXISTS egrid_plants (
    id          INTEGER PRIMARY KEY,   -- DOE/EIA ORIS plant code (unique)
    name        VARCHAR(255) NOT NULL,
    state       CHAR(2),
    lat         DOUBLE PRECISION NOT NULL,
    lon         DOUBLE PRECISION NOT NULL,
    fuel_code   VARCHAR(10),           -- Raw eGRID code (NG, BIT, SUN, WND, …)
    fuel_type   VARCHAR(20),           -- Mapped game type (gas, coal, solar, wind, …)
    co2_metric_tons BIGINT DEFAULT 0,  -- Annual CO2 in metric tons (0 for renewables)
    mwh_gen     BIGINT,                -- Annual net generation (MWh)
    cap_mw      REAL,                  -- Nameplate capacity (MW)
    subrgn      VARCHAR(10)            -- eGRID subregion code (e.g. CAMX, ERCT)
);

-- Index for fast bounding-box queries (lat/lon range scans)
CREATE INDEX IF NOT EXISTS egrid_plants_lat_idx ON egrid_plants (lat);
CREATE INDEX IF NOT EXISTS egrid_plants_lon_idx ON egrid_plants (lon);
