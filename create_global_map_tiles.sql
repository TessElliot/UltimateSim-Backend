-- =====================================================
-- GLOBAL MAP TILES DATABASE SCHEMA
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
  minLat DOUBLE,
  minLon DOUBLE,
  maxLat DOUBLE,
  maxLon DOUBLE,

  -- Grid position (stored but not used for lookups)
  x INT,
  y INT,
  order_index INT,

  -- Tile classification
  landuseType VARCHAR(100),

  -- Complete OSM data (JSON with elements array, landUses, maxAreaType)
  land_use_data LONGTEXT,

  -- EPA facility/emissions data (JSON blob)
  epa_data LONGTEXT,
  has_epa_data BOOLEAN DEFAULT FALSE,
  epa_fetch_date TIMESTAMP NULL,

  -- Elevation data (meters above sea level)
  elevation DOUBLE NULL,

  -- Waterway data (JSON with ftype, name, lengthKm, etc.)
  waterway_data LONGTEXT NULL,

  -- Airport data (JSON with airports array, count, emissions, etc.)
  airport_data LONGTEXT NULL

) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =====================================================
-- MIGRATION FOR EXISTING DATABASES
-- =====================================================
-- Run this if you already have a bounding_boxes table:
--
-- Migration 1: Add EPA columns (if not already present)
-- ALTER TABLE bounding_boxes
--   ADD COLUMN epa_data LONGTEXT,
--   ADD COLUMN has_epa_data BOOLEAN DEFAULT FALSE,
--   ADD COLUMN epa_fetch_date TIMESTAMP NULL;
--
-- Migration 2: Add elevation, waterway, airport columns
-- ALTER TABLE bounding_boxes
--   ADD COLUMN elevation DOUBLE NULL,
--   ADD COLUMN waterway_data LONGTEXT NULL,
--   ADD COLUMN airport_data LONGTEXT NULL;

-- =====================================================
-- HOW TO USE THIS FILE
-- =====================================================
-- 1. Create the database:
--    mysql -u root -pRoot12345@ -e "CREATE DATABASE global_map_tiles;"
--
-- 2. Create the table:
--    mysql -u root -pRoot12345@ global_map_tiles < create_global_map_tiles.sql
--
-- 3. Verify table was created:
--    mysql -u root -pRoot12345@ global_map_tiles -e "DESCRIBE bounding_boxes;"
--
-- =====================================================
-- USEFUL QUERIES
-- =====================================================

-- Count total tiles in database:
-- SELECT COUNT(*) FROM bounding_boxes;

-- Check for a specific tile by ID:
-- SELECT * FROM bounding_boxes WHERE id = '35.200000_-97.440000' LIMIT 1;

-- See most recent tiles (by order they appear in result):
-- SELECT id, landuseType, minLat, minLon FROM bounding_boxes LIMIT 10;

-- Count tiles by land use type:
-- SELECT landuseType, COUNT(*) as count
-- FROM bounding_boxes
-- GROUP BY landuseType
-- ORDER BY count DESC;

-- Delete all data (if needed):
-- DELETE FROM bounding_boxes;
