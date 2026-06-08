// netlify/functions/news.js
const https = require('https');
const http = require('http');
const { DOMParser } = require('@xmldom/xmldom');

const FEEDS = {
  world: [
    { url: 'https://feeds.bbci.co.uk/news/world/rss.xml', name: 'BBC News', tag: 'WORLD', style: 'geo' },
    { url: 'https://feeds.reuters.com/reuters/worldNews', name: 'Reuters', tag: 'WORLD', style: 'geo' },
    { url: 'https://rss.nytimes.com/services/xml/rss/nyt/World.xml', name: 'New York Times', tag: 'WORLD', style: 'geo' },
    { url: 'https://www.thehindu.com/news/national/feeder/default.rss', name: 'The Hindu', tag: 'INDIA', style: 'india' },
    { url: 'https://feeds.bbci.co.uk/news/south_asia/rss.xml', name: 'BBC News', tag: 'SOUTH ASIA', style: 'india' },
  ],
  economics: [
    { url: 'https://www.economist.com/latest/rss.xml', name: 'The Economist', tag: 'ECONOMICS', style: 'eco' },
    { url: 'https://feeds.bbci.co.uk/news/business/rss.xml', name: 'BBC Business', tag: 'POLICY', style: 'eco' },
    { url: 'https://www.thehindu.com/business/Economy/feeder/default.rss', name: 'The Hindu', tag: 'INDIA ECONOMY', style: 'eco' },
    { url: 'https://rss.nytimes.com/services/xml/rss/nyt/Economy.xml', name: 'New York Times', tag: 'MARKETS', style: 'eco' },
  ],
  tech: [
    { url: 'https://www.technologyreview.com/feed/', name: 'MIT Tech Review', tag: 'TECHNOLOGY', style: 'tech' },
    { url: 'https://www.theverge.com/rss/index.xml', name: 'The Verge', tag: 'TECHNOLOGY', style: 'tech' },
    { url: 'https://www.downtoearth.org.in/rss/all', name: 'Down To Earth', tag: 'ENVIRONMENT', style: 'env' },
    { url: 'https://feeds.bbci.co.uk/news/science_and_environment/rss.xml', name: 'BBC Science', tag: 'SCIENCE', style: 'env' },
  ],
  business: [
    { url: 'https://feeds.bbci.co.uk/news/business/rss.xml', name: 'BBC Business', tag: 'BUSINESS', style: 'biz' },
    { url: 'https://www.thehindu.com/business/feeder/default.rss', name: 'The Hindu Business', tag: 'INDIA BUSINESS', style: 'biz' },
    { url: 'https://rss.nytimes.com/services/xml/rss/nyt/Business.xml', name: 'New York Times', tag: 'BUSINESS', style: 'biz' },
    { url: 'https://feeds.reuters.com/reuters/businessNews', name: 'Reuters Business', tag: 'STRATEGY', style: 'biz' },
  ],
  sport: [
    { url: 'https://www.espncricinfo.com/rss/content/story/feeds/0.xml', name: 'ESPNcricinfo', tag: 'CRICKET', style: 'sport' },
    { url: 'https://feeds.bbci.co.uk/sport/rss.xml', name: 'BBC Sport', tag: 'SPORT', style: 'sport' },
    { url: 'https://www.espn.com/espn/rss/news', name: 'ESPN', tag: 'SPORT', style: 'sport' },
  ],
  culture: [
    { url: 'https://feeds.dezeen.com/dezeen', name: 'Dezeen', tag: 'DESIGN', style: 'culture' },
    { url: 'https://www.theguardian.com/culture/rss', name: 'The Guardian', tag: 'CULTURE', style: 'culture' },
  ],
};

function fetchUrl(url) {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith('https') ? https : http;
    const req = lib.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; TheBriefBot/1.0)',
        'Accept': 'application/rss+xml, application/xml, text/xml, */*',
      },
      timeout: 8000,
    }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return fetchUrl(res.headers.location).then(resolve).catch(reject);
      }
      if (res.statusCode !== 200) {
        return reject(new Error(`HTTP ${res.statusCode}`));
      }
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve(data));
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
  });
}

function stripHtml(html) {
  return (html || '').replace(/<!\[CDATA\[|\]\]>/g, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

function parseRSS(xmlText, feedMeta) {
  try {
    const parser = new DOMParser();
    const doc = parser.parseFromString(xmlText, 'text/xml');
    const items = Array.from(doc.getElementsByTagName('item'));
    const entries = Array.from(doc.getElementsByTagName('entry'));
    const all = items.length ? items : entries;
    return all.slice(0, 4).map(item => {
      const getText = (tag) => {
        const el = item.getElementsByTagName(tag)[0];
        if (!el) return '';
        return el.textContent || '';
      };
      const title = stripHtml(getText('title'));
      if (!title) return null;
      let link = getText('link').trim();
      if (!link) {
        const linkEl = item.getElementsByTagName('link')[0];
        if (linkEl) link = linkEl.getAttribute('href') || '';
      }
      const desc = getText('description') || getText('summary') || getText('content:encoded') || getText('content');
      const summary = stripHtml(desc).slice(0, 300).trim();
      const pubDate = getText('pubDate') || getText('published') || getText('updated') || '';
      return { headline: title, link, summary, pubDate, tag: feedMeta.tag, style: feedMeta.style, source: feedMeta.name };
    }).filter(Boolean);
  } catch (e) { return []; }
}

async function fetchFeed(feedMeta) {
  try {
    const xml = await fetchUrl(feedMeta.url);
    return parseRSS(xml, feedMeta);
  } catch (e) {
    console.log(`Feed failed: ${feedMeta.url} — ${e.message}`);
    return [];
  }
}

function dedup(items) {
  const seen = new Set();
  return items.filter(item => {
    const key = item.headline.slice(0, 50).toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

async function fetchSection(feedList) {
  const results = await Promise.allSettled(feedList.map(f => fetchFeed(f)));
  const all = results.flatMap(r => r.status === 'fulfilled' ? r.value : []);
  return dedup(all).slice(0, 4);
}

exports.handler = async function(event, context) {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json',
    'Cache-Control': 'public, max-age=3600',
  };
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }
  try {
    const [world, economics, tech, business, sport, culture] = await Promise.all([
      fetchSection(FEEDS.world),
      fetchSection(FEEDS.economics),
      fetchSection(FEEDS.tech),
      fetchSection(FEEDS.business),
      fetchSection(FEEDS.sport),
      fetchSection(FEEDS.culture),
    ]);
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ ok: true, data: { world, economics, tech, business, sport, culture }, fetched_at: Date.now() }),
    };
  } catch (e) {
    return { statusCode: 500, headers, body: JSON.stringify({ ok: false, error: e.message }) };
  }
};
