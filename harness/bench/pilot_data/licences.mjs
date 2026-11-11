// Licence table of every map, height, landmark and area source named in harness/design/MAP_REPAIR.md "Sources" and
// harness/design/DELHI_WORLD.md "Sources" and "Area division from open data" (P0-018). fetch.mjs opens each licence
// page, looks for the phrases below and records the HTTP status, the date and a checksum of the page; the checked
// table goes into pilot_data.json and world_sources.json. A row whose phrase was not found by the script says so
// (`checked.phraseFound: false`) and keeps the statement as a belief with its origin.
//
// ua: a browser-like client name for sites that refuse a plain one (still no project or personal detail).
// free: allowed in a free public game. sold: allowed in a sold game. Both name the condition.
// layer: map (roads, buildings), height, landmark, area, reference.
export const LICENCES = [
  {
    id: 'osm', source: 'OpenStreetMap', layer: 'map', use: 'road network, building footprints, land use, landmark footprints',
    licence: 'ODbL 1.0', licenceUrl: 'https://www.openstreetmap.org/copyright', phrases: ['Open Data Commons Open Database License', 'ODbL'],
    credit: '© OpenStreetMap contributors', free: 'yes, with the credit line', sold: 'yes, with the credit line',
    conditions: 'A derived database that is shared must be offered under ODbL: the repaired map data is published openly. The game itself is a produced work and only needs the credit.', shipped: true,
  },
  {
    id: 'overture_buildings', source: 'Overture Maps, buildings theme', layer: 'map', use: 'building footprints merged from OSM, Microsoft, Google Open Buildings and Esri (BS1)',
    licence: 'ODbL 1.0', licenceUrl: 'https://docs.overturemaps.org/attribution/', phrases: ['ODbL', 'Open Database License'],
    credit: '© OpenStreetMap contributors, Overture Maps Foundation', free: 'yes, with the credit line', sold: 'yes, with the credit line',
    conditions: 'Same share-alike duty on a shared derived database as OSM.', shipped: true,
  },
  {
    id: 'overture_transportation', source: 'Overture Maps, transportation theme', layer: 'map', use: 'second look at the road network (RS1)',
    licence: 'ODbL 1.0', licenceUrl: 'https://docs.overturemaps.org/attribution/', phrases: ['ODbL', 'Open Database License'],
    credit: '© OpenStreetMap contributors, Overture Maps Foundation', free: 'yes, with the credit line', sold: 'yes, with the credit line',
    conditions: 'Built from OSM. Same share-alike duty.', shipped: false,
  },
  {
    id: 'google_open_buildings', source: 'Google Open Buildings v3', layer: 'map', use: 'building footprints for our own merge (BS2); footprint density for area profiles',
    licence: 'CC BY 4.0 or ODbL 1.0 (the user picks)', licenceUrl: 'https://sites.research.google/gr/open-buildings/', phrases: ['CC BY-4.0', 'ODbL'],
    credit: 'Google Open Buildings (W. Sirko et al., 2021)', free: 'yes, with the credit line', sold: 'yes, with the credit line',
    conditions: 'Under CC BY 4.0 there is no share-alike.', shipped: true,
  },
  {
    id: 'ms_footprints', source: 'Microsoft Global ML Building Footprints', layer: 'map', use: 'building footprints for our own merge (BS2)',
    licence: 'CDLA Permissive 2.0', licenceUrl: 'https://raw.githubusercontent.com/microsoft/GlobalMLBuildingFootprints/main/README.md', phrases: ['CDLA Permissive 2.0'],
    credit: 'Microsoft Global ML Building Footprints', free: 'yes', sold: 'yes',
    conditions: 'The licence text must go with any copy of the data that is shared. No share-alike. The design docs believed ODbL: the repository readme now says CDLA Permissive 2.0 (older releases were ODbL).', shipped: true,
  },
  {
    id: 'gedtm30', source: 'GEDTM30 v1.2 (OpenLandMap, Open-Earth-Monitor)', layer: 'height', use: 'bare-earth ground height (GS1)',
    licence: 'CC BY 4.0', licenceUrl: 'https://zenodo.org/api/records/18887460', phrases: ['cc-by-4.0'],
    credit: 'GEDTM30: Ho, Y.-F. et al., OpenLandMap, CC BY 4.0, doi 10.5281/zenodo.18887460', free: 'yes, with the credit line', sold: 'yes, with the credit line',
    conditions: 'The record says the release is for testing purposes and is provided as is.', shipped: true,
  },
  {
    id: 'glo30', source: 'Copernicus DEM GLO-30 Public', layer: 'height', use: 'surface height with our own ground filter (GS2)',
    licence: 'Copernicus DEM licence (free of charge, any use including commercial, with the notice)', licenceUrl: 'https://registry.opendata.aws/copernicus-dem/', phrases: ['free basis', 'License'],
    licenceText: 'https://docs.sentinel-hub.com/api/latest/static/files/data/dem/resources/license/License-COPDEM-30.pdf',
    credit: '© DLR e.V. 2010-2014 and © Airbus Defence and Space GmbH 2014-2018 provided under COPERNICUS by the European Union and ESA; all rights reserved', free: 'yes, with the notice', sold: 'yes, with the notice',
    conditions: 'The notice must be shown. Adapted data must say it was modified.', shipped: true,
  },
  {
    id: 'fabdem', source: 'FABDEM V1-2 (University of Bristol)', layer: 'height', use: 'yardstick in the bench only (GS3)',
    licence: 'CC BY-NC-SA 4.0', licenceUrl: 'https://data.bris.ac.uk/data/dataset/s5hqmjcdj8yo2ibzi9b4ew3sn', phrases: ['CC BY-NC-SA 4.0', 'Non-Commercial'],
    credit: 'Hawker, L. et al. (2022), FABDEM V1-2, University of Bristol', free: 'only as non-commercial with share-alike on what is built from it', sold: 'no',
    conditions: 'Non-commercial and share-alike. Never shipped and never baked into tiles (decisions.md "Architecture answers, round 1").', shipped: false,
  },
  {
    id: 'cartodem', source: 'CartoDEM (ISRO, Bhuvan)', layer: 'height', use: 'out (GS4)',
    licence: 'needs a Bhuvan account; reuse terms not open', licenceUrl: 'https://bhuvan-app3.nrsc.gov.in/data/download/index.php', phrases: [],
    credit: 'n/a', free: 'unclear', sold: 'unclear', conditions: 'Not fetched: an account is an owner action and the terms are not an open licence.', shipped: false,
  },
  {
    id: 'wikidata', source: 'Wikidata', layer: 'landmark', use: 'landmark coordinates, era, height, ASI monument id, sitelink count',
    licence: 'CC0 1.0', licenceUrl: 'https://www.wikidata.org/wiki/Wikidata:Copyright', phrases: ['Creative Commons CC0', 'CC0'],
    credit: 'none needed (Wikidata, CC0)', free: 'yes', sold: 'yes', conditions: 'None.', shipped: true,
  },
  {
    id: 'wikipedia', source: 'Wikipedia', layer: 'reference', use: 'reference notes for art cards; text never shipped',
    licence: 'CC BY-SA 4.0', licenceUrl: 'https://en.wikipedia.org/wiki/Wikipedia:Copyrights', phrases: ['Creative Commons Attribution-ShareAlike'],
    credit: 'per article', free: 'reference only', sold: 'reference only', conditions: 'Share-alike on copied text, so no text is copied into the game.', shipped: false,
  },
  {
    id: 'commons', source: 'Wikimedia Commons photos', layer: 'reference', use: 'reference photos for landmarks and hero roads, linked by URL',
    licence: 'per file (mostly CC BY or CC BY-SA, some public domain)', licenceUrl: 'https://commons.wikimedia.org/wiki/Commons:Licensing', phrases: ['free content', 'Creative Commons'],
    credit: 'per file', free: 'reference only unless that file allows it', sold: 'reference only unless that file allows it',
    conditions: 'Never baked in or shipped unless that file\'s licence allows it and it is recorded.', shipped: false,
  },
  {
    id: 'mapillary', source: 'Mapillary street photos', layer: 'reference', use: 'reference for hero roads and repairs',
    licence: 'CC BY-SA 4.0 (images)', licenceUrl: 'https://www.mapillary.com/terms', phrases: ['CC BY-SA', 'CC-BY-SA'], ua: 'Mozilla/5.0',
    credit: 'per image', free: 'reference only', sold: 'reference only', conditions: 'Share-alike on copies, so images are only looked at.', shipped: false,
  },
  {
    id: 'asi_list', source: 'ASI list of centrally protected monuments, Delhi circle', layer: 'landmark', use: 'which monuments must exist (names and ids only)',
    licence: 'government website, no open licence; names and list membership are facts', licenceUrl: 'https://asi.nic.in/copyright-policy/', phrases: ['reproduced free of charge', 'may be reproduced'],
    credit: 'Archaeological Survey of India (as the source of the list)', free: 'yes for facts (names, ids, protection status)', sold: 'yes for facts',
    conditions: 'No text or photo is copied from the site. The ASI id comes through Wikidata (P1371, CC0).', shipped: true,
  },
  {
    id: 'mpd_landuse', source: 'Master Plan of Delhi land use maps (DDA)', layer: 'area', use: 'evidence for area polygons',
    licence: 'government publication, no open licence found', licenceUrl: 'https://dda.gov.in/', phrases: [],
    credit: 'Delhi Development Authority (as a reference)', free: 'reference only', sold: 'reference only',
    conditions: 'Scanned PDFs. Read as evidence, never traced into shipped data.', shipped: false,
  },
  {
    id: 'census2011', source: 'Census of India 2011 ward and town data (data.gov.in)', layer: 'area', use: 'population and density per ward',
    licence: 'Government Open Data License, India (GODL)', licenceUrl: 'https://www.data.gov.in/Godl', phrases: ['Government Open Data License'], ua: 'Mozilla/5.0',
    licenceText: 'https://www.data.gov.in/sites/default/files/Gazette_Notification_OGDL.pdf',
    credit: 'Office of the Registrar General and Census Commissioner, India; data.gov.in', free: 'yes, with the credit line', sold: 'yes, with the credit line',
    conditions: 'Attribution. Applies to data published on data.gov.in.', shipped: true,
  },
  {
    id: 'ward_boundaries', source: 'Ward boundaries from open repositories (DataMeet Municipal_Spatial_Data)', layer: 'area', use: 'polygons to hang profiles on',
    licence: 'CC BY 4.0 (the repository readme: every dataset unless it says otherwise)', licenceUrl: 'https://raw.githubusercontent.com/datameet/Municipal_Spatial_Data/master/Readme.md', phrases: ['CC BY 4.0'],
    credit: 'DataMeet Municipal Spatial Data (with a link to the dataset)', free: 'yes, with the credit line', sold: 'yes, with the credit line',
    conditions: 'The Delhi folder must be read for a note that says otherwise before use. Not downloaded: AD2 does not need wards.', shipped: false,
  },
  {
    id: 'osm_landuse', source: 'OSM landuse, place and colony tags', layer: 'area', use: 'seeds of the area polygons',
    licence: 'ODbL 1.0', licenceUrl: 'https://www.openstreetmap.org/copyright', phrases: ['Open Data Commons Open Database License', 'ODbL'],
    credit: '© OpenStreetMap contributors', free: 'yes, with the credit line', sold: 'yes, with the credit line', conditions: 'As OSM above.', shipped: true,
  },
  {
    id: 'sentinel2', source: 'Sentinel-2 imagery (NDVI, reference)', layer: 'area', use: 'greenery per cell; reference for repairs',
    licence: 'Copernicus Sentinel data terms (free, full and open)', licenceUrl: 'https://sentinels.copernicus.eu/documents/247904/690755/Sentinel_Data_Legal_Notice', phrases: [],
    credit: 'Contains modified Copernicus Sentinel data [year]', free: 'yes, with the notice', sold: 'yes, with the notice',
    conditions: 'The notice must be shown when data is adapted.', shipped: false,
  },
  {
    id: 'viirs', source: 'VIIRS night lights (EOG annual VNL)', layer: 'area', use: 'activity proxy at coarse scale',
    licence: 'CC BY 4.0', licenceUrl: 'https://eogdata.mines.edu/products/vnl/', phrases: ['CC BY 4.0', 'Creative Commons'],
    credit: 'Earth Observation Group, Payne Institute for Public Policy, Colorado School of Mines', free: 'yes, with the credit line', sold: 'yes, with the credit line',
    conditions: 'Downloads need a free account (an owner action). About 500 m cells: too coarse for the pilot districts.', shipped: false,
  },
  {
    id: 'open_buildings_25d', source: 'Google Open Buildings 2.5D Temporal', layer: 'map', use: 'building heights (if time)',
    licence: 'CC BY 4.0', licenceUrl: 'https://sites.research.google/gr/open-buildings/temporal/', phrases: ['CC BY-4.0', 'CC BY 4.0'],
    credit: 'Google Open Buildings 2.5D Temporal (W. Sirko et al., 2023)', free: 'yes, with the credit line', sold: 'yes, with the credit line',
    conditions: 'Served through Earth Engine or large tiles; the fetch needs an account (an owner action).', shipped: false,
  },
];
