export const EXCLUDED_REGIONS = new Set(['동북아시아', '대한민국']);
export function includedRegions(catalog) {
  return Object.entries(catalog.regions).filter(([region]) => !EXCLUDED_REGIONS.has(region));
}
export function assertIncludedRegion(catalog, region) {
  if (EXCLUDED_REGIONS.has(region)) throw Error('Collection disabled for excluded region: ' + region);
  if (!Array.isArray(catalog.regions[region]) || !catalog.ids[region]) throw Error('Unknown collection region: ' + region);
}
