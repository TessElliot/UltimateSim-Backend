-- =====================================================
-- CROWD-SOURCED MAPS TABLE (PostgreSQL)
-- =====================================================
-- This table stores complete maps fetched by players.
-- When a player loads a new location, it's saved here
-- so future players can load it instantly!
--
-- NO AUTO-DELETE - All player contributions persist forever
-- =====================================================

-- Column names must match Server.cjs: gridWidth, gridHeight, tiles, landUseInfo
CREATE TABLE IF NOT EXISTS saved_maps (
  id SERIAL PRIMARY KEY,

  lat DECIMAL(10, 7) NOT NULL,
  lon DECIMAL(10, 7) NOT NULL,

  "gridWidth" INT NOT NULL,
  "gridHeight" INT NOT NULL,

  tiles TEXT NOT NULL,
  "landUseInfo" TEXT NOT NULL,

  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

  UNIQUE (lat, lon)
);

CREATE INDEX IF NOT EXISTS idx_saved_maps_location ON saved_maps (lat, lon);

-- =====================================================
-- HOW TO USE THIS FILE
-- =====================================================
-- 1. Connect to your Render PostgreSQL database:
--    psql <your_render_external_connection_string>
--
-- 2. Run this file:
--    \i create_saved_maps_table.sql
--
-- 3. Verify table was created:
--    \dt
--    \d saved_maps
--
-- =====================================================
-- USEFUL QUERIES
-- =====================================================

-- Check if map exists for a location (within ~1km radius):
-- SELECT * FROM saved_maps
-- WHERE ABS(lat - 40.7128) < 0.01 AND ABS(lon - (-74.0060)) < 0.01
-- LIMIT 1;

-- Count total maps in database:
-- SELECT COUNT(*) FROM saved_maps;

-- See most recently added maps:
-- SELECT lat, lon, "gridWidth", "gridHeight", created_at
-- FROM saved_maps
-- ORDER BY created_at DESC
-- LIMIT 10;

-- Delete all test data (if needed):
-- DELETE FROM saved_maps;
