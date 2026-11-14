// Variants of the infrastructure kits (P2-034, harness/design/reference/infrastructure/, STYLE_BIBLE.md
// "Infrastructure"): which kit builds each flyover, bridge, viaduct, rail stretch and foot bridge. The table of
// variants holds what the bake needs to know about a kit (the pier it stands on, so the collider is the drawn pier);
// the look itself is the game's (game/world/infra/infra_kit.gd). The rules file is harness/data/infra_variants.json.
// Pure.
import type { Joint, Strip } from '../roads/model.ts';

/** How a deck's piers stand: two columns under a cap beam, one column, one wide wall, a round column. */
export type PierShape = 'twin' | 'single' | 'wall' | 'round';

export interface VariantDef {
  id: string;
  /** flyover, ramp, bridge, rail, rail_bridge, metro, fob */
  family: string;
  name: string;
  pier: PierShape;
}

/** Every variant the kits build. Tunnels and underpasses (TUN, UND) are P2-032; the subways' own kit (SUB) is P2-031. */
export const VARIANTS: Readonly<Record<string, VariantDef>> = Object.fromEntries(
  ([
    ['FLY-T1', 'flyover', 'Older T beam flyover, twin or portal piers, orange rail', 'twin'],
    ['FLY-B1', 'flyover', 'Newer precast box girder flyover, single pier', 'single'],
    ['FLY-R1', 'ramp', 'Ramps, loops and approaches', 'round'],
    ['BRI-Y1', 'bridge', 'Modern Yamuna road bridge (concrete girder)', 'wall'],
    ['BRI-ROB', 'bridge', 'Road over rail and station flyover', 'twin'],
    ['BRI-MIN', 'bridge', 'Small service bridge', 'wall'],
    ['BRI-Y2', 'bridge', 'Cable stay (Signature Bridge)', 'single'],
    ['RAIL-BG', 'rail', 'Broad gauge main line and yard track', 'wall'],
    ['RAIL-RING', 'rail', 'Delhi Ring Railway', 'wall'],
    ['RAIL-PLAT', 'rail', 'Platforms and roofs', 'round'],
    ['RBR-U1', 'rail_bridge', 'Rail bridge over road (steel girder)', 'wall'],
    ['RBR-Y1', 'rail_bridge', 'Loha Pul steel truss', 'wall'],
    ['RBR-CUT', 'rail', 'Railway cut under road', 'wall'],
    ['MET-VB1', 'metro', 'Phase I elevated viaduct, single box, Y piers', 'round'],
    ['MET-VB2', 'metro', 'Phase II and III twin U girder viaduct', 'round'],
    ['MET-RAMP', 'metro', 'Ramp where the line leaves the tunnel', 'wall'],
    ['FOB-B1', 'fob', 'New Delhi station arched steel FOB', 'round'],
    ['FOB-B2', 'fob', 'Railway platform FOB', 'round'],
    ['FOB-B3', 'fob', 'ITO skywalk and modern PWD skywalk', 'round'],
    ['FOB-B4', 'fob', 'PWD steel road FOB with stairs and lift', 'round'],
    ['FOB-B5', 'fob', 'Older plain stair FOB', 'round'],
    // P2-032: cuts, tunnels and underpasses (tunnels.md, underpasses_subways.md; infra/tunnels.ts gives them)
    ['TUN-T1', 'tunnel', 'Pragati Maidan main tunnel (2022, mural walls, white LED)', 'wall'],
    ['TUN-T2', 'tunnel', 'Pragati Maidan box underpasses', 'wall'],
    ['TUN-T3', 'tunnel', 'Basement and service tunnels', 'wall'],
    ['UND-U1', 'underpass', 'Flyover-era road underpass and cut, painted concrete, sodium', 'wall'],
    ['SUB-S4', 'subway', 'Pedestrian underpass (plain stand-in until P2-031)', 'wall'],
  ] as const).map(([id, family, name, pier]) => [id, { id, family, name, pier }]),
);

