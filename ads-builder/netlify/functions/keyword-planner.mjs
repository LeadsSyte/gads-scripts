// Netlify Function: Keyword Volume Checker via Google Ads API (KeywordPlanIdeaService)
// Requires: GOOGLE_ADS_DEVELOPER_TOKEN, GOOGLE_ADS_CLIENT_ID, GOOGLE_ADS_CLIENT_SECRET,
//           GOOGLE_ADS_REFRESH_TOKEN, GOOGLE_ADS_CUSTOMER_ID

import { GoogleAdsApi } from 'google-ads-api';

// Google Ads geo target constant IDs — these map directly to the frontend locationCode values
// Format for API: `geoTargetConstants/{id}`
const LOCATION_MAP = {
  2710: 2710,       // South Africa
  1007295: 1007295, // Johannesburg
  1007296: 1007296, // Cape Town
  1007298: 1007298, // Durban
  1007297: 1007297, // Pretoria
  2840: 2840,       // United States
  2826: 2826,       // United Kingdom
  2036: 2036,       // Australia
  2124: 2124,       // Canada
  2554: 2554,       // New Zealand
  2276: 2276,       // Germany
  2356: 2356,       // India
  2250: 2250,       // France
  2528: 2528,       // Netherlands
  2784: 2784,       // UAE
  2702: 2702,       // Singapore
  2404: 2404,       // Kenya
  2566: 2566,       // Nigeria
  2716: 2716,       // Zimbabwe
  2072: 2072,       // Botswana
  2516: 2516,       // Namibia
  2288: 2288,       // Ghana
  2834: 2834,       // Tanzania
  2372: 2372,       // Ireland
};

// Google Ads language constant IDs
// See: https://developers.google.com/google-ads/api/reference/data/codes-formats#languages
const LANG_MAP = {
  2276: 1001, // German
  2250: 1002, // French
  2528: 1010, // Dutch
};
const DEFAULT_LANG = 1000; // English

function classifyVolume(vol) {
  if (vol >= 1000) return 'high';
  if (vol >= 100) return 'medium';
  if (vol >= 10) return 'low';
  return 'zero';
}

function mapCompetition(level) {
  // Google Ads API returns: UNSPECIFIED, UNKNOWN, LOW, MEDIUM, HIGH
  if (!level) return null;
  const str = String(level).toUpperCase();
  if (str === 'LOW' || str === '2') return 'LOW';
  if (str === 'MEDIUM' || str === '3') return 'MEDIUM';
  if (str === 'HIGH' || str === '4') return 'HIGH';
  return null;
}

