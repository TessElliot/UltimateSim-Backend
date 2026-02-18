-- =====================================================
-- GLOBAL MAP TILES DATABASE SCHEMA (PostgreSQL)
-- =====================================================
-- This database stores individual tiles fetched by players worldwide.
-- When a player fetches a tile from Overpass, it's saved here
-- so future players can load it instantly from the database!
--
-- NO AUTO-DELETE - All player contributions persist forever
-- =====================================================

CREATE TABLE IF NOT EXISTS bounding_boxes (
  -- Geographic ID (based on lat/lon coordinates)
  id VARCHAR(255) NOT NULL PRIMARY KEY,

  -- Bounding box coordinates
  "minLat" DOUBLE PRECISION,
  "minLon" DOUBLE PRECISION,
  "maxLat" DOUBLE PRECISION,
  "maxLon" DOUBLE PRECISION,

  -- Grid position (stored but not used for lookups)
  x INT,
  y INT,
  order_index INT,

  -- Tile classification
  "landuseType" VARCHAR(100),

  -- Complete OSM data (JSON with elements array, landUses, maxAreaType)
  land_use_data TEXT,

  -- EPA facility/emissions data (JSON blob)
  epa_data TEXT,
  has_epa_data BOOLEAN DEFAULT FALSE,
  epa_fetch_date TIMESTAMP NULL,

  -- Elevation data (meters above sea level)
  elevation DOUBLE PRECISION NULL,

  -- Waterway data (JSON with ftype, name, lengthKm, etc.)
  waterway_data TEXT NULL,

  -- Airport data (JSON with airports array, count, emissions, etc.)
  airport_data TEXT NULL
);

-- =====================================================
-- HOW TO USE THIS FILE
-- =====================================================
-- 1. Connect to your Render PostgreSQL database:
--    psql <your_render_external_connection_string>
--
-- 2. Run this file:
--    \i create_global_map_tiles.sql
--
-- 3. Verify table was created:
--    \dt
--    \d bounding_boxes
--
-- =====================================================
-- USEFUL QUERIES
-- =====================================================

-- Count total tiles in database:
-- SELECT COUNT(*) FROM bounding_boxes;

-- Check for a specific tile by ID:
-- SELECT * FROM bounding_boxes WHERE id = '35.200000_-97.440000' LIMIT 1;

-- See most recent tiles (by order they appear in result):
-- SELECT id, "landuseType", "minLat", "minLon" FROM bounding_boxes LIMIT 10;

-- Count tiles by land use type:
-- SELECT "landuseType", COUNT(*) as count
-- FROM bounding_boxes
-- GROUP BY "landuseType"
-- ORDER BY count DESC;

-- Delete all data (if needed):
-- DELETE FROM bounding_boxes;
