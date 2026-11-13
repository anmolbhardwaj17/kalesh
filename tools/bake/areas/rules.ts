// Archetype by rule for the in-between ground (P2-004, DELHI_WORLD.md 10 AD2). Pure: the rule table is harness/data/
// areas/rules.json, the cell figures come from tools/bake/areas/derive.mjs (the only file that reads the map data).
// Cells are 100 m squares of the bake frame (origin India Gate, +x east, -z north): cell (ix, iz) holds x in
// [ix * 100, ix * 100 + 100) and z in [iz * 100, iz * 100 + 100).

export interface CellFigures {
  /** OSM tags of every closed way that holds the cell centre, as "key=value" strings. */
  osm: readonly string[];
  /** Footprint area centred in the cell over the cell area (0 to 1). */
  coverage: number;
  /** Median footprint area in m2, 0 when the cell has none. */
  medianM2: number;
}

export interface Rule {
  archetype: string;
  osm?: Record<string, string[]>;
  min_coverage?: number;
  max_coverage?: number;
  max_median_m2?: number;
}

export interface RuleTable {
  cell_m: number;
  rules: Rule[];
  fallback: string;
}

/** Cell index of a point. */
export const cellOf = (x: number, z: number, cellM = 100): [number, number] => [Math.floor(x / cellM), Math.floor(z / cellM)];
export const cellKey = (ix: number, iz: number): string => `${ix},${iz}`;

/** Does a rule hold for a cell: every part it names must hold. */
export function ruleHolds(rule: Rule, c: CellFigures): boolean {
  if (rule.osm) {
    const have = new Set(c.osm);
    let any = false;
    for (const [key, values] of Object.entries(rule.osm)) for (const v of values) if (have.has(`${key}=${v}`)) any = true;
    if (!any) return false;
  }
  if (rule.min_coverage !== undefined && c.coverage < rule.min_coverage) return false;
  if (rule.max_coverage !== undefined && c.coverage >= rule.max_coverage) return false;
  if (rule.max_median_m2 !== undefined && !(c.medianM2 > 0 && c.medianM2 <= rule.max_median_m2)) return false;
  return true;
}

/** The archetype of a cell: the first rule that holds, else the fallback. */
export function classifyCell(table: RuleTable, c: CellFigures): string {
  for (const r of table.rules) if (ruleHolds(r, c)) return r.archetype;
  return table.fallback;
}

/** Every archetype the table can return. */
export const ruleArchetypes = (table: RuleTable): string[] => [...new Set([...table.rules.map((r) => r.archetype), table.fallback])];
