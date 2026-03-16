/**
 * extract_egrid_subregions.cjs
 *
 * Reads the EPA eGRID Excel workbook and extracts:
 *   1. Subregion-level (SRL) resource mix + emission rates → egrid_subregions.json
 *   2. Plant-level subregion assignments → patches subrgn onto egrid_plants.json
 *
 * Prerequisites:
 *   npm install xlsx          (in Backend/)
 *   Download eGRID2023 Excel: https://www.epa.gov/egrid/download-data
 *   Place as Backend/eGRID2023.xlsx (or pass path as first arg)
 *
 * Usage:
 *   node Backend/extract_egrid_subregions.cjs [path/to/eGRID2023.xlsx]
 *
 * Outputs:
 *   Backend/egrid_subregions.json   — static subregion energy mix data
 *   Backend/egrid_plants.json       — updated with subrgn field on each plant
 */

'use strict';

const fs   = require('fs');
const path = require('path');
const XLSX = require('xlsx');

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const DEFAULT_XLSX = path.join(__dirname, 'egrid2023.xlsx');
const PLANTS_JSON  = path.join(__dirname, 'egrid_plants.json');
const OUTPUT_JSON  = path.join(__dirname, 'egrid_subregions.json');

// SRL sheet column mapping (eGRID2023 column names)
// Resource mix columns are percentages of net generation by fuel type
const SRL_COLUMNS = {
    subrgn:     'SUBRGN',       // Subregion abbreviation
    name:       'SRNAME',       // Subregion name
    coal:       'SRCLPR',       // Coal %
    oil:        'SROLPR',       // Oil %
    gas:        'SRGSPR',       // Gas %
    nuclear:    'SRNCPR',       // Nuclear %
    hydro:      'SRHYPR',       // Hydro %
    biomass:    'SRBMPR',       // Biomass %
    wind:       'SRWIPR',       // Wind %
    solar:      'SRSOPR',       // Solar %
    geothermal: 'SRGTPR',       // Geothermal %
    otherFossil:'SROFPR',       // Other fossil %
    otherUnk:   'SROTPR',       // Other unknown %
    co2Rate:    'SRCO2RTA',     // CO₂ emission rate (lb/MWh) — annual total output
    co2eRate:   'SRC2ERTA',     // CO₂-equivalent emission rate (lb/MWh) — includes CH₄, N₂O
    netGenMwh:  'SRNGENAN',     // Annual net generation (MWh)
};

// PLNT sheet — we only need plant ID and subregion
const PLNT_COLUMNS = {
    id:     'ORISPL',   // DOE/EIA plant code
    subrgn: 'SUBRGN',   // Subregion abbreviation
};

