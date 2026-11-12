// What the bake driver reads besides the files (split out of main.ts in P1-016 so the driver stays small): the lane
// inputs taken from the OSM elements, and the named sites the steps draw pictures and cut bench and check tiles
// for (each is used when the stage holds it). Pure.
import { projector } from '../geo/projection.ts';
import { taggedLanes } from './graph/classify.ts';
import type { GraphInput } from './graph/build.ts';
import type { StagePlan } from './layout/stages.ts';
import type { LaneModelInput } from './roads/network.ts';

/** What the lane model reads besides the graph: the lanes tag of every way, crossings and signals, the hero specs. */
export function laneInputs(input: GraphInput, plan: StagePlan, heroes: LaneModelInput['heroes']): Pick<LaneModelInput, 'wayLanes' | 'points' | 'heroes'> {
  const proj = projector(plan.origin);
  const wayLanes = new Map<string, number>();
  const points: NonNullable<LaneModelInput['points']>[number][] = [];
  for (const el of input.elements) {
    if (el.type === 'way' && el.tags?.['highway']) {
      const n = taggedLanes(el.tags);
      if (n !== null) wayLanes.set(`way/${el.id}`, n);
    } else if (el.type === 'node' && el.lat !== undefined && el.lon !== undefined && (el.tags?.['highway'] === 'crossing' || el.tags?.['highway'] === 'traffic_signals')) {
      const p = proj.toWorld(el.lat, el.lon);
      points.push({ x: p.x, z: p.z, kind: el.tags['highway'] === 'crossing' ? 'crossing' : 'signals' });
    }
  }
  return { wayLanes, points, ...(heroes ? { heroes } : {}) };
}

/** North-up pictures of the lane model: the two sites of the Phase 0 road bench (drawn when they lie in the stage). */
export const LANE_VIEWS: readonly { id: string; name: string; lat: number; lon: number; halfM: number }[] = [
  { id: 'ito', name: 'ITO flyover and junction', lat: 28.6282, lon: 77.2471, halfM: 330 },
  { id: 'cp', name: 'Connaught Place inner circle', lat: 28.6328, lon: 77.2197, halfM: 300 },
];

/** Sites the mesh step cuts stand-in tiles and pictures for (the road bench scene, --arch=roads:<id>), when the stage holds them. */
export const MESH_SITES: readonly { id: string; name: string; lat: number; lon: number; halfM: number; eye: RegExp }[] = [
  { id: 'ito', name: 'ITO flyover and junction', lat: 28.6282, lon: 77.2455, halfM: 330, eye: /^(Vikas Marg|Bahadur Shah Zafar Marg|Indraprastha Marg)/ },
  { id: 'cp', name: 'Connaught Place inner circle', lat: 28.6328, lon: 77.2197, halfM: 300, eye: /^(Radial Road|Barakhamba Road|Janpath)/ },
  { id: 'india_gate', name: 'India Gate hexagon', lat: 28.612894, lon: 77.229446, halfM: 380, eye: /^(Kartavya Path|Rajpath|Tilak Marg|Kasturba Gandhi Marg|Shahjahan Road)/ },
  { id: 'chandni_chowk', name: 'Chandni Chowk', lat: 28.6561, lon: 77.2318, halfM: 300, eye: /^Chandni Chowk/ },
];
/**
 * Repaired sites drawn before and after by the mesh step of a whole bake (P1-017): places with the most road repairs
 * (lane fits, carriageways pushed apart), and Kashmere Gate with its gate items (the Hanuman Mandir ramp overlap, two
 * unjoined arms, the raised pedestrian end).
 */
export const REPAIR_SITES: readonly { id: string; name: string; lat: number; lon: number; halfM: number }[] = [
  { id: 'kashmere_gate', name: 'Kashmere Gate: Ring Road and the Hanuman Mandir flyover', lat: 28.65765, lon: 77.24684, halfM: 200 },
  { id: 'jaswant_singh_rotary', name: 'Ashoka Road and Jaswant Singh Road rotary', lat: 28.61721, lon: 77.22477, halfM: 180 },
  { id: 'jantar_mantar', name: 'Jantar Mantar: Sansad Marg, Tolstoy Marg and Jai Singh Road', lat: 28.62698, lon: 77.21528, halfM: 180 },
  { id: 'firoz_shah_road', name: 'Firoz Shah Road and Hailey Road', lat: 28.62507, lon: 77.22791, halfM: 180 },
];
/** Sites the terrain step cuts: the mesh sites again on the production ground, and the river bank. */
export const GROUND_SITES: typeof MESH_SITES = [...MESH_SITES, { id: 'yamuna', name: 'Yamuna west bank at ITO', lat: 28.626, lon: 77.2533, halfM: 260, eye: /^(Vikas Marg|Mahatma Gandhi Marg|Ring Road)/ }];

/** Side views drawn by the elevation step: roads by name (drawn when the stage has them). */
export const PROFILE_VIEWS: readonly { id: string; name: string; match: RegExp }[] = [{ id: 'ito', name: 'ITO flyover and its ramps', match: /^ITO Flyover/ }];

/** The five tiles the tile step checks its colliders in (P1-016 acceptance): the world tile under each point. */
export const CHECK_TILES: readonly { id: string; name: string; lat: number; lon: number }[] = [
  { id: 'cp', name: 'Connaught Place', lat: 28.6328, lon: 77.2197 },
  { id: 'ito', name: 'the ITO flyover', lat: 28.6282, lon: 77.2455 },
  { id: 'chandni_chowk', name: 'Chandni Chowk', lat: 28.6561, lon: 77.2318 },
  { id: 'india_gate', name: 'India Gate', lat: 28.612894, lon: 77.229446 },
  { id: 'yamuna', name: 'the Yamuna bank', lat: 28.626, lon: 77.2533 },
];
/** Roads whose deck the tile step casts rays down along (the deck joint test). */
export const DECK_ROADS: RegExp = /^ITO Flyover/;
