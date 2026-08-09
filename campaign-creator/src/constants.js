export const STD_NEGS = [
  'what is', 'how to', 'define', 'definition', 'meaning',
  'free', 'cheap', 'budget', 'diy', 'tutorial', 'guide',
  'wiki', 'wikipedia', 'reddit', 'forum', 'blog',
  'example', 'examples', 'jobs', 'careers', 'salary',
  'volunteer', 'course', 'class', 'learn', 'study',
  'history of', 'documentary', 'video', 'youtube',
  'images', 'pictures', 'photos', 'recipe', 'recipes',
  'restaurant', 'near me', 'vs', 'versus', 'compare',
  'review', 'reviews', 'complaint', 'scam', 'fake',
  'pdf', 'download', 'template', 'internship', 'vacancy',
  'vacancies', 'training', 'certification',
];

export const STAGING_DOMAINS = [
  'lovable.app', 'lovable.dev', 'webflow.io', 'framer.app',
  'framer.site', 'bubble.io', 'glide.page', 'typedream.app',
  'super.so', 'notion.site', 'carrd.co', 'squarespace.com/preview',
  'myshopify.com', 'netlify.app', 'vercel.app', 'github.io',
  'pages.dev', 'render.com',
];

export const INIT = {
  businessName: '',
  website: '',
  landingPage: '',
  description: '',
  targetCustomer: '',
  industry: '',
  usps: '',
  campaignName: '',
  dailyBudget: 333,
  currencySymbol: 'R',
  bidStrategy: 'Maximize conversions',
  language: 'en',
  targetLocations: 'South Africa',
  excludedLocations: '',
  additionalNotes: '',
  emailAddress: 'michaelh@syte.co.za',
};

export const SHEETS = [
  { key: 'campaign', label: '01 Campaign', icon: '🎯', col: '#1a4b8c' },
  { key: 'locations', label: '02 Locations', icon: '📍', col: '#059669' },
  { key: 'adGroups', label: '03 Ad Groups', icon: '📂', col: '#7c3aed' },
  { key: 'keywords', label: '04 Keywords', icon: '🔑', col: '#d97706' },
  { key: 'negatives', label: '05 Negatives', icon: '🚫', col: '#dc2626' },
  { key: 'ads', label: '06 Ads', icon: '✍️', col: '#0891b2' },
  { key: 'sitelinks', label: '07 Sitelinks', icon: '📌', col: '#7c3aed' },
  { key: 'callouts', label: '08 Callouts', icon: '💬', col: '#059669' },
  { key: 'snippets', label: '09 Snippets', icon: '📋', col: '#1a4b8c' },
];

export const BID_MAP = {
  'Maximize clicks': 'Maximize clicks',
  'Maximize conversions': 'Maximize conversions',
  'Target CPA': 'Target CPA',
  'Manual CPC': 'Manual CPC',
};
