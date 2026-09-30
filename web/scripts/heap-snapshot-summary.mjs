/**
 * What a `.heapsnapshot` holds, grouped so two snapshots of the same export
 * can be compared (ADR-029).
 *
 *   node scripts/heap-snapshot-summary.mjs a.heapsnapshot [b.heapsnapshot ...] [--top=25]
 *
 * For each snapshot: the total, and per group the count, the self size and
 * the retained size (from the dominator tree, weak edges ignored, as the
 * DevTools memory panel computes it). A group is the constructor name; plain
 * objects (`Object`) are split by their property names, so e.g. the muxer's
 * per-sample records (`{timestamp, decodeTimestamp, duration, data, size,
 * type, timescaleUnitsToNextSample}`) show up as their own row. With two or
 * more snapshots the groups that grew most from the first to the last are
 * listed with the growth per snapshot.
 *
 * The largest single retainers (nodes with the largest retained size that
 * are not the roots) are listed with the chain of dominators above them.
 *
 * Measurement only: nothing here is part of the app.
 */
import { readFileSync } from 'node:fs';
import { basename } from 'node:path';

const args = process.argv.slice(2);
const files = args.filter((a) => !a.startsWith('--'));
const topArg = args.find((a) => a.startsWith('--top='));
const top = topArg ? Number(topArg.slice(6)) : 25;
const MIB = 1048576;

if (files.length === 0) {
  console.error('kullanım: node scripts/heap-snapshot-summary.mjs <dosya.heapsnapshot> [...]');
  process.exit(2);
}

function analyse(file) {
  const snapshot = JSON.parse(readFileSync(file, 'utf8'));
  const meta = snapshot.snapshot.meta;
  const nodeFields = meta.node_fields;
  const edgeFields = meta.edge_fields;
  const nodeTypes = meta.node_types[0];
  const edgeTypes = meta.edge_types[0];
  const N = nodeFields.length;
  const E = edgeFields.length;
  const nodes = snapshot.nodes;
  const edges = snapshot.edges;
  const strings = snapshot.strings;
  const nType = nodeFields.indexOf('type');
  const nName = nodeFields.indexOf('name');
  const nSelf = nodeFields.indexOf('self_size');
  const nEdges = nodeFields.indexOf('edge_count');
  const eType = edgeFields.indexOf('type');
  const eName = edgeFields.indexOf('name_or_index');
  const eTo = edgeFields.indexOf('to_node');
  const weak = edgeTypes.indexOf('weak');
  const propertyType = edgeTypes.indexOf('property');
  const count = nodes.length / N;

  // First edge of each node.
  const firstEdge = new Int32Array(count + 1);
  for (let i = 0, e = 0; i < count; i += 1) {
    firstEdge[i] = e;
    e += nodes[i * N + nEdges] * E;
    firstEdge[i + 1] = e;
  }

  // Group names.
  const groupOf = new Array(count);
  for (let i = 0; i < count; i += 1) {
    const type = nodeTypes[nodes[i * N + nType]];
    let name = strings[nodes[i * N + nName]];
    if (type === 'object' && name === 'Object') {
      const props = [];
      for (let e = firstEdge[i]; e < firstEdge[i + 1]; e += E) {
        if (edges[e + eType] === propertyType) props.push(strings[edges[e + eName]]);
      }
      props.sort();
      name = `Object {${props.slice(0, 8).join(', ')}${props.length > 8 ? ', …' : ''}}`;
    } else if (type === 'string' || type === 'concatenated string' || type === 'sliced string') {
      name = '(string)';
    } else if (type === 'number') {
      name = '(number)';
    } else if (type === 'code') {
      name = '(code)';
    } else if (type === 'hidden' || type === 'array' || type === 'native' || type === 'synthetic') {
      name = `(${type}) ${name.length > 60 ? `${name.slice(0, 60)}…` : name}`;
    } else if (type === 'closure') {
      name = `(closure) ${name}`;
    }
    groupOf[i] = name;
  }

  // Dominators (Cooper, Harvey, Kennedy), root = node 0, weak edges ignored.
  const postOrderIndex = new Int32Array(count).fill(-1);
  const order = new Int32Array(count);
  let visited = 0;
  {
    const stack = new Int32Array(count);
    const edgeCursor = new Int32Array(count);
    const seen = new Uint8Array(count);
    let top0 = 0;
    stack[0] = 0;
    seen[0] = 1;
    edgeCursor[0] = firstEdge[0];
    while (top0 >= 0) {
      const node = stack[top0];
      let pushed = false;
      while (edgeCursor[node] < firstEdge[node + 1]) {
        const e = edgeCursor[node];
        edgeCursor[node] += E;
        if (edges[e + eType] === weak) continue;
        const to = edges[e + eTo] / N;
        if (seen[to]) continue;
        seen[to] = 1;
        edgeCursor[to] = firstEdge[to];
        stack[++top0] = to;
        pushed = true;
        break;
      }
      if (!pushed) {
        postOrderIndex[node] = visited;
        order[visited] = node;
        visited += 1;
        top0 -= 1;
      }
    }
  }
  // Predecessors (reachable nodes only).
  const predCount = new Int32Array(count + 1);
  for (let i = 0; i < count; i += 1) {
    if (postOrderIndex[i] < 0) continue;
    for (let e = firstEdge[i]; e < firstEdge[i + 1]; e += E) {
      if (edges[e + eType] === weak) continue;
      predCount[edges[e + eTo] / N + 1] += 1;
    }
  }
  for (let i = 0; i < count; i += 1) predCount[i + 1] += predCount[i];
  const preds = new Int32Array(predCount[count]);
  const fill = predCount.slice(0, count);
  for (let i = 0; i < count; i += 1) {
    if (postOrderIndex[i] < 0) continue;
    for (let e = firstEdge[i]; e < firstEdge[i + 1]; e += E) {
      if (edges[e + eType] === weak) continue;
      const to = edges[e + eTo] / N;
      preds[fill[to]++] = i;
    }
  }
  const idom = new Int32Array(count).fill(-1);
  idom[0] = 0;
  const intersect = (a, b) => {
    while (a !== b) {
      while (postOrderIndex[a] < postOrderIndex[b]) a = idom[a];
      while (postOrderIndex[b] < postOrderIndex[a]) b = idom[b];
    }
    return a;
  };
  let changed = true;
  while (changed) {
    changed = false;
    for (let k = visited - 1; k >= 0; k -= 1) {
      const node = order[k];
      if (node === 0) continue;
      let dom = -1;
      for (let p = predCount[node]; p < predCount[node + 1]; p += 1) {
        const pred = preds[p];
        if (idom[pred] < 0) continue;
        dom = dom < 0 ? pred : intersect(pred, dom);
      }
      if (dom >= 0 && idom[node] !== dom) {
        idom[node] = dom;
        changed = true;
      }
    }
  }
  const retained = new Float64Array(count);
  for (let i = 0; i < count; i += 1) retained[i] = nodes[i * N + nSelf];
  for (let k = 0; k < visited; k += 1) {
    const node = order[k];
    if (node !== 0 && idom[node] >= 0 && idom[node] !== node) retained[idom[node]] += retained[node];
  }

  // Per group: count, self, retained (not counting nodes dominated by the same group).
  const groups = new Map();
  let total = 0;
  for (let i = 0; i < count; i += 1) {
    const self = nodes[i * N + nSelf];
    total += self;
    const name = groupOf[i];
    let g = groups.get(name);
    if (!g) {
      g = { count: 0, self: 0, retained: 0 };
      groups.set(name, g);
    }
    g.count += 1;
    g.self += self;
    if (postOrderIndex[i] >= 0) {
      // A node inside another node of its own group is already counted in
      // that one's retained size. Only a few levels are looked at: enough
      // for arrays of records, and bounded for long chains.
      let d = idom[i];
      let nested = false;
      for (let level = 0; d > 0 && level < 12; level += 1) {
        if (groupOf[d] === name) {
          nested = true;
          break;
        }
        if (idom[d] === d) break;
        d = idom[d];
      }
      if (!nested) g.retained += retained[i];
    }
  }

  // The largest single retainers below the synthetic roots.
  const candidates = [];
  for (let i = 1; i < count; i += 1) {
    const type = nodeTypes[nodes[i * N + nType]];
    if (type === 'synthetic') continue;
    candidates.push(i);
  }
  candidates.sort((a, b) => retained[b] - retained[a]);
  const chainOf = (i) => {
    const chain = [];
    let d = idom[i];
    while (d > 0 && chain.length < 6) {
      chain.push(groupOf[d]);
      if (idom[d] === d) break;
      d = idom[d];
    }
    return chain;
  };
  const largest = [];
  for (const i of candidates) {
    if (largest.length >= 12) break;
    // Skip nodes dominated by one already listed.
    let d = idom[i];
    let inside = false;
    while (d > 0) {
      if (largest.some((l) => l.index === d)) {
        inside = true;
        break;
      }
      if (idom[d] === d) break;
      d = idom[d];
    }
    if (inside) continue;
    largest.push({ index: i, group: groupOf[i], retained: retained[i], chain: chainOf(i) });
  }

  return { file, count, total, groups, largest };
}

