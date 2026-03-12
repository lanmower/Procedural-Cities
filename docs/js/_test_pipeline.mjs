import { generateRoads } from './roadGen.js';
import { extractPlots } from './plotGen.js';
import { generateBuildings } from './buildingGen.js';

try {
  console.log('=== Road Generation ===');
  const roads = generateRoads({ seed: 42, length: 152 });
  console.log(`Roads generated: ${roads.length}`);

  console.log('\n=== Plot Extraction ===');
  const plots = extractPlots(roads);
  console.log(`Plots extracted: ${plots.length}`);

  // Basic validation
  let validPlots = 0, openPlots = 0;
  for (const p of plots) {
    if (p.length >= 3) validPlots++;
    if (p.open) openPlots++;
  }
  console.log(`  Valid plots (>=3 pts): ${validPlots}`);
  console.log(`  Open plots: ${openPlots}`);
  console.log(`  Closed plots: ${plots.length - openPlots}`);

  console.log('\n=== Building Generation ===');
  let totalBuildings = 0;
  let plotsWithBuildings = 0;
  let emptyPlots = 0;
  let errors = 0;

  for (const plot of plots) {
    try {
      const buildings = generateBuildings(plot);
      totalBuildings += buildings.length;
      if (buildings.length > 0) plotsWithBuildings++;
      else emptyPlots++;
    } catch (e) {
      errors++;
      console.error(`  Error on plot: ${e.message}`);
    }
  }

  console.log(`Total buildings generated: ${totalBuildings}`);
  console.log(`  Plots with buildings: ${plotsWithBuildings}`);
  console.log(`  Plots with no buildings: ${emptyPlots}`);
  console.log(`  Errors: ${errors}`);

  console.log('\n=== Summary ===');
  console.log(`Roads:     ${roads.length}`);
  console.log(`Plots:     ${plots.length}`);
  console.log(`Buildings: ${totalBuildings}`);
  console.log('All done.');
} catch (e) {
  console.error('FATAL ERROR:', e);
  process.exit(1);
}
