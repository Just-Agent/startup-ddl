import fs from 'node:fs';

async function ycAdapter() {
  return {
    source: "Y Combinator",
    url: "https://www.ycombinator.com/apply",
    items: [],
    note: 'TODO: implement parser for Y Combinator; keep data/items.json as curated fallback until parser is verified.'
  };
}

async function techstarsAdapter() {
  return {
    source: "Techstars Accelerators",
    url: "https://www.techstars.com/accelerators",
    items: [],
    note: 'TODO: implement parser for Techstars Accelerators; keep data/items.json as curated fallback until parser is verified.'
  };
}

async function startupGrindAdapter() {
  return {
    source: "Startup Grind / Accelerate",
    url: "https://www.startupgrind.com",
    items: [],
    note: 'TODO: implement parser for Startup Grind / Accelerate; keep data/items.json as curated fallback until parser is verified.'
  };
}

async function grantWatchAdapter() {
  return {
    source: "GrantWatch",
    url: "https://www.grantwatch.com",
    items: [],
    note: 'TODO: implement parser for GrantWatch; keep data/items.json as curated fallback until parser is verified.'
  };
}

const adapters = [ycAdapter, techstarsAdapter, startupGrindAdapter, grantWatchAdapter];
const existingItemsUrl = new URL('../data/items.json', import.meta.url);
const existingItems = JSON.parse(fs.readFileSync(existingItemsUrl, 'utf8'));
const reports = [];

for (const adapter of adapters) {
  reports.push(await adapter());
}

const harvestedItems = reports.flatMap(report => report.items);
if (harvestedItems.length > 0) {
  fs.writeFileSync(existingItemsUrl, JSON.stringify(harvestedItems, null, 2) + '\n', 'utf8');
  console.log(`crawler wrote ${harvestedItems.length} fetched items`);
} else {
  console.log(`crawler adapters ran; no verified fetched items yet, preserving ${existingItems.length} curated items`);
}

fs.writeFileSync(new URL('../data/crawl-report.json', import.meta.url), JSON.stringify({
  generatedAt: new Date().toISOString(),
  topicId: "startup-ddl",
  adapters: reports
}, null, 2) + '\n', 'utf8');
