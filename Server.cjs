require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });
const express = require("express");
const path = require("path");
const cors = require("cors");
const mysql = require("mysql2/promise"); // Use mysql2/promise for async/await
const zlib = require("zlib");
const { promisify } = require("util");
const gunzip = promisify(zlib.gunzip);
const app = express();
const port = process.env.PORT || 8800;

// Catch uncaught errors so the process doesn't crash
process.on('uncaughtException', (err) => {
  console.error('Uncaught Exception:', err);
});
process.on('unhandledRejection', (err) => {
  console.error('Unhandled Rejection:', err);
});

// =====================================================
// REQUEST TIMING MIDDLEWARE — logs every request with duration
// =====================================================
app.use((req, res, next) => {
  const start = Date.now();
  const method = req.method;
  const url = req.originalUrl || req.url;
  console.log(`[REQ] --> ${method} ${url}`);
  res.on('finish', () => {
    const duration = Date.now() - start;
    const status = res.statusCode;
    const tag = duration > 2000 ? ' ⚠️ SLOW' : '';
    console.log(`[REQ] <-- ${method} ${url} ${status} ${duration}ms${tag}`);
  });
  next();
});

// CORS - allow frontend origin
app.use(cors({ origin: ["https://ultimatesim.live", "https://www.ultimatesim.live", "https://ultimatesimgame.netlify.app", "http://localhost:8800"] }));

// Health check endpoint for Render
app.get("/health", (req, res) => {
  res.json({ status: "ok", uptime: process.uptime() });
});

// JSON payload size limit (keep reasonable for Render's 512MB RAM)
app.use(express.json({ limit: "10mb" }));

// URL-encoded payload size limit
app.use(express.urlencoded({ limit: "10mb", extended: true }));
// Use the path module to serve static files
app.use(express.static(path.join(__dirname, ".."), { maxAge: '1h' }));

// Get the request from root and serve the static files
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "../", "index.html"));
});

// Connection Pool setup (using mysql2/promise)
const pool = mysql.createPool({
  host: process.env.DB_HOST || "localhost",
  user: process.env.DB_USER || "root",
  password: process.env.DB_PASSWORD || "Root12345@",
  database: process.env.DB_NAME || "global_map_tiles",
  port: parseInt(process.env.DB_PORT || "3306"),
  waitForConnections: true,
  connectionLimit: 5,
  queueLimit: 0,
  ssl: process.env.DB_HOST ? {} : undefined,
});

// Prevent pool errors from crashing the process
pool.on('error', (err) => {
  console.error('MySQL pool error:', err);
});
app.get("/closestBbox", async (req, res) => {
    try {
        console.log("[closestBbox] Searching for closest bbox...");
        const queryParams = req.query;
        const userLat = parseFloat(queryParams.lat);
        const userLon = parseFloat(queryParams.lon);

        console.log(`[closestBbox] User location: ${userLat}, ${userLon}`);

        const tQuery = Date.now();
        const [closestTile] = await pool.execute(
            `SELECT *,
        POW(minLat - ?, 2) + POW(minLon - ?, 2) as distance
       FROM bounding_boxes
       ORDER BY distance ASC
       LIMIT 1;`,
            [userLat, userLon]
        );
        console.log(`[closestBbox] DB query: ${Date.now() - tQuery}ms`);

        if (closestTile.length > 0) {
            console.log(`[closestBbox] Found match: ${closestTile[0].minLat}, ${closestTile[0].minLon}`);
            res.json(closestTile);
        } else {
            console.log("[closestBbox] No bounding boxes found in database");
            res.json([]);
        }
    } catch (error) {
        console.error("[closestBbox] Error:", error);
        res.status(500).json({ error: error.message });
    }
});
// Middleware to parse JSON requests
app.use(express.json());

