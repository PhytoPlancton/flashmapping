// utils.js — misc shared helpers (pure functions only).

/* ================================================================
 * Country extraction from free-text contact.location
 * ================================================================
 * Input examples:
 *   "Paris, France"                    → {code: 'FR', name: 'France', emoji: '🇫🇷'}
 *   "Darmstadt, Germany"               → {code: 'DE', ...}
 *   "New York, NY, United States"      → {code: 'US', ...}
 *   "London, England, UK"              → {code: 'GB', ...}
 *   "Nowhere"                          → null  (unknown)
 *   ""                                 → null
 *
 * Approach: last comma-separated token (trimmed + lowercased), looked up
 * in COUNTRY_NORMALIZE. Handles common aliases (UK, USA, England, …).
 */

export const COUNTRY_NORMALIZE = {
  'france':                 { code: 'FR', name: 'France',          emoji: '🇫🇷' },
  'germany':                { code: 'DE', name: 'Germany',         emoji: '🇩🇪' },
  'united states':          { code: 'US', name: 'United States',   emoji: '🇺🇸' },
  'united states of america': { code: 'US', name: 'United States', emoji: '🇺🇸' },
  'usa':                    { code: 'US', name: 'United States',   emoji: '🇺🇸' },
  'us':                     { code: 'US', name: 'United States',   emoji: '🇺🇸' },
  'united kingdom':         { code: 'GB', name: 'United Kingdom',  emoji: '🇬🇧' },
  'uk':                     { code: 'GB', name: 'United Kingdom',  emoji: '🇬🇧' },
  'england':                { code: 'GB', name: 'United Kingdom',  emoji: '🇬🇧' },
  'scotland':               { code: 'GB', name: 'United Kingdom',  emoji: '🇬🇧' },
  'wales':                  { code: 'GB', name: 'United Kingdom',  emoji: '🇬🇧' },
  'northern ireland':       { code: 'GB', name: 'United Kingdom',  emoji: '🇬🇧' },
  'great britain':          { code: 'GB', name: 'United Kingdom',  emoji: '🇬🇧' },
  'denmark':                { code: 'DK', name: 'Denmark',         emoji: '🇩🇰' },
  'switzerland':            { code: 'CH', name: 'Switzerland',     emoji: '🇨🇭' },
  'italy':                  { code: 'IT', name: 'Italy',           emoji: '🇮🇹' },
  'spain':                  { code: 'ES', name: 'Spain',           emoji: '🇪🇸' },
  'netherlands':            { code: 'NL', name: 'Netherlands',     emoji: '🇳🇱' },
  'the netherlands':        { code: 'NL', name: 'Netherlands',     emoji: '🇳🇱' },
  'holland':                { code: 'NL', name: 'Netherlands',     emoji: '🇳🇱' },
  'belgium':                { code: 'BE', name: 'Belgium',         emoji: '🇧🇪' },
  'poland':                 { code: 'PL', name: 'Poland',          emoji: '🇵🇱' },
  'ireland':                { code: 'IE', name: 'Ireland',         emoji: '🇮🇪' },
  'norway':                 { code: 'NO', name: 'Norway',          emoji: '🇳🇴' },
  'sweden':                 { code: 'SE', name: 'Sweden',          emoji: '🇸🇪' },
  'finland':                { code: 'FI', name: 'Finland',         emoji: '🇫🇮' },
  'austria':                { code: 'AT', name: 'Austria',         emoji: '🇦🇹' },
  'portugal':               { code: 'PT', name: 'Portugal',        emoji: '🇵🇹' },
  'greece':                 { code: 'GR', name: 'Greece',          emoji: '🇬🇷' },
  'czech republic':         { code: 'CZ', name: 'Czech Republic', emoji: '🇨🇿' },
  'czechia':                { code: 'CZ', name: 'Czech Republic', emoji: '🇨🇿' },
  'hungary':                { code: 'HU', name: 'Hungary',         emoji: '🇭🇺' },
  'romania':                { code: 'RO', name: 'Romania',         emoji: '🇷🇴' },
  'russia':                 { code: 'RU', name: 'Russia',          emoji: '🇷🇺' },
  'russian federation':     { code: 'RU', name: 'Russia',          emoji: '🇷🇺' },
  'turkey':                 { code: 'TR', name: 'Turkey',          emoji: '🇹🇷' },
  'türkiye':                { code: 'TR', name: 'Turkey',          emoji: '🇹🇷' },
  'turkiye':                { code: 'TR', name: 'Turkey',          emoji: '🇹🇷' },
  'japan':                  { code: 'JP', name: 'Japan',           emoji: '🇯🇵' },
  'china':                  { code: 'CN', name: 'China',           emoji: '🇨🇳' },
  'india':                  { code: 'IN', name: 'India',           emoji: '🇮🇳' },
  'south korea':            { code: 'KR', name: 'South Korea',     emoji: '🇰🇷' },
  'korea':                  { code: 'KR', name: 'South Korea',     emoji: '🇰🇷' },
  'republic of korea':      { code: 'KR', name: 'South Korea',     emoji: '🇰🇷' },
  'singapore':              { code: 'SG', name: 'Singapore',       emoji: '🇸🇬' },
  'hong kong':              { code: 'HK', name: 'Hong Kong',       emoji: '🇭🇰' },
  'taiwan':                 { code: 'TW', name: 'Taiwan',          emoji: '🇹🇼' },
  'uae':                    { code: 'AE', name: 'UAE',             emoji: '🇦🇪' },
  'united arab emirates':   { code: 'AE', name: 'UAE',             emoji: '🇦🇪' },
  'saudi arabia':           { code: 'SA', name: 'Saudi Arabia',    emoji: '🇸🇦' },
  'egypt':                  { code: 'EG', name: 'Egypt',           emoji: '🇪🇬' },
  'algeria':                { code: 'DZ', name: 'Algeria',         emoji: '🇩🇿' },
  'tunisia':                { code: 'TN', name: 'Tunisia',         emoji: '🇹🇳' },
  'morocco':                { code: 'MA', name: 'Morocco',         emoji: '🇲🇦' },
  'brazil':                 { code: 'BR', name: 'Brazil',          emoji: '🇧🇷' },
  'argentina':              { code: 'AR', name: 'Argentina',       emoji: '🇦🇷' },
  'mexico':                 { code: 'MX', name: 'Mexico',          emoji: '🇲🇽' },
  'colombia':               { code: 'CO', name: 'Colombia',        emoji: '🇨🇴' },
  'chile':                  { code: 'CL', name: 'Chile',           emoji: '🇨🇱' },
  'peru':                   { code: 'PE', name: 'Peru',            emoji: '🇵🇪' },
  'canada':                 { code: 'CA', name: 'Canada',          emoji: '🇨🇦' },
  'australia':              { code: 'AU', name: 'Australia',       emoji: '🇦🇺' },
  'new zealand':            { code: 'NZ', name: 'New Zealand',     emoji: '🇳🇿' },
  'south africa':           { code: 'ZA', name: 'South Africa',    emoji: '🇿🇦' },
  'nigeria':                { code: 'NG', name: 'Nigeria',         emoji: '🇳🇬' },
  'kenya':                  { code: 'KE', name: 'Kenya',           emoji: '🇰🇪' },
  'israel':                 { code: 'IL', name: 'Israel',          emoji: '🇮🇱' },
  'ukraine':                { code: 'UA', name: 'Ukraine',         emoji: '🇺🇦' },
  'bulgaria':               { code: 'BG', name: 'Bulgaria',        emoji: '🇧🇬' },
  'slovakia':               { code: 'SK', name: 'Slovakia',        emoji: '🇸🇰' },
  'slovenia':               { code: 'SI', name: 'Slovenia',        emoji: '🇸🇮' },
  'croatia':                { code: 'HR', name: 'Croatia',         emoji: '🇭🇷' },
  'serbia':                 { code: 'RS', name: 'Serbia',          emoji: '🇷🇸' },
  'pakistan':               { code: 'PK', name: 'Pakistan',        emoji: '🇵🇰' },
  'bangladesh':             { code: 'BD', name: 'Bangladesh',      emoji: '🇧🇩' },
  'indonesia':              { code: 'ID', name: 'Indonesia',       emoji: '🇮🇩' },
  'thailand':               { code: 'TH', name: 'Thailand',        emoji: '🇹🇭' },
  'vietnam':                { code: 'VN', name: 'Vietnam',         emoji: '🇻🇳' },
  'philippines':            { code: 'PH', name: 'Philippines',     emoji: '🇵🇭' },
  'malta':                  { code: 'MT', name: 'Malta',           emoji: '🇲🇹' },
  'luxembourg':             { code: 'LU', name: 'Luxembourg',      emoji: '🇱🇺' },
  'iceland':                { code: 'IS', name: 'Iceland',         emoji: '🇮🇸' },
  'iran':                   { code: 'IR', name: 'Iran',            emoji: '🇮🇷' }
};

/**
 * Extract a country descriptor from free-text location.
 * Returns { code, name, emoji } or null if we can't confidently identify one.
 */
export function extractCountry(location) {
  if (!location || typeof location !== 'string') return null;
  // Take the last comma-separated token — it's where country usually lives.
  const parts = location.split(',').map(s => s.trim()).filter(Boolean);
  if (!parts.length) return null;
  // Try last token, then second-to-last (handles "London, England, UK" where
  // last is "UK" which IS in the table, but also "Paris, France, Europe").
  for (let i = parts.length - 1; i >= Math.max(0, parts.length - 2); i--) {
    const key = parts[i].toLowerCase();
    const hit = COUNTRY_NORMALIZE[key];
    if (hit) return hit;
  }
  return null;
}
