import fs from 'node:fs';
import { spawnSync } from 'node:child_process';

const CRAWL_TIMEOUT_MS = Number(process.env.CRAWL_TIMEOUT_MS) || 20000;
const REACHABILITY_TIMEOUT_MS = Number(process.env.REACHABILITY_TIMEOUT_MS) || Math.min(7000, CRAWL_TIMEOUT_MS);
const USER_AGENT = 'Just-DDL-Crawler/1.0 (+https://just-agent.github.io/just-ddl/)';

function extractTitle(html) {
  const match = html.match(/<title[^>]*>([^<]*)<\/title>/i);
  return match ? match[1].trim().slice(0, 200) : null;
}

function fetchViaPowerShell(url) {
  if (process.platform !== 'win32') return null;
  const timeoutSec = Math.max(15, Math.ceil(CRAWL_TIMEOUT_MS / 1000) + 5);
  const escapedUrl = url.replace(/'/g, "''");
  const script = "$ProgressPreference='SilentlyContinue'; [Console]::OutputEncoding=[System.Text.UTF8Encoding]::new($false); (Invoke-WebRequest -Uri '" + escapedUrl + "' -UseBasicParsing -TimeoutSec " + timeoutSec + " -Headers @{ 'User-Agent'='Mozilla/5.0'; 'Accept-Language'='en-US,en;q=0.9' }).Content";
  for (const command of ['pwsh', 'powershell']) {
    const result = spawnSync(command, ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', script], {
      encoding: 'utf8',
      maxBuffer: 20 * 1024 * 1024,
      timeout: (timeoutSec + 5) * 1000
    });
    if (result.status === 0 && result.stdout && result.stdout.trim().length > 1000) {
      return result.stdout;
    }
  }
  return null;
}

async function fetchSourcePage(source) {
  const report = {
    sourceId: source.id,
    source: source.name,
    url: source.url,
    items: [],
    reachable: false,
    httpStatus: null,
    finalUrl: null,
    title: null,
    contentLength: null,
    fetchedAt: new Date().toISOString(),
    note: 'Source reachability check only; curated data/items.json preserved until item parser is implemented.',
    error: null
  };
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REACHABILITY_TIMEOUT_MS);
    const res = await fetch(source.url, {
      redirect: 'follow',
      signal: controller.signal,
      headers: { 'User-Agent': USER_AGENT }
    });
    clearTimeout(timer);
    report.httpStatus = res.status;
    report.finalUrl = res.url;
    const text = await res.text();
    report.contentLength = text.length;
    report.title = extractTitle(text);
    report.reachable = res.status >= 200 && res.status < 400;
    report.note = report.reachable
      ? 'Source reachable. Curated data/items.json preserved until item parser is implemented.'
      : `Source returned HTTP ${res.status}. Curated data/items.json preserved.`;
  } catch (err) {
    report.error = err.name === 'AbortError' ? `Timeout after ${REACHABILITY_TIMEOUT_MS}ms` : err.message;
    report.note = `Source fetch failed: ${report.error}. Curated data/items.json preserved.`;
  }
  return report;
}

const TECHSTARS_URL = 'https://www.techstars.com/accelerators';
const TECHSTARS_MIN_ITEMS = 3;
const TECHSTARS_MAX_FUTURE_DAYS = Number(process.env.TECHSTARS_MAX_FUTURE_DAYS) || 500;

