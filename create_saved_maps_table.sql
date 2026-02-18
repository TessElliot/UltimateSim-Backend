-- =====================================================
-- CROWD-SOURCED MAPS TABLE
-- =====================================================
-- This table stores complete maps fetched by players.
-- When a player loads a new location, it's saved here
-- so future players can load it instantly!
--
-- NO AUTO-DELETE - All player contributions persist forever
-- =====================================================

-- Column names must match Server.cjs: gridWidth, gridHeight, tiles, landUseInfo
CREATE TABLE IF NOT EXISTS saved_maps (
  id INT AUTO_INCREMENT PRIMARY KEY,

  lat DECIMAL(10, 7) NOT NULL,
  lon DECIMAL(10, 7) NOT NULL,

  gridWidth INT NOT NULL,
  gridHeight INT NOT NULL,

  tiles LONGTEXT NOT NULL,
  landUseInfo LONGTEXT NOT NULL,

  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,

  UNIQUE KEY unique_lat_lon (lat, lon),
  INDEX idx_location (lat, lon)

) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =====================================================
-- HOW TO USE THIS FILE
-- =====================================================
-- 1. Open MySQL terminal:
--    mysql -u root -p
--
-- 2. Enter password: Root12345@
--
-- 3. Switch to your database:
--    USE landuseTests;
--
-- 4. Run this file:
--    SOURCE /Users/tesselliot/Documents/US_Claude/fetching/create_saved_maps_table.sql;
--
-- 5. Verify table was created:
--    SHOW TABLES;
--    DESCRIBE saved_maps;
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
-- SELECT lat, lon, grid_width, grid_height, created_at
-- FROM saved_maps
-- ORDER BY created_at DESC
-- LIMIT 10;

-- Check database size:
-- SELECT
--   COUNT(*) as total_maps,
--   ROUND(SUM(LENGTH(tiles_data) + LENGTH(landuse_info)) / 1024 / 1024, 2) as size_mb
-- FROM saved_maps;

-- Delete all test data (if needed):
-- DELETE FROM saved_maps;