// Function to fetch land use data for multiple bounding boxes
async function getLandUseDataForBoxes(boundingBoxes) {
  // Prepare the list of box IDs
  const boxIds = boundingBoxes.map((box) => box.id);

  // SQL query to fetch land use data for multiple bounding boxes
  const query = `
  SELECT id, landuseType, land_use_data
  FROM bounding_boxes
  WHERE id IN (?);
`;

    const [rows] = await pool.query(query, boxIds);

  try {
    // Execute the query with a single database connection
    const [rows] = await pool.query(query, [boxIds]);
    console.log("Rows from DB:", rows);

    // Format the result in the required structure
    const result = boundingBoxes.map((box) => {
      const matchingRow = rows.find((row) => row.id === box.id);
      if (!matchingRow) {
        throw new Error(`No matching landuse type found for box id: ${box.id}`);
      }
      return {
        id: box.id,
        landuseType: matchingRow.landuseType,
        landUseData: JSON.parse(matchingRow.land_use_data),
      };
    });

    return result;
  } catch (error) {
    console.error("Error fetching land use data:", error);
    throw new Error("Failed to fetch land use data.");
  }
}

// Handle POST request for initial box data
app.post("/initialBox", async (req, res) => {
  const boundingBoxes = req.body; // Get the bounding boxes sent from the client
    console.log("Received boundingBoxes:", boundingBoxes);
  try {
    // Fetch land use data for all bounding boxes
    const landUseData = await getLandUseDataForBoxes(boundingBoxes);

    // Return the results to the client
    res.json(landUseData);
  } catch (error) {
    console.error("Error:", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

// =====================================================
// CROWD-SOURCED MAPS ENDPOINTS (NEW)
// =====================================================

// Save individual tile to crowd-sourced database (from Overpass fetches)
app.post("/saveTile", async (req, res) => {
  try {
    const { id, minLat, minLon, maxLat, maxLon, landuseType, land_use_data } = req.body;

    // Validate required fields
    if (!id || !minLat || !minLon || !maxLat || !maxLon || !landuseType || !land_use_data) {
      return res.status(400).json({
        error: "Missing required fields: id, minLat, minLon, maxLat, maxLon, landuseType, land_use_data"
      });
    }

    // Insert or update tile (geographic ID makes tiles shareable across users)
    const insertQuery = `
      INSERT INTO bounding_boxes (
        id, minLat, minLon, maxLat, maxLon, landuseType, land_use_data
      )
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE
        landuseType=VALUES(landuseType),
        land_use_data=VALUES(land_use_data)
    `;

    await pool.execute(insertQuery, [
      id,
      minLat,
      minLon,
      maxLat,
      maxLon,
      landuseType,
      land_use_data
    ]);

    res.json({ success: true });

  } catch (error) {
    console.error("Error in /saveTile:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get single tile from bounding_boxes by ID
app.get("/getTile", async (req, res) => {
  try {
    const tileId = req.query.id;

    if (!tileId) {
      return res.status(400).json({ error: "Missing tile ID" });
    }

    const [rows] = await pool.query(
      `SELECT id, landuseType, land_use_data
       FROM bounding_boxes
       WHERE id = ?
       LIMIT 1`,
      [tileId]
    );

    if (rows.length > 0) {
      res.json({
        exists: true,
        tile: {
          id: rows[0].id,
          landuseType: rows[0].landuseType,
          landUseData: JSON.parse(rows[0].land_use_data)
        }
      });
    } else {
      res.json({ exists: false });
    }
  } catch (error) {
    console.error("Error in /getTile:", error);
    res.status(500).json({ error: error.message });
  }
});

// Batch check for multiple tiles (for batched Overpass approach)
app.post("/getTilesBatch", async (req, res) => {
  try {
    const { tileIds } = req.body;

    if (!tileIds || !Array.isArray(tileIds) || tileIds.length === 0) {
      return res.status(400).json({ error: "Missing or invalid tileIds array" });
    }

    // Cap batch size to prevent OOM
    const MAX_BATCH = 500;
    const limitedIds = tileIds.slice(0, MAX_BATCH);
    if (tileIds.length > MAX_BATCH) {
      console.warn(`⚠️ Batch request truncated from ${tileIds.length} to ${MAX_BATCH} tiles`);
    }

    console.log(`📊 Batch checking ${limitedIds.length} tiles in database...`);

    // Use IN clause for efficient batch lookup
    const placeholders = limitedIds.map(() => '?').join(',');
    const [rows] = await pool.query(
      `SELECT id, landuseType, land_use_data, epa_data, has_epa_data, epa_fetch_date,
              elevation, waterway_data, airport_data
       FROM bounding_boxes
       WHERE id IN (${placeholders})`,
      limitedIds
    );

    // Return as map for O(1) lookup on client
    const tilesMap = {};
    for (const row of rows) {
      try {
        const tile = {
          landuseType: row.landuseType,
          landUseData: JSON.parse(row.land_use_data)
        };
        // Include EPA data if present
        if (row.has_epa_data && row.epa_data) {
          tile.epaData = JSON.parse(row.epa_data);
          tile.hasEpaData = true;
          tile.epaFetchDate = row.epa_fetch_date;
        } else {
          tile.hasEpaData = false;
        }
        // Include elevation if present
        if (row.elevation !== null) {
          tile.elevation = row.elevation;
        }
        // Include waterway data if present
        if (row.waterway_data) {
          tile.waterwayData = JSON.parse(row.waterway_data);
        }
        // Include airport data if present
        if (row.airport_data) {
          tile.airportData = JSON.parse(row.airport_data);
        }
        tilesMap[row.id] = tile;
      } catch (parseError) {
        console.warn(`Failed to parse data for tile ${row.id}`);
      }
    }

    console.log(`💾 Found ${Object.keys(tilesMap).length} tiles in database`);
    res.json({ tiles: tilesMap });
  } catch (error) {
    console.error("Error in /getTilesBatch:", error);
    res.status(500).json({ error: error.message });
  }
});

// Batch save multiple tiles (for batched Overpass approach)
app.post("/saveTilesBatch", async (req, res) => {
  try {
    const { tiles } = req.body;

    if (!tiles || !Array.isArray(tiles) || tiles.length === 0) {
      return res.status(400).json({ error: "Missing or invalid tiles array" });
    }

    console.log(`💾 Batch saving ${tiles.length} tiles to database...`);

    // Debug: Log EPA data presence
    const tilesWithEpa = tiles.filter(t => t.epa_data).length;
    const tilesWithAirport = tiles.filter(t => t.airport_data).length;
    console.log(`📊 Tiles with EPA: ${tilesWithEpa}, Airport: ${tilesWithAirport}`);
    if (tilesWithEpa > 0) {
      const epaTile = tiles.find(t => t.epa_data);
      console.log(`📊 Sample EPA tile ID: ${epaTile.id}`);
      console.log(`📊 EPA data: ${JSON.stringify(epaTile.epa_data).substring(0, 200)}...`);
    }

    // Build batch insert with ON DUPLICATE KEY UPDATE (including EPA, elevation, waterway, airport data)
    const values = tiles.map(t => [
      t.id,
      t.minLat,
      t.minLon,
      t.maxLat,
      t.maxLon,
      t.landuseType,
      t.land_use_data,
      t.epa_data ? JSON.stringify(t.epa_data) : null,
      t.epa_data ? true : false,
      t.epa_data ? new Date() : null,
      t.elevation !== undefined && t.elevation !== null ? t.elevation : null,
      t.waterway_data ? JSON.stringify(t.waterway_data) : null,
      t.airport_data ? JSON.stringify(t.airport_data) : null
    ]);

    const [result] = await pool.query(
      `INSERT INTO bounding_boxes (id, minLat, minLon, maxLat, maxLon, landuseType, land_use_data, epa_data, has_epa_data, epa_fetch_date, elevation, waterway_data, airport_data)
       VALUES ?
       ON DUPLICATE KEY UPDATE
         landuseType=VALUES(landuseType),
         land_use_data=VALUES(land_use_data),
         epa_data=VALUES(epa_data),
         has_epa_data=VALUES(has_epa_data),
         epa_fetch_date=VALUES(epa_fetch_date),
         elevation=VALUES(elevation),
         waterway_data=VALUES(waterway_data),
         airport_data=VALUES(airport_data)`,
      [values]
    );

    console.log(`✅ Saved ${tiles.length} tiles - affectedRows: ${result.affectedRows}, changedRows: ${result.changedRows}`);
    res.json({ success: true, count: tiles.length });
  } catch (error) {
    console.error("Error in /saveTilesBatch:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Check if a full map exists in database by lat/lon
app.get("/checkMap", async (req, res) => {
  try {
    const lat = parseFloat(req.query.lat);
    const lon = parseFloat(req.query.lon);

    if (isNaN(lat) || isNaN(lon)) {
      return res.status(400).json({ error: "Invalid lat/lon parameters" });
    }

    console.log(`🔍 Checking for saved map at ${lat}, ${lon}...`);

    const [rows] = await pool.query(
      `SELECT id, lat, lon, gridWidth, gridHeight, tiles, landUseInfo, created_at
       FROM saved_maps
       WHERE lat = ? AND lon = ?
       LIMIT 1`,
      [lat, lon]
    );

    if (rows.length > 0) {
      const row = rows[0];
      console.log(`✅ Found saved map at ${lat}, ${lon}`);
      res.json({
        exists: true,
        mapData: {
          gridWidth: row.gridWidth,
          gridHeight: row.gridHeight,
          tiles: JSON.parse(row.tiles),
          landUseInfo: JSON.parse(row.landUseInfo)
        }
      });
    } else {
      console.log(`❌ No saved map at ${lat}, ${lon}`);
      res.json({ exists: false });
    }
  } catch (error) {
    console.error("Error in /checkMap:", error);
    res.status(500).json({ error: error.message });
  }
});

// Save a full map to database (accepts gzip-compressed body)
app.post("/saveMap", express.raw({ type: 'application/octet-stream', limit: '20mb' }), async (req, res) => {
  try {
    let data;

    // Check if body is gzip compressed
    if (req.headers['content-encoding'] === 'gzip') {
      const decompressed = await gunzip(req.body);
      data = JSON.parse(decompressed.toString('utf8'));
      console.log(`📦 Decompressed payload: ${req.body.length} -> ${decompressed.length} bytes`);
    } else {
      data = JSON.parse(req.body.toString('utf8'));
    }

    const { lat, lon, gridWidth, gridHeight, tiles, landUseInfo } = data;

    if (lat === undefined || lon === undefined || !gridWidth || !gridHeight || !tiles) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    console.log(`💾 Saving map at ${lat}, ${lon} (${gridWidth}x${gridHeight})...`);

    // Insert or update the map
    await pool.query(
      `INSERT INTO saved_maps (lat, lon, gridWidth, gridHeight, tiles, landUseInfo)
       VALUES (?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         gridWidth = VALUES(gridWidth),
         gridHeight = VALUES(gridHeight),
         tiles = VALUES(tiles),
         landUseInfo = VALUES(landUseInfo)`,
      [lat, lon, gridWidth, gridHeight, JSON.stringify(tiles), JSON.stringify(landUseInfo || {})]
    );

    console.log(`✅ Saved map at ${lat}, ${lon}`);
    res.json({ success: true });
  } catch (error) {
    console.error("Error in /saveMap:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// =====================================================
// END CROWD-SOURCED MAPS ENDPOINTS
// =====================================================

// =====================================================
// ELEVATION PROXY (avoids CORS issues with Open Topo Data)
// =====================================================

// Proxy elevation requests to Open Topo Data API
app.post("/elevation", async (req, res) => {
  try {
    const { locations } = req.body;

    if (!locations || !Array.isArray(locations) || locations.length === 0) {
      return res.status(400).json({ error: "Missing or invalid locations array" });
    }

    // Format: lat,lon|lat,lon|...
    const locationsStr = locations.map(p => `${p.lat},${p.lon}`).join('|');
    const url = `https://api.opentopodata.org/v1/srtm90m?locations=${locationsStr}`;

    console.log(`🏔️ Fetching elevation for ${locations.length} points...`);

    const response = await fetch(url);

    if (!response.ok) {
      console.error(`Elevation API error: ${response.status}`);
      return res.status(response.status).json({ error: `Upstream error: ${response.status}` });
    }

    const data = await response.json();
    console.log(`✅ Elevation received for ${data.results?.length || 0} points`);

    res.json(data);
  } catch (error) {
    console.error("Error in /elevation:", error);
    res.status(500).json({ error: error.message });
  }
});

// =====================================================
// END ELEVATION PROXY
// =====================================================

// =====================================================
// WATERWAYS PROXY (USGS National Hydrography Dataset)
// =====================================================

// Proxy waterway requests to USGS NHD API
// Queries multiple layers: major rivers, major water bodies, swamps/inundation
app.post("/waterways", async (req, res) => {
  try {
    const { minLat, minLon, maxLat, maxLon } = req.body;

    if (minLat === undefined || minLon === undefined ||
        maxLat === undefined || maxLon === undefined) {
      return res.status(400).json({ error: "Missing bounding box parameters" });
    }

    // Note: ArcGIS expects bbox as xmin,ymin,xmax,ymax (lon,lat order)
    const bbox = `${minLon},${minLat},${maxLon},${maxLat}`;
    const baseUrl = 'https://hydro.nationalmap.gov/arcgis/rest/services/nhd/MapServer';

    // Layers to query:
    // Layer 1 = Small Scale Flowlines (continental-scale major rivers)
    // Layer 3 = Small Scale Polygons (major water bodies)
    // Layer 5 = Large Scale Areas (swamps, inundation areas)
    // Layer 6 = Large Scale Flowlines (detailed rivers, streams - includes Hudson River etc.)
    const layers = [
      { id: 1, name: 'rivers', fields: 'OBJECTID,gnis_name,ftype,fcode,lengthkm,reachcode' },
      { id: 6, name: 'rivers_detailed', fields: 'OBJECTID,gnis_name,ftype,fcode,lengthkm,reachcode' },
      { id: 3, name: 'waterbodies', fields: 'OBJECTID,gnis_name,ftype,fcode,areasqkm' },
      { id: 5, name: 'areas', fields: 'OBJECTID,gnis_name,ftype,fcode,areasqkm' }
    ];

    console.log(`🌊 Fetching waterways for bbox: ${bbox}`);

    // Query all layers in parallel
    const requests = layers.map(layer => {
      const params = new URLSearchParams({
        f: 'json',
        geometry: bbox,
        geometryType: 'esriGeometryEnvelope',
        inSR: '4326',
        outSR: '4326',
        spatialRel: 'esriSpatialRelIntersects',
        outFields: layer.fields,
        returnGeometry: 'true'
      });
      return fetch(`${baseUrl}/${layer.id}/query?${params}`)
        .then(r => r.ok ? r.json() : { features: [] })
        .then(data => {
          // Tag each feature with its layer type
          if (data.features) {
            data.features.forEach(f => f.layerType = layer.name);
          }
          return data;
        })
        .catch(() => ({ features: [] }));
    });

    const results = await Promise.all(requests);

    // Combine all features
    const allFeatures = results.flatMap(r => r.features || []);

    console.log(`✅ Waterways received: ${allFeatures.length} features (rivers_small: ${results[0].features?.length || 0}, rivers_detailed: ${results[1].features?.length || 0}, waterbodies: ${results[2].features?.length || 0}, areas: ${results[3].features?.length || 0})`);

    res.json({ features: allFeatures });
  } catch (error) {
    console.error("Error in /waterways:", error);
    res.status(500).json({ error: error.message });
  }
});

// =====================================================
// END WATERWAYS PROXY
// =====================================================

// =====================================================
// AIRPORTS PROXY (FAA ArcGIS US Airport FeatureServer)
// =====================================================

app.post("/airports", async (req, res) => {
  try {
    const { minLat, minLon, maxLat, maxLon } = req.body;

    if (minLat === undefined || minLon === undefined ||
        maxLat === undefined || maxLon === undefined) {
      return res.status(400).json({ error: "Missing bounding box parameters" });
    }

    const FAA_AIRPORT_URL = "https://services6.arcgis.com/ssFJjBXIUyZDrSYZ/arcgis/rest/services/US_Airport/FeatureServer/0/query";

    const params = new URLSearchParams({
      where: '1=1',
      geometry: JSON.stringify({
        xmin: minLon,
        ymin: minLat,
        xmax: maxLon,
        ymax: maxLat,
        spatialReference: { wkid: 4326 }
      }),
      geometryType: 'esriGeometryEnvelope',
      inSR: '4326',
      spatialRel: 'esriSpatialRelIntersects',
      outFields: 'IDENT,NAME,LATITUDE,LONGITUDE,ELEVATION,ICAO_ID,TYPE_CODE,SERVCITY,STATE,OPERSTATUS,PRIVATEUSE,MIL_CODE',
      returnGeometry: true,
      outSR: '4326',
      f: 'json'
    });

    console.log(`✈️ Fetching airports for bbox: ${minLon},${minLat},${maxLon},${maxLat}`);

    const response = await fetch(`${FAA_AIRPORT_URL}?${params}`);

    if (!response.ok) {
      console.error(`FAA API error: ${response.status}`);
      return res.status(response.status).json({ error: `Upstream error: ${response.status}` });
    }

    const data = await response.json();

    if (data.error) {
      console.warn('FAA ArcGIS error:', data.error.message);
      return res.json({ features: [] });
    }

    console.log(`✅ Airports received: ${data.features?.length || 0} features`);
    res.json({ features: data.features || [] });
  } catch (error) {
    console.error("Error in /airports:", error);
    res.status(500).json({ error: error.message });
  }
});

// =====================================================
// END AIRPORTS PROXY
// =====================================================

// =====================================================
// GENERIC URL PROXY (for CORS-restricted resources)
// =====================================================

// Proxy requests to external URLs that have CORS restrictions
// Used for data center dataset from GitHub, etc.
app.get("/proxy", async (req, res) => {
  try {
    const targetUrl = req.query.url;

    if (!targetUrl) {
      return res.status(400).json({ error: "Missing 'url' query parameter" });
    }

    // Validate URL (only allow certain domains for security)
    const allowedDomains = [
      'raw.githubusercontent.com',
      'github.com',
      'data.pnnl.gov',
      'im3.pnnl.gov'
    ];

    const url = new URL(targetUrl);
    if (!allowedDomains.some(domain => url.hostname.endsWith(domain))) {
      return res.status(403).json({
        error: `Domain not allowed: ${url.hostname}. Allowed: ${allowedDomains.join(', ')}`
      });
    }

    console.log(`🔗 Proxying request to: ${targetUrl}`);

    const response = await fetch(targetUrl);

    if (!response.ok) {
      console.error(`Proxy error: ${response.status} for ${targetUrl}`);
      return res.status(response.status).json({ error: `Upstream error: ${response.status}` });
    }

    // Forward content-type header
    const contentType = response.headers.get('content-type');
    if (contentType) {
      res.setHeader('Content-Type', contentType);
    }

    // Stream the response body
    const data = await response.text();
    console.log(`✅ Proxy success: ${data.length} bytes from ${url.hostname}`);

    // Try to parse as JSON if it looks like JSON
    if (contentType?.includes('json') || data.trim().startsWith('[') || data.trim().startsWith('{')) {
      try {
        res.json(JSON.parse(data));
      } catch {
        res.send(data);
      }
    } else {
      res.send(data);
    }
  } catch (error) {
    console.error("Error in /proxy:", error);
    res.status(500).json({ error: error.message });
  }
});

// =====================================================
// END GENERIC URL PROXY
// =====================================================

// =====================================================
// DATABASE ADMIN ENDPOINTS
// =====================================================

// Clear all cached tiles (for development/testing)
app.post("/clearTiles", async (req, res) => {
  try {
    console.log("🗑️ Clearing all cached tiles from bounding_boxes...");

    await pool.query("TRUNCATE TABLE bounding_boxes");

    console.log("✅ All tiles cleared successfully");
    res.json({ success: true, message: "All tiles cleared" });
  } catch (error) {
    console.error("Error in /clearTiles:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// =====================================================
// END DATABASE ADMIN ENDPOINTS
// =====================================================

// Start the server
app.listen(port, () => {
  console.log(`Server listening on port ${port}`);
});