function techstarsStripHtml(value) {
  return String(value || '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

function parseTechstarsApplyDate(label, knownIsoDates) {
  const match = String(label || '').match(/([A-Za-z]{3,9})\s+(\d{1,2})/);
  if (!match) return null;
  const monthName = match[1].slice(0, 3).toLowerCase();
  const monthMap = { jan:0,feb:1,mar:2,apr:3,may:4,jun:5,jul:6,aug:7,sep:8,oct:9,nov:10,dec:11 };
  const month = monthMap[monthName];
  const day = Number(match[2]);
  if (month === undefined || !day) return null;

  const sameDayIso = knownIsoDates.find(value => {
    const date = new Date(value + 'T23:59:59Z');
    return date.getUTCMonth() === month && date.getUTCDate() === day;
  });
  if (sameDayIso) return new Date(sameDayIso + 'T23:59:59Z');

  let year = new Date().getUTCFullYear();
  let candidate = new Date(Date.UTC(year, month, day, 23, 59, 59));
  if ((candidate.getTime() - Date.now()) / 86400000 < -7) {
    candidate = new Date(Date.UTC(year + 1, month, day, 23, 59, 59));
  }
  return candidate;
}

async function parseTechstarsItems() {
  const report = {
    sourceId: 'techstars',
    source: 'Techstars Accelerators',
    url: TECHSTARS_URL,
    items: [],
    reachable: false,
    httpStatus: null,
    finalUrl: null,
    title: null,
    contentLength: null,
    fetchedAt: new Date().toISOString(),
    note: 'Techstars accelerators parser.',
    error: null,
    parsedItemCount: 0,
    invalidItemCount: 0,
    parserHealthy: false
  };
  try {
    let text;
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), CRAWL_TIMEOUT_MS);
      const res = await fetch(TECHSTARS_URL, {
        redirect: 'follow',
        signal: controller.signal,
        headers: { 'User-Agent': USER_AGENT, 'Accept': 'text/html', 'Accept-Language': 'en-US,en;q=0.9' }
      });
      clearTimeout(timer);
      report.httpStatus = res.status;
      report.finalUrl = res.url;
      text = await res.text();
      report.reachable = res.status >= 200 && res.status < 400;
    } catch (fetchErr) {
      const fallbackText = fetchViaPowerShell(TECHSTARS_URL);
      if (!fallbackText) throw fetchErr;
      text = fallbackText;
      report.httpStatus = 200;
      report.finalUrl = TECHSTARS_URL;
      report.reachable = true;
      report.note = 'Fetched Techstars with Windows PowerShell fallback after Node fetch failed.';
    }
    report.contentLength = text.length;
    report.title = (text.match(/<title[^>]*>([^<]+)<\/title>/i) || [])[1] || null;

    if (!report.reachable) {
      report.note = 'Techstars returned HTTP ' + report.httpStatus + '. No items parsed.';
      return report;
    }

    const knownIsoDates = [...new Set([...text.matchAll(/"earliestCurrentDeadline":"(\d{4}-\d{2}-\d{2})"/g)].map(match => match[1]))];
    const cardRe = /<a\s+class="[^"]*"\s+style="[^"]*"\s+href="(\/accelerators\/[^"]+)"[^>]*><div[^>]*>Apply by\s+([^<]+)<\/div><div[^>]*>([^<]+)<\/div><div[^>]*>([^<]+)<\/div><\/a>/gi;
    const seen = new Set();
    let match;
    while ((match = cardRe.exec(text)) !== null) {
      const href = match[1];
      const applyBy = techstarsStripHtml(match[2]);
      const title = techstarsStripHtml(match[3]);
      const location = techstarsStripHtml(match[4]) || 'Online / Hybrid';
      const slug = href.replace(/^\/accelerators\//, '').replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase();
      if (!slug || seen.has(slug)) continue;
      seen.add(slug);

      const deadlineDate = parseTechstarsApplyDate(applyBy, knownIsoDates);
      if (!deadlineDate || isNaN(deadlineDate.getTime())) {
        report.invalidItemCount += 1;
        continue;
      }
      const daysFromNow = (deadlineDate.getTime() - Date.now()) / 86400000;
      if (daysFromNow < -7 || daysFromNow > TECHSTARS_MAX_FUTURE_DAYS) {
        report.invalidItemCount += 1;
        continue;
      }

      report.items.push({
        id: 'techstars-' + slug,
        title,
        deadline: deadlineDate.toISOString().replace('.000Z', 'Z'),
        dateRange: 'Apply by ' + applyBy,
        location,
        isOnline: /anywhere|remote|virtual/i.test(location),
        tags: ['startup', 'accelerator', 'Techstars'],
        url: new URL(href, TECHSTARS_URL).href,
        status: 'upcoming',
        description: 'Parsed from official Techstars accelerators listing. Deadline is read from the Apply by card and embedded earliestCurrentDeadline.',
        stage: 'Application deadline',
        source: 'Techstars Accelerators',
        type: 'program'
      });
    }

    report.items.sort((a, b) => new Date(a.deadline) - new Date(b.deadline));
    report.parsedItemCount = report.items.length;
    report.parserHealthy = report.parsedItemCount >= TECHSTARS_MIN_ITEMS;
    report.note = 'Parsed ' + report.parsedItemCount + ' items from Techstars; rejected ' + report.invalidItemCount + ' entries.';
  } catch (err) {
    report.error = err.name === 'AbortError' ? 'Timeout after ' + CRAWL_TIMEOUT_MS + 'ms' : err.message;
    report.note = 'Techstars fetch failed: ' + report.error;
  }
  return report;
}

