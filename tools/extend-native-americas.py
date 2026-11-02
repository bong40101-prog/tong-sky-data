"""Apply the 1.0.41-rc1 scope change to an extracted, separate 1.0.40 source tree.
Never edits an APK, a signing key, or saved passenger/seat data.
Usage: python3 tools/extend-native-americas.py /path/to/extracted/TongSKY-1.0.40
"""
import json
from pathlib import Path
import sys

root = Path(sys.argv[1]).resolve() / 'tong-sky'
main = root / 'src/main'
j = main / 'java/kr/tong/sky'
changes = {}

def replace(path, old, new):
    text = changes.get(path, path.read_text(encoding='utf-8'))
    if old not in text:
        raise SystemExit(f'Not the expected base: {path.name}')
    changes[path] = text.replace(old, new)

replace(j / 'RepeatMarkerPolicy.java', 'if("US".equals(city.optString("countryCode")))return "US";', 'if("미주".equals(region))return "US".equals(city.optString("countryCode"))?"US":"AMERICAS";')
p = main / 'assets/repeat-marker-catalog.json'
cat = json.loads(p.read_text()); source = json.loads((main / 'assets/regions.json').read_text())
old = {city['code']: city for group in cat['regions'].values() for city in group}
new = {'YVR': 'CA', 'YYZ': 'CA'}
for region in ['미주', '유럽']:
    group = []
    for city in source['regions'][region]:
        code = city['code']
        if code not in old and code not in new:
            raise SystemExit('Manual country mapping needed: ' + code)
        group.append(old[code] if code in old else {'code': code, 'countryCode': new[code]})
    if len({c['code'] for c in group}) != len(group):
        raise SystemExit('Duplicate airport in source catalog')
    cat['regions'][region] = group
changes[p] = json.dumps(cat, ensure_ascii=False, separators=(',', ':')) + '\n'
for fn in ['MainActivity.java', 'SeatMarks.java']:
    replace(j / fn, '유럽·미국', '유럽·미주(캐나다 포함)')
replace(root / 'build.gradle', "versionCode 10140\n  versionName '1.0.40'", "versionCode 10141\n  versionName '1.0.41-rc1'")
replace(root / 'scripts/build-local.py', "'1.0.40',10140", "'1.0.41-rc1',10141")
replace(root / 'tests/framework-region-import/src/test/java/kr/tong/sky/RepeatMarkerPolicyTest.java', 'raw.put("destination","YVR");assertNull(RepeatMarkerPolicy.rule(raw,raw,catalog()));', 'raw.put("destination","YVR");assertEquals("AMERICAS",RepeatMarkerPolicy.rule(raw,raw,catalog()).getString("scope"));raw.put("origin","YVR").put("destination","ICN");assertEquals("AMERICAS",RepeatMarkerPolicy.rule(raw,raw,catalog()).getString("scope"));raw.put("origin","ICN");')
for path, value in changes.items():
    path.write_text(value, encoding='utf-8')
print('Updated', len(changes), 'native source, asset, test and build files. No APK was published.')