export interface VariantRules {
  road: Record<string, string>;
  roadDefaults: { water?: string; railway?: string; service: string; fill: string; pedestrian: string; trunk: string; default: string };
  rail: Record<string, string>;
  railDefaults: { atGrade: string; bridge: string; tunnel: string; byName: Record<string, string> };
  metro: { viaduct: string; ramp: string };
  footBridges: Record<string, string>;
  footBridgeDefault: string;
}

/** The rules file, checked: every variant it names must be a kit (an unknown id is an error, never a plain box). */
export function readRules(raw: unknown): VariantRules {
  const r = raw as VariantRules;
  const named = [
    ...Object.values(r.road), ...Object.values(r.roadDefaults), ...Object.values(r.rail), r.railDefaults.atGrade, r.railDefaults.bridge, r.railDefaults.tunnel,
    ...Object.values(r.railDefaults.byName), r.metro.viaduct, r.metro.ramp, ...Object.values(r.footBridges), r.footBridgeDefault,
  ];
  const bad = named.filter((v) => typeof v !== 'string' || !VARIANTS[v]);
  if (bad.length) throw new Error(`infra_variants.json names variants with no kit: ${[...new Set(bad)].join(', ')}`);
  return r;
}

const RAISED = new Set([1, 2]);

/**
 * The variant of every strip that is on a deck or a fill somewhere (null for a strip at grade or only lowered). A
 * strip on a listed way takes its variant; an unlisted strip joined to a raised strip takes that one's (the solver
 * starts a ramp before the bridge tag, on the approach way); the rest take the defaults by what they are.
 */
export function stripVariants(strips: readonly Strip[], joints: readonly Joint[], kinds: readonly ArrayLike<number>[], rules: VariantRules): (string | null)[] {
  const raised = strips.map((s, si) => {
    const k = kinds[si] as ArrayLike<number>;
    for (let i = 0; i < s.st.length; i++) if (RAISED.has(k[i] as number)) return true;
    return false;
  });
  const out: (string | null)[] = strips.map((s, si) => {
    if (!raised[si]) return null;
    for (const w of s.ways) {
      const v = rules.road[w] ?? rules.road[w.startsWith('way/') ? w : `way/${w}`];
      if (v) return v;
    }
    return null;
  });
  const endRaised = (si: number, end: 'start' | 'end'): boolean => {
    const s = strips[si] as Strip;
    const k = kinds[si] as ArrayLike<number>;
    return RAISED.has(k[end === 'start' ? 0 : s.st.length - 1] as number);
  };
  for (let round = 0; round < 6; round++) {
    let changed = false;
    for (const j of joints) {
      const a = j.a.strip;
      const b = j.b.strip;
      if (!endRaised(a, j.a.end) || !endRaised(b, j.b.end)) continue;
      if (out[a] && !out[b] && raised[b]) {
        out[b] = out[a] as string;
        changed = true;
      } else if (out[b] && !out[a] && raised[a]) {
        out[a] = out[b] as string;
        changed = true;
      }
    }
    if (!changed) break;
  }
  return out.map((v, si) => {
    if (v || !raised[si]) return v;
    const s = strips[si] as Strip;
    const k = kinds[si] as ArrayLike<number>;
    let deck = false;
    for (let i = 0; i < s.st.length; i++) if (k[i] === 2) deck = true;
    const d = rules.roadDefaults;
    if (s.cls === 'pedestrian' || s.cls === 'footway' || s.cls === 'steps') return d.pedestrian;
    if (!deck) return d.fill;
    if (s.cls === 'service') return d.service;
    if (s.cls === 'trunk' || s.cls === 'motorway') return d.trunk;
    return d.default;
  });
}

export function railVariant(line: { id: string; name: string; bridge: boolean; tunnel: boolean }, rules: VariantRules): string {
  const id = line.id.split('#')[0] as string;
  const own = rules.rail[id];
  if (own) return own;
  if (line.tunnel) return rules.railDefaults.tunnel;
  if (line.bridge) return rules.railDefaults.bridge;
  return rules.railDefaults.byName[line.name] ?? rules.railDefaults.atGrade;
}

export function footBridgeVariant(fb: { id: string; ways: readonly string[] }, rules: VariantRules): string {
  for (const w of [fb.id, ...fb.ways]) {
    const v = rules.footBridges[w];
    if (v) return v;
  }
  return rules.footBridgeDefault;
}