// Fuel types to include in the mix (skip if 0%)
const FUEL_KEYS = [
    'coal', 'oil', 'gas', 'nuclear', 'hydro',
    'biomass', 'wind', 'solar', 'geothermal', 'otherFossil', 'otherUnk',
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Read a named sheet from the workbook, returning an array of row objects.
 * eGRID sheets have a header row (row 1 = labels, row 2 = column codes).
 * We use row 2 (the code row) as keys so column names match the docs.
 */
function readSheet(workbook, sheetName) {
    let sheet = workbook.Sheets[sheetName];
    if (!sheet) {
        // Try prefix match (e.g. "SRL" matches "SRL23", "PLNT" matches "PLNT23")
        const target = sheetName.toLowerCase();
        const match = workbook.SheetNames.find(
            s => s.toLowerCase() === target || s.toLowerCase().startsWith(target)
        );
        if (!match) {
            throw new Error(
                `Sheet "${sheetName}" not found. Available: ${workbook.SheetNames.join(', ')}`
            );
        }
        sheet = workbook.Sheets[match];
    }

    // eGRID Excel files have a descriptive header in row 1 and column codes in row 2.
    // XLSX.utils.sheet_to_json uses row 1 as headers by default, so we skip row 1
    // and use row 2 as our header row.
    const rows = XLSX.utils.sheet_to_json(sheet, { header: 1 });

    if (rows.length < 3) {
        throw new Error(`Sheet "${sheetName}" has fewer than 3 rows`);
    }

    // Row index 0 = descriptive labels, row index 1 = column codes
    const codeRow = rows[1];
    const dataRows = rows.slice(2);

    return dataRows
        .filter(row => row.length > 0 && row[0] !== undefined && row[0] !== '')
        .map(row => {
            const obj = {};
            codeRow.forEach((code, i) => {
                if (code) obj[String(code).trim()] = row[i];
            });
            return obj;
        });
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main() {
    const xlsxPath = process.argv[2] || DEFAULT_XLSX;

    if (!fs.existsSync(xlsxPath)) {
        console.error(`\nERROR: Excel file not found at: ${xlsxPath}`);
        console.error('\nDownload eGRID2023 from:');
        console.error('  https://www.epa.gov/egrid/download-data');
        console.error(`\nPlace it at: ${DEFAULT_XLSX}`);
        console.error('Or pass the path as an argument:');
        console.error('  node Backend/extract_egrid_subregions.cjs path/to/eGRID2023.xlsx\n');
        process.exit(1);
    }

    console.log(`Reading ${xlsxPath} ...`);
    const workbook = XLSX.readFile(xlsxPath);
    console.log(`Sheets: ${workbook.SheetNames.join(', ')}`);

    // -----------------------------------------------------------------------
    // 1. Extract subregion-level data
    // -----------------------------------------------------------------------
    console.log('\n--- Extracting subregion-level data (SRL sheet) ---');

    const srlRows = readSheet(workbook, 'SRL');
    console.log(`Found ${srlRows.length} subregion rows`);

    const subregions = {};

    for (const row of srlRows) {
        const code = String(row[SRL_COLUMNS.subrgn] || '').trim();
        if (!code) continue;

        const name = String(row[SRL_COLUMNS.name] || '').trim();

        // Build the fuel mix — only include non-zero entries
        const mix = {};
        for (const key of FUEL_KEYS) {
            const colName = SRL_COLUMNS[key];
            const val = parseFloat(row[colName]);
            if (!isNaN(val) && val > 0) {
                // Round to 1 decimal place
                mix[key] = Math.round(val * 10) / 10;
            }
        }

        const co2Rate = parseFloat(row[SRL_COLUMNS.co2Rate]);
        const co2eRate = parseFloat(row[SRL_COLUMNS.co2eRate]);

        subregions[code] = {
            name,
            mix,
            co2RateLbPerMwh: isNaN(co2Rate) ? null : Math.round(co2Rate * 10) / 10,
            co2eRateLbPerMwh: isNaN(co2eRate) ? null : Math.round(co2eRate * 10) / 10,
        };
    }

    const subregionCount = Object.keys(subregions).length;
    console.log(`Extracted ${subregionCount} subregions`);

    // Write egrid_subregions.json
    const output = {
        generated: new Date().toISOString(),
        source: 'EPA eGRID 2023',
        count: subregionCount,
        subregions,
    };

    fs.writeFileSync(OUTPUT_JSON, JSON.stringify(output, null, 2), 'utf8');
    console.log(`Wrote ${OUTPUT_JSON}`);

    // Print a summary
    for (const [code, data] of Object.entries(subregions)) {
        const topFuels = Object.entries(data.mix)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 3)
            .map(([k, v]) => `${k} ${v}%`)
            .join(', ');
        console.log(`  ${code.padEnd(6)} ${data.name.padEnd(35)} ${topFuels}`);
    }

    // -----------------------------------------------------------------------
    // 2. Patch subrgn onto egrid_plants.json
    // -----------------------------------------------------------------------
    console.log('\n--- Patching subrgn onto plant records (PLNT sheet) ---');

    const plntRows = readSheet(workbook, 'PLNT');
    console.log(`Found ${plntRows.length} plant rows in PLNT sheet`);

    // Build plant ID → subregion lookup
    const plantSubregionMap = new Map();
    for (const row of plntRows) {
        const id = parseInt(row[PLNT_COLUMNS.id], 10);
        const subrgn = String(row[PLNT_COLUMNS.subrgn] || '').trim();
        if (!isNaN(id) && subrgn) {
            plantSubregionMap.set(id, subrgn);
        }
    }
    console.log(`Built lookup for ${plantSubregionMap.size} plants`);

    // Read existing egrid_plants.json and patch
    if (!fs.existsSync(PLANTS_JSON)) {
        console.warn(`Skipping plant patching — ${PLANTS_JSON} not found`);
        return;
    }

    const plantsData = JSON.parse(fs.readFileSync(PLANTS_JSON, 'utf8'));
    let patched = 0;
    let missing = 0;

    for (const plant of plantsData.plants) {
        const subrgn = plantSubregionMap.get(plant.id);
        if (subrgn) {
            plant.subrgn = subrgn;
            patched++;
        } else {
            missing++;
        }
    }

    fs.writeFileSync(PLANTS_JSON, JSON.stringify(plantsData), 'utf8');
    console.log(`Patched ${patched} plants with subrgn (${missing} not found in PLNT sheet)`);
    console.log(`Updated ${PLANTS_JSON}`);

    console.log('\nDone!');
}

main();
