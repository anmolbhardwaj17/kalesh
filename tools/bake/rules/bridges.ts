// Bridge and flyover rules (R-BRIDGE): ends without support, bridges without a layer, ramps that end in the air.
import { inBox } from '../geom.ts';
import type { P2 } from '../geom.ts';
import { classImpact } from '../osm.ts';
import type { MapData, Road } from '../osm.ts';
import { issue, patchOf } from './types.ts';
import type { Issue, Rule, RuleContext } from './types.ts';

export interface BridgeChain {
  roads: Road[];
  layer: number;
  length: number;
  /** Node ids where the chain ends (a chain road ends there and no other chain road goes on). */
  ends: number[];
  /** Node ids inside the span: every chain node that is not an end. */
  inner: Set<number>;
}

/** Bridge ways joined end to end on one layer are one structure. */
export function bridgeChains(map: MapData): BridgeChain[] {
  const bridges = map.roads.filter((r) => r.bridge);
  const parent = new Map<Road, Road>();
  const find = (r: Road): Road => {
    let p = parent.get(r) ?? r;
    while (p !== (parent.get(p) ?? p)) p = parent.get(p) ?? p;
    parent.set(r, p);
    return p;
  };
  for (const r of bridges) {
    for (const end of [r.nodes[0], r.nodes[r.nodes.length - 1]]) {
      for (const o of map.roadsAtNode.get(end as number) ?? []) {
        if (o !== r && o.bridge && o.layer === r.layer) parent.set(find(r), find(o));
      }
    }
  }
  const groups = new Map<Road, Road[]>();
  for (const r of bridges) {
    const root = find(r);
    const g = groups.get(root);
    if (g) g.push(r);
    else groups.set(root, [r]);
  }
  const chains: BridgeChain[] = [];
  for (const roads of groups.values()) {
    const members = new Set(roads);
    const ends: number[] = [];
    const inner = new Set<number>();
    for (const r of roads) for (const n of r.nodes) inner.add(n);
    for (const r of roads) {
      for (const end of new Set([r.nodes[0] as number, r.nodes[r.nodes.length - 1] as number])) {
        const others = (map.roadsAtNode.get(end) ?? []).filter((o) => o !== r && members.has(o));
        if (others.length === 0) {
          ends.push(end);
          inner.delete(end);
        }
      }
    }
    roads.sort((a, b) => (a.id < b.id ? -1 : 1));
    chains.push({ roads, layer: (roads[0] as Road).layer, length: roads.reduce((s, r) => s + r.length, 0), ends: [...new Set(ends)].sort((a, b) => a - b), inner });
  }
  chains.sort((a, b) => ((a.roads[0] as Road).id < (b.roads[0] as Road).id ? -1 : 1));
  return chains;
}

const at = (map: MapData, node: number): P2 => {
  const n = map.nodes.get(node);
  return { x: n?.x ?? 0, z: n?.z ?? 0 };
};

export const bridgeSupport: Rule = {
  id: 'R-BRIDGE-01',
  area: 'bridges',
  title: 'Bridge or flyover end without support, or a bridge without a layer',
  confidence: 0.8,
  detect(ctx: RuleContext): Issue[] {
    const out: Issue[] = [];
    for (const chain of bridgeChains(ctx.map)) {
      const first = chain.roads[0] as Road;
      const impact = Math.max(...chain.roads.map((r) => classImpact(r.cls)));
      for (const end of chain.ends) {
        const p = at(ctx.map, end);
        if (!inBox(ctx.box, p, -5)) continue;
        const approach = (ctx.map.roadsAtNode.get(end) ?? []).filter((r) => !chain.roads.includes(r));
        if (approach.length > 0) continue;
        // a ramp (link) with nothing after it is the ramp rule's issue, not counted twice
        if ((ctx.map.roadsAtNode.get(end) ?? []).some((r) => r.link)) continue;
        out.push(issue(ctx, bridgeSupport, p, [first.id, `node/${end}`], impact, 0.8, `the ${Math.round(chain.length)} m bridge ends with no road beyond it`, [
          { action: 'terminate', params: { with: 'abutment' }, confidence: 0.4, lowImpact: false, reasoning: 'No road goes on from this end of the bridge: close it with an abutment and a barrier, or find the missing approach', preview: [p] },
        ]));
      }
      if (chain.layer === 0) {
        const mid = first.pts[Math.floor(first.pts.length / 2)] as P2;
        if (!inBox(ctx.box, mid)) continue;
        out.push(issue(ctx, bridgeSupport, mid, chain.roads.map((r) => r.id).slice(0, 4), impact, 0.9, `bridge of ${Math.round(chain.length)} m with no layer tag`, [
          { action: 'set_tag', params: { key: 'layer', value: '1' }, confidence: 0.85, lowImpact: true, reasoning: 'A way tagged bridge with no layer: it is one level up (a tag only, no geometry moves)', preview: first.pts },
        ]));
      }
    }
    return out;
  },
  repair: (i) => patchOf(i),
};

export const rampInAir: Rule = {
  id: 'R-BRIDGE-02',
  area: 'bridges',
  title: 'Ramp that ends in the air',
  confidence: 0.7,
  detect(ctx: RuleContext): Issue[] {
    const out: Issue[] = [];
    for (const chain of bridgeChains(ctx.map)) {
      const first = chain.roads[0] as Road;
      // a ground road that meets the deck inside the span: it would need its own ramp structure
      for (const node of [...chain.inner].sort((a, b) => a - b)) {
        const p = at(ctx.map, node);
        if (!inBox(ctx.box, p)) continue;
        for (const r of ctx.map.roadsAtNode.get(node) ?? []) {
          if (chain.roads.includes(r) || r.bridge || r.layer >= chain.layer) continue;
          if (r.nodes[0] !== node && r.nodes[r.nodes.length - 1] !== node) continue;
          out.push(issue(ctx, rampInAir, p, [r.id, first.id, `node/${node}`], Math.max(classImpact(r.cls), classImpact(first.cls)), 0.7, `ground way (layer ${r.layer}) joins a deck on layer ${chain.layer} inside its span`, [
            { action: 'replace_geometry', params: { ramp_on: r.id, to_layer: chain.layer }, confidence: 0.6, lowImpact: false, reasoning: 'The joining way needs a ramp: raise its last stretch to the deck (the elevation solver sets the length from the grade limit)', preview: r.pts },
          ]));
        }
      }
      // a bridge link that stops with nothing after it
      for (const r of chain.roads) {
        if (!r.link) continue;
        for (const end of [r.nodes[0] as number, r.nodes[r.nodes.length - 1] as number]) {
          const p = at(ctx.map, end);
          if ((ctx.map.roadsAtNode.get(end)?.length ?? 0) !== 1 || !inBox(ctx.box, p, -5)) continue;
          out.push(issue(ctx, rampInAir, p, [r.id, `node/${end}`], classImpact(r.cls), 0.8, 'a bridge ramp ends with no road after it', [
            { action: 'terminate', params: { with: 'barrier' }, confidence: 0.4, lowImpact: false, reasoning: 'The ramp has no way on from here: find the road it should meet, or close it', preview: [p] },
          ]));
        }
      }
    }
    return out;
  },
  repair: (i) => patchOf(i),
};
