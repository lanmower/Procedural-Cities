// Plot extraction from road network
// Uses grid-based flood fill to find city blocks between roads

import { dist, polyArea, polyIsClockwise } from './utils.js';

const GRID = 1500;
const MAX_PLOT_AREA = 80000000; // 8000 m² max (filters outer border region)

export function extractPlots(roads, cfg = {}) {
  if (!roads.length) return [];

  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const r of roads) {
    minX = Math.min(minX, r.p1.x, r.p2.x);
    maxX = Math.max(maxX, r.p1.x, r.p2.x);
    minY = Math.min(minY, r.p1.y, r.p2.y);
    maxY = Math.max(maxY, r.p1.y, r.p2.y);
  }

  const cols = Math.ceil((maxX - minX) / GRID) + 2;
  const rows = Math.ceil((maxY - minY) / GRID) + 2;

  // Rasterize roads onto grid
  const onRoad = new Uint8Array(cols * rows);
  for (const r of roads) {
    rasterizeRoad(r, onRoad, cols, rows, minX, minY, GRID);
  }

  const visited = new Uint8Array(cols * rows);
  const plots = [];

  for (let row = 1; row < rows - 1; row++) {
    for (let col = 1; col < cols - 1; col++) {
      const idx = row * cols + col;
      if (onRoad[idx] || visited[idx]) continue;

      // BFS flood fill
      const cells = [];
      const queue = [idx];
      visited[idx] = 1;
      while (queue.length) {
        const i = queue.pop();
        cells.push(i);
        const r2 = Math.floor(i / cols), c2 = i % cols;
        for (const [dr, dc] of [[-1,0],[1,0],[0,-1],[0,1]]) {
          const nr = r2+dr, nc = c2+dc;
          if (nr < 0 || nr >= rows || nc < 0 || nc >= cols) continue;
          const ni = nr*cols+nc;
          if (!onRoad[ni] && !visited[ni]) { visited[ni] = 1; queue.push(ni); }
        }
      }

      if (cells.length < 3) continue;
      const hull = cellsToHull(cells, cols, minX, minY, GRID);
      if (!hull || hull.length < 3) continue;
      const area = polyArea(hull);
      if (area < 50000 || area > MAX_PLOT_AREA) continue;
      plots.push(hull);
    }
  }

  return plots;
}

function rasterizeRoad(road, grid, cols, rows, minX, minY, cellSize) {
  const hw = road.hw + cellSize * 0.5;
  const x0 = Math.max(0, Math.floor((Math.min(road.p1.x, road.p2.x) - minX - hw) / cellSize));
  const x1 = Math.min(cols-1, Math.ceil((Math.max(road.p1.x, road.p2.x) - minX + hw) / cellSize));
  const y0 = Math.max(0, Math.floor((Math.min(road.p1.y, road.p2.y) - minY - hw) / cellSize));
  const y1 = Math.min(rows-1, Math.ceil((Math.max(road.p1.y, road.p2.y) - minY + hw) / cellSize));

  const dx = road.p2.x - road.p1.x, dy = road.p2.y - road.p1.y;
  const len = Math.hypot(dx, dy);
  if (len < 1) return;
  const tx = dx/len, ty = dy/len;
  const nx = -ty, ny = tx;

  for (let r = y0; r <= y1; r++) {
    for (let c = x0; c <= x1; c++) {
      const cx = minX + (c + 0.5) * cellSize;
      const cy = minY + (r + 0.5) * cellSize;
      const vx = cx - road.p1.x, vy = cy - road.p1.y;
      const along = vx*tx + vy*ty;
      const aside = Math.abs(vx*nx + vy*ny);
      if (along >= -hw && along <= len+hw && aside <= hw)
        grid[r * cols + c] = 1;
    }
  }
}

function cellsToHull(cells, cols, minX, minY, grid) {
  const pts = cells.map(i => ({
    x: minX + (i % cols + 0.5) * grid,
    y: minY + (Math.floor(i / cols) + 0.5) * grid
  }));
  return convexHull(pts);
}

function convexHull(pts) {
  if (pts.length < 3) return pts;
  const sorted = [...pts].sort((a, b) => a.x !== b.x ? a.x - b.x : a.y - b.y);
  const lower = [], upper = [];
  for (const p of sorted) {
    while (lower.length >= 2 && cross(lower[lower.length-2], lower[lower.length-1], p) <= 0) lower.pop();
    lower.push(p);
  }
  for (const p of [...sorted].reverse()) {
    while (upper.length >= 2 && cross(upper[upper.length-2], upper[upper.length-1], p) <= 0) upper.pop();
    upper.push(p);
  }
  upper.pop(); lower.pop();
  return [...lower, ...upper];
}

function cross(o, a, b) {
  return (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
}