const results = files.map(analyse);
const mib = (bytes) => (bytes / MIB).toFixed(2);

for (const r of results) {
  console.log(`\n== ${basename(r.file)}: ${r.count} düğüm, toplam ${mib(r.total)} MiB`);
  const rows = [...r.groups.entries()].sort((a, b) => b[1].retained - a[1].retained).slice(0, top);
  console.log('   tutulan MiB   kendi MiB      adet  grup');
  for (const [name, g] of rows) {
    console.log(`   ${mib(g.retained).padStart(10)} ${mib(g.self).padStart(10)} ${String(g.count).padStart(9)}  ${name}`);
  }
  console.log('   en büyük tekil tutucular:');
  for (const l of r.largest) {
    console.log(`   ${mib(l.retained).padStart(10)}  ${l.group}  ← ${l.chain.join(' ← ')}`);
  }
}

if (results.length > 1) {
  const first = results[0];
  const last = results[results.length - 1];
  const names = new Set([...first.groups.keys(), ...last.groups.keys()]);
  const growth = [...names]
    .map((name) => {
      const a = first.groups.get(name) ?? { count: 0, self: 0, retained: 0 };
      const b = last.groups.get(name) ?? { count: 0, self: 0, retained: 0 };
      return { name, dSelf: b.self - a.self, dCount: b.count - a.count };
    })
    .sort((x, y) => y.dSelf - x.dSelf)
    .slice(0, top);
  console.log(`\n== büyüyen gruplar (${basename(first.file)} → ${basename(last.file)}); her görüntüde kendi MiB / adet`);
  for (const g of growth) {
    const series = results
      .map((r) => {
        const v = r.groups.get(g.name);
        return v ? `${mib(v.self)}/${v.count}` : '0/0';
      })
      .join('  ');
    console.log(`   ${mib(g.dSelf).padStart(9)} MiB ${String(g.dCount).padStart(9)} adet  ${g.name}\n        ${series}`);
  }
  console.log(`\n   toplam: ${results.map((r) => `${mib(r.total)} MiB`).join(' → ')}`);
}