function getClient() {
  const developerToken = process.env.GOOGLE_ADS_DEVELOPER_TOKEN;
  const clientId = process.env.GOOGLE_ADS_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_ADS_CLIENT_SECRET;
  const refreshToken = process.env.GOOGLE_ADS_REFRESH_TOKEN;
  const customerId = process.env.GOOGLE_ADS_CUSTOMER_ID;

  if (!developerToken || !clientId || !clientSecret || !refreshToken || !customerId) {
    return null;
  }

  const client = new GoogleAdsApi({
    client_id: clientId,
    client_secret: clientSecret,
    developer_token: developerToken,
  });

  return client.Customer({
    customer_id: customerId.replace(/-/g, ''),
    refresh_token: refreshToken,
  });
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

  const customer = getClient();
  if (!customer) {
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Google Ads API credentials not configured. Required: GOOGLE_ADS_DEVELOPER_TOKEN, GOOGLE_ADS_CLIENT_ID, GOOGLE_ADS_CLIENT_SECRET, GOOGLE_ADS_REFRESH_TOKEN, GOOGLE_ADS_CUSTOMER_ID' }),
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

    const geoId = LOCATION_MAP[locationCode] || 2710;
    const langId = LANG_MAP[locationCode] || DEFAULT_LANG;

    // Process in batches of 20 keywords (API recommendation for generateKeywordHistoricalMetrics)
    const batchSize = 20;
    const allResults = [];

    for (let i = 0; i < keywords.length; i += batchSize) {
      const batch = keywords.slice(i, i + batchSize);

      try {
        // Use generateKeywordHistoricalMetrics for exact keyword volume lookup
        const response = await customer.keywordPlanIdeas.generateKeywordHistoricalMetrics({
          customer_id: process.env.GOOGLE_ADS_CUSTOMER_ID.replace(/-/g, ''),
          keywords: batch,
          geo_target_constants: [`geoTargetConstants/${geoId}`],
          keyword_plan_network: 'GOOGLE_SEARCH',
          language: `languageConstants/${langId}`,
        });

        if (response && response.results) {
          for (const result of response.results) {
            // google-ads-api library returns camelCase; raw API returns snake_case — handle both
            const metrics = result.keyword_metrics || result.keywordMetrics || {};
            const vol = Number(metrics.avg_monthly_searches ?? metrics.avgMonthlySearches) || 0;
            const compIdx = Number(metrics.competition_index ?? metrics.competitionIndex) || null;
            const cpcMicros = Number(metrics.average_cpc_micros ?? metrics.averageCpcMicros) || 0;
            const cpc = cpcMicros > 0 ? Math.round(cpcMicros / 1000000 * 100) / 100 : null;
            const keywordText = (result.text || result.keyword || batch[0] || '').toLowerCase();

            allResults.push({
              keyword: keywordText,
              avgMonthlySearches: vol,
              competition: mapCompetition(metrics.competition),
              competitionIndex: compIdx,
              cpc: cpc,
              tier: classifyVolume(vol),
              hasVolume: vol > 0,
              recommended: vol >= 10,
            });
          }
        }
      } catch (batchErr) {
        console.warn(`Batch ${i}-${i + batchSize} failed:`, batchErr.message);
        // On batch failure, try fallback with generateKeywordIdeas (broader but more reliable)
        try {
          const fallback = await customer.keywordPlanIdeas.generateKeywordIdeas({
            customer_id: process.env.GOOGLE_ADS_CUSTOMER_ID.replace(/-/g, ''),
            seed_keywords: batch,
            geo_target_constants: [`geoTargetConstants/${geoId}`],
            keyword_plan_network: 'GOOGLE_SEARCH',
            language: `languageConstants/${langId}`,
            include_adult_keywords: false,
          });

          // generateKeywordIdeas returns ideas — match back to our input keywords
          const ideasMap = {};
          if (fallback && fallback.results) {
            for (const idea of fallback.results) {
              const kw = (idea.text || idea.keyword || '').toLowerCase();
              ideasMap[kw] = idea.keyword_idea_metrics || idea.keywordIdeaMetrics || {};
            }
          }

          for (const kw of batch) {
            const kwLower = kw.toLowerCase();
            const metrics = ideasMap[kwLower] || {};
            const vol = Number(metrics.avg_monthly_searches ?? metrics.avgMonthlySearches) || 0;
            const compIdx = Number(metrics.competition_index ?? metrics.competitionIndex) || null;
            const cpcMicros = Number(metrics.average_cpc_micros ?? metrics.averageCpcMicros) || 0;
            const cpc = cpcMicros > 0 ? Math.round(cpcMicros / 1000000 * 100) / 100 : null;

            allResults.push({
              keyword: kwLower,
              avgMonthlySearches: vol,
              competition: mapCompetition(metrics.competition),
              competitionIndex: compIdx,
              cpc: cpc,
              tier: classifyVolume(vol),
              hasVolume: vol > 0,
              recommended: vol >= 10,
            });
          }
        } catch (fallbackErr) {
          console.error(`Fallback also failed for batch ${i}:`, fallbackErr.message);
          // Return keywords as unchecked so frontend handles gracefully
          for (const kw of batch) {
            allResults.push({
              keyword: kw.toLowerCase(),
              avgMonthlySearches: null,
              competition: null,
              competitionIndex: null,
              cpc: null,
              tier: null,
              hasVolume: null,
              recommended: null,
            });
          }
        }
      }
    }

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
      body: JSON.stringify({ keywords: allResults }),
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
