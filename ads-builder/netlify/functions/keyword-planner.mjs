// Netlify Function: Keyword Volume Checker via DataForSEO
// Requires DATAFORSEO_LOGIN and DATAFORSEO_PASSWORD environment variables

// Google Ads location codes → DataForSEO location codes
const LOCATION_MAP = {
  2710: 2710,   // South Africa
  1007295: 1007295, // Johannesburg
  1007296: 1007296, // Cape Town
  1007298: 1007298, // Durban
  1007297: 1007297, // Pretoria
  2840: 2840,   // United States
  2826: 2826,   // United Kingdom
  2036: 2036,   // Australia
  2124: 2124,   // Canada
  2554: 2554,   // New Zealand
  2276: 2276,   // Germany
  2356: 2356,   // India
  2250: 2250,   // France
  2528: 2528,   // Netherlands
  2784: 2784,   // UAE
  2702: 2702,   // Singapore
  2404: 2404,   // Kenya
  2566: 2566,   // Nigeria
  2716: 2716,   // Zimbabwe
  2072: 2072,   // Botswana
  2516: 2516,   // Namibia
  2288: 2288,   // Ghana
  2834: 2834,   // Tanzania
  2372: 2372,   // Ireland
};

// Language codes per location
const LANG_MAP = {
  2276: 1031, // German
  2250: 1036, // French
  2528: 1043, // Dutch
};

function classifyVolume(vol) {
  if (vol >= 1000) return 'high';
  if (vol >= 100) return 'medium';
  if (vol >= 10) return 'low';
  return 'zero';
}

export async function handler(event) {
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 204,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
      },
    };
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  const login = process.env.DATAFORSEO_LOGIN;
  const password = process.env.DATAFORSEO_PASSWORD;

  if (!login || !password) {
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'DataForSEO credentials not configured' }),
    };
  }

  try {
    const { keywords, locationCode = 2710 } = JSON.parse(event.body);

    if (!keywords || !Array.isArray(keywords) || keywords.length === 0) {
      return {
        statusCode: 400,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'keywords array is required' }),
      };
    }

    const location = LOCATION_MAP[locationCode] || 2710;
    const languageCode = LANG_MAP[locationCode] || 1000; // 1000 = English

    // DataForSEO Google Ads Search Volume endpoint
    const postData = [{
      keywords: keywords.slice(0, 700), // API limit
      location_code: location,
      language_code: languageCode,
      date_from: getDateMonthsAgo(12),
      date_to: getDateMonthsAgo(0),
    }];

    const auth = Buffer.from(`${login}:${password}`).toString('base64');

    const response = await fetch(
      'https://api.dataforseo.com/v3/keywords_data/google_ads/search_volume/live',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Basic ${auth}`,
        },
        body: JSON.stringify(postData),
      }
    );

    if (!response.ok) {
      const errText = await response.text();
      console.error('DataForSEO error:', response.status, errText);
      return {
        statusCode: response.status,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: `DataForSEO API error: ${response.status}` }),
      };
    }

    const data = await response.json();

    if (!data.tasks || !data.tasks[0] || !data.tasks[0].result) {
      return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ keywords: [] }),
      };
    }

    const results = data.tasks[0].result || [];

    const enriched = results.map((item) => {
      const vol = item.search_volume || 0;
      return {
        keyword: item.keyword,
        avgMonthlySearches: vol,
        competition: item.competition || null,
        competitionIndex: item.competition_index || null,
        cpc: item.cpc || null,
        tier: classifyVolume(vol),
        hasVolume: vol > 0,
        recommended: vol >= 10,
      };
    });

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
      body: JSON.stringify({ keywords: enriched }),
    };
  } catch (err) {
    console.error('keyword-planner error:', err);
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: err.message || 'Internal server error' }),
    };
  }
}

function getDateMonthsAgo(months) {
  const d = new Date();
  d.setMonth(d.getMonth() - months);
  return d.toISOString().split('T')[0];
}
