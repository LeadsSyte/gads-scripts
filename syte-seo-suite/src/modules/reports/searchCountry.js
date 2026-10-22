// Which country the AEO census searches FROM.
//
// AI engines answer "best duvet brand" differently in London and Cape Town:
// they rank local stores and cite local sites. A UK client probed from the
// engines' default location is measured against the wrong market, so every
// engine call carries the client's country (aeoEngines.js passes it as the web
// search tool's user location and as a one-line system note).
//
// Resolution order, first match wins:
//   1. client.search_country   the Clients list field (ISO 3166-1 alpha-2)
//   2. the website's domain    .co.uk -> GB, .co.za -> ZA, .com.au -> AU ...
//   3. the Location field      "London", "United States", "Johannesburg" ...
// A plain .com with no usable location resolves to null: the engines then
// search exactly as before, rather than from a guessed country.
//
// Pure and node-testable: no imports.

export const SEARCH_COUNTRIES = [
  { code: 'ZA', name: 'South Africa' },
  { code: 'GB', name: 'United Kingdom' },
  { code: 'US', name: 'United States' },
  { code: 'IE', name: 'Ireland' },
  { code: 'AU', name: 'Australia' },
  { code: 'NZ', name: 'New Zealand' },
  { code: 'CA', name: 'Canada' },
  { code: 'AE', name: 'United Arab Emirates' },
  { code: 'DE', name: 'Germany' },
  { code: 'NL', name: 'Netherlands' },
  { code: 'FR', name: 'France' },
  { code: 'ES', name: 'Spain' },
  { code: 'IT', name: 'Italy' },
  { code: 'PT', name: 'Portugal' },
  { code: 'SG', name: 'Singapore' },
  { code: 'IN', name: 'India' },
  { code: 'NA', name: 'Namibia' },
  { code: 'BW', name: 'Botswana' },
  { code: 'KE', name: 'Kenya' },
  { code: 'NG', name: 'Nigeria' },
  { code: 'MU', name: 'Mauritius' }
];

const BY_CODE = new Map(SEARCH_COUNTRIES.map(c => [c.code, c]));

export function countryName(code) {
  return BY_CODE.get(String(code || '').toUpperCase())?.name || null;
}

// Country-code TLDs (incl. second-level forms like .co.uk). `.uk` maps to GB.
const TLD = {
  uk: 'GB', za: 'ZA', us: 'US', ie: 'IE', au: 'AU', nz: 'NZ', ca: 'CA', ae: 'AE',
  de: 'DE', nl: 'NL', fr: 'FR', es: 'ES', it: 'IT', pt: 'PT', sg: 'SG', in: 'IN',
  na: 'NA', bw: 'BW', ke: 'KE', ng: 'NG', mu: 'MU'
};

export function countryFromUrl(url) {
  const host = String(url || '').toLowerCase().trim()
    .replace(/^https?:\/\//, '').replace(/[/:?#].*$/, '');
  const parts = host.split('.').filter(Boolean);
  if (parts.length < 2) return null;
  return TLD[parts[parts.length - 1]] || null;
}

// Words in a free-text Location / Service Area that pin the country. Checked
// as whole words, longest phrases first, so "New South Wales" beats "Wales"
// and "South Africa" is not read as anything else.
const PLACE_WORDS = [
  ['south africa', 'ZA'], ['johannesburg', 'ZA'], ['joburg', 'ZA'], ['cape town', 'ZA'],
  ['durban', 'ZA'], ['pretoria', 'ZA'], ['sandton', 'ZA'], ['gauteng', 'ZA'],
  ['port elizabeth', 'ZA'], ['gqeberha', 'ZA'], ['bloemfontein', 'ZA'], ['kwazulu', 'ZA'], ['rsa', 'ZA'],
  ['new south wales', 'AU'], ['australia', 'AU'], ['sydney', 'AU'], ['melbourne', 'AU'], ['brisbane', 'AU'], ['perth', 'AU'],
  ['new zealand', 'NZ'], ['auckland', 'NZ'], ['wellington', 'NZ'],
  ['united kingdom', 'GB'], ['great britain', 'GB'], ['england', 'GB'], ['scotland', 'GB'],
  ['wales', 'GB'], ['northern ireland', 'GB'], ['britain', 'GB'], ['london', 'GB'],
  ['manchester', 'GB'], ['birmingham', 'GB'], ['edinburgh', 'GB'], ['glasgow', 'GB'], ['uk', 'GB'],
  ['ireland', 'IE'], ['dublin', 'IE'], ['cork', 'IE'],
  ['united states', 'US'], ['america', 'US'], ['usa', 'US'], ['new york', 'US'], ['california', 'US'],
  ['texas', 'US'], ['florida', 'US'], ['los angeles', 'US'], ['chicago', 'US'], ['us', 'US'],
  ['canada', 'CA'], ['toronto', 'CA'], ['vancouver', 'CA'],
  ['united arab emirates', 'AE'], ['uae', 'AE'], ['dubai', 'AE'], ['abu dhabi', 'AE'],
  ['germany', 'DE'], ['netherlands', 'NL'], ['amsterdam', 'NL'], ['france', 'FR'], ['paris', 'FR'],
  ['spain', 'ES'], ['italy', 'IT'], ['portugal', 'PT'], ['singapore', 'SG'], ['india', 'IN'],
  ['namibia', 'NA'], ['windhoek', 'NA'], ['botswana', 'BW'], ['gaborone', 'BW'],
  ['kenya', 'KE'], ['nairobi', 'KE'], ['nigeria', 'NG'], ['lagos', 'NG'], ['mauritius', 'MU']
].sort((a, b) => b[0].length - a[0].length);

export function countryFromLocation(text) {
  // Case matters for one word: "US" is the country, "us" is a pronoun.
  const raw = String(text || '');
  const norm = ' ' + raw.toLowerCase().replace(/[^a-z\s]/g, ' ').replace(/\s+/g, ' ').trim() + ' ';
  if (!norm.trim()) return null;
  const found = new Set();
  let rest = norm;
  for (const [word, code] of PLACE_WORDS) {
    if (word === 'us' && !/\bUS\b|\bU\.S\.?/.test(raw)) continue;
    const needle = ' ' + word + ' ';
    if (rest.includes(needle)) { found.add(code); rest = rest.split(needle).join(' '); }
  }
  // A location naming two countries ("UK and South Africa") is a judgement
  // call for a person, not a guess.
  return found.size === 1 ? [...found][0] : null;
}

// { code, name, source } or null. source: 'client' | 'website' | 'location'.
export function resolveSearchCountry(client = {}) {
  const set = String(client?.search_country || '').trim().toUpperCase();
  if (set && set !== 'AUTO' && BY_CODE.has(set)) return { code: set, name: countryName(set), source: 'client' };
  const fromUrl = countryFromUrl(client?.url);
  if (fromUrl) return { code: fromUrl, name: countryName(fromUrl), source: 'website' };
  const fromLoc = countryFromLocation(client?.location || client?.market || client?.geo);
  if (fromLoc) return { code: fromLoc, name: countryName(fromLoc), source: 'location' };
  return null;
}
