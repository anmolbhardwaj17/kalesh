// Map inspector colours (P1-039): the Kalesh HUD palette (STYLE_BIBLE.md "HUD": warm dark glass, warm white text,
// marigold, danger red, police blue, lead green) on a dark map, with the world palette (asphalt, paver, concrete,
// leaf) darkened for the ground layers. The CSS tokens in style.css use the same values.
export const SEV = {
  high: '#ff3b36', // danger
  open: '#ffb224', // marigold: needs you
  auto: '#7ee2a8', // fixed by itself or left as it is
  picked: '#5aaeff', // police blue: you picked a fix
};

export const MAP = {
  outside: 0x0c0a08,
  ground: 0x18140f,
  grid: 0x262019,
  buildingFill: 0x2b241d,
  buildingEdge: 0x45392d,
  edge: 0xffb224,
};

/** Context roads (OSM plan) by class: wider and lighter for the big roads. */
export const ROAD_FILL = { motorway: 0x5e584e, trunk: 0x5e584e, primary: 0x58534a, secondary: 0x514c44, tertiary: 0x4a4640, unclassified: 0x44413b, residential: 0x423f39, living_street: 0x403d37, service: 0x3a3732, pedestrian: 0x3d3833 };
export const MAJOR = new Set(['motorway', 'trunk', 'primary', 'secondary', 'motorway_link', 'trunk_link', 'primary_link']);
/** The network lines shown when zoomed out (the ribbons are thinner than a pixel there). */
export const NET_MAJOR = 0xc9b9a0;
export const NET_MINOR = 0x6f665a;

/** Lane surfaces of the lanes layer (lanes.json) by lane type. */
export const LANE_FILL = { drive: 0x47443f, footpath: 0x62584d, kerb: 0x8c8a84, median: 0x4c5638, planter: 0x4f6a2c, parking: 0x3c3a35, gore: 0x6e5a2c };
export const LANE_LINE = 0xece4d4;
export const CENTRE_LINE = 0xf2c230;

/** Fix proposals on the map, one colour per proposal (bright on the dark map). */
export const PROP_COLOURS = ['#5aaeff', '#ff8a3d', '#c08cff', '#46d67c', '#ff4f9a'];

/** Textures of the KTL1 tiles (when the bake has written tiles). */
export const MATERIAL_COLOURS = { road: 0x56534d, footpath: 0x7a6f62, kerb: 0x9a958a, ground: 0x2a251f, parking: 0x4a4943, planter: 0x4f6a2c, marking: 0xf3f1e8, hedge: 0x3f6a32, railing: 0x8d8d8d, colonnade: 0xd8cfb5 };
export const OFFSET_MATERIALS = new Set(['marking', 'kerb', 'planter', 'hedge', 'railing']);
