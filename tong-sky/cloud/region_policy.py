"""Filter previously restored excluded-region artifacts before publication."""
import pathlib
import re

EXCLUDED_REGIONS = ('동북아시아', '대한민국')


def excluded_generated_path(relative, catalog, origin='ICN'):
    path = pathlib.PurePosixPath(relative)
    if not path.parts:
        return False
    excluded_ids = {catalog.get('ids', {}).get(region) for region in EXCLUDED_REGIONS}
    excluded_ids.discard(None)
    if path.parts[0] in ('regions', 'bundles') and path.stem in excluded_ids:
        return True
    if path.parts[0] == 'shards' and any(path.stem.startswith(region_id + '-') for region_id in excluded_ids):
        return True
    if path.parts[0] in ('snapshots', 'errors'):
        match = re.fullmatch(r'([A-Z]{3})-([A-Z]{3})-\d{4}-\d{2}', path.stem)
        if match:
            # ICN/GMP is the configured anchor; classify the other endpoint.
            counterpart = match[2] if match[1] == origin else match[1]
            excluded_codes = {airport['code'] for region in EXCLUDED_REGIONS for airport in catalog.get('regions', {}).get(region, [])}
            return counterpart in excluded_codes
    return False