async function techstarsAdapter() {
  return parseTechstarsItems();
}
async function ycAdapter() {
  return fetchSourcePage({ id: "yc", name: "Y Combinator", url: "https://www.ycombinator.com/apply" });
}

async function startupGrindAdapter() {
  return fetchSourcePage({ id: "startupgrind", name: "Startup Grind / Accelerate", url: "https://www.startupgrind.com" });
}

async function grantWatchAdapter() {
  return fetchSourcePage({ id: "grantwatch", name: "GrantWatch", url: "https://www.grantwatch.com" });
}

const adapters = [ycAdapter, techstarsAdapter, startupGrindAdapter, grantWatchAdapter];
const existingItemsUrl = new URL('../data/items.json', import.meta.url);
const existingItems = JSON.parse(fs.readFileSync(existingItemsUrl, 'utf8'));
let previousParsedItemCount = null;
try {
  const previousReport = JSON.parse(fs.readFileSync(new URL('../data/crawl-report.json', import.meta.url), 'utf8'));
  previousParsedItemCount = previousReport.parsedItemCount ?? null;
} catch {}
const reports = await Promise.all(adapters.map(adapter => adapter()));

const harvestedItems = reports.flatMap(report => report.items);
const parsedItemCount = reports.reduce((s, r) => s + (r.parsedItemCount || 0), 0);
const parserHealthy = reports.every(r => r.parserHealthy !== false);
const parserDropOk = previousParsedItemCount === null || parsedItemCount >= Math.floor(previousParsedItemCount * 0.5);
if (harvestedItems.length >= TECHSTARS_MIN_ITEMS && parserHealthy && parserDropOk) {
  fs.writeFileSync(existingItemsUrl, JSON.stringify(harvestedItems, null, 2) + '\n', 'utf8');
  console.log('crawler wrote ' + harvestedItems.length + ' fetched items');
} else {
  console.log('parser emitted ' + harvestedItems.length + ' items (health gate failed or threshold not met); preserving ' + existingItems.length + ' curated items in data/items.json');
}

const reachableCount = reports.filter(r => r.reachable).length;
console.log('reachability: ' + reachableCount + '/' + reports.length + ' sources reachable');
if (parsedItemCount > 0) console.log('parsedItemCount: ' + parsedItemCount);

fs.writeFileSync(new URL('../data/crawl-report.json', import.meta.url), JSON.stringify({
  topicId: "startup-ddl",
  generatedAt: new Date().toISOString(),
  adapterCount: reports.length,
  reachableCount,
  parsedItemCount,
  previousParsedItemCount,
  parserHealthy,
  parserDropOk,
  adapters: reports
}, null, 2) + '\n', 'utf8');
