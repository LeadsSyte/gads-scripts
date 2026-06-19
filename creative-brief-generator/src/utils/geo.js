const TLD_MAP = {
  '.co.za': 'South Africa',
  '.za': 'South Africa',
  '.co.uk': 'United Kingdom',
  '.uk': 'United Kingdom',
  '.com.au': 'Australia',
  '.au': 'Australia',
  '.co.nz': 'New Zealand',
  '.nz': 'New Zealand',
  '.ca': 'Canada',
  '.de': 'Germany',
  '.fr': 'France',
  '.nl': 'Netherlands',
  '.in': 'India',
  '.co.in': 'India',
  '.sg': 'Singapore',
  '.ae': 'United Arab Emirates',
  '.ng': 'Nigeria',
  '.ke': 'Kenya',
  '.gh': 'Ghana',
}

export function detectGeo(url) {
  try {
    const hostname = new URL(url).hostname.toLowerCase()
    // Check longer TLDs first (e.g., .co.za before .za)
    const sortedTlds = Object.keys(TLD_MAP).sort((a, b) => b.length - a.length)
    for (const tld of sortedTlds) {
      if (hostname.endsWith(tld)) {
        return TLD_MAP[tld]
      }
    }
    return null // .com or unknown — don't restrict
  } catch {
    return null
  }
}
