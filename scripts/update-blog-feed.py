#!/usr/bin/env python3
"""Read the owner's public Naver RSS and atomically update a tiny static post index."""
import argparse
import datetime as dt
import email.utils
import html
import json
import pathlib
import re
import urllib.request
import xml.etree.ElementTree as ET

BLOG = 'https://blog.naver.com/mkj2449'
FEED = 'https://rss.blog.naver.com/mkj2449.xml'

def parse_feed(data):
    if len(data) > 2000000 or b'<!DOCTYPE' in data.upper() or b'<!ENTITY' in data.upper():
        raise ValueError('Unsupported RSS document')
    root = ET.fromstring(data)
    channel = root.find('channel')
    if channel is None:
        raise ValueError('Missing RSS channel')
    posts, seen = [], set()
    for item in channel.findall('item'):
        raw_url = (item.findtext('guid') or item.findtext('link') or '').split('?')[0].strip()
        if not re.fullmatch(r'https://(?:m\.)?blog\.naver\.com/mkj2449/\d+', raw_url):
            continue
        url = raw_url.replace('https://m.blog.naver.com/', 'https://blog.naver.com/')
        title = html.unescape(re.sub(r'<[^>]+>', '', item.findtext('title') or '')).strip()
        title = ' '.join(title.split())[:300]
        if not title or url in seen:
            continue
        published = email.utils.parsedate_to_datetime(item.findtext('pubDate') or '')
        if published.tzinfo is None:
            raise ValueError('RSS date has no timezone')
        posts.append({'title': title, 'url': url, 'publishedAt': published.astimezone(dt.timezone.utc).isoformat().replace('+00:00','Z')})
        seen.add(url)
    if not posts:
        raise ValueError('No valid blog posts; retain previous file')
    posts.sort(key=lambda p:p['publishedAt'], reverse=True)
    return {'schema':1, 'blogUrl':BLOG, 'blogName':channel.findtext('title') or '', 'posts':posts[:4]}

def main():
    p=argparse.ArgumentParser();p.add_argument('--output',type=pathlib.Path,required=True);p.add_argument('--input',type=pathlib.Path)
    args=p.parse_args()
    if args.input:
        data=args.input.read_bytes()
    else:
        with urllib.request.urlopen(FEED, timeout=25) as response:
            if response.status != 200: raise ValueError('RSS unavailable')
            data=response.read(2000001)
    feed=parse_feed(data)
    # Avoid commits and Pages builds when only the polling time changed.
    if args.output.exists() and json.loads(args.output.read_text(encoding='utf-8')) == feed:
        print('Unchanged blog posts');return
    args.output.parent.mkdir(parents=True,exist_ok=True)
    temporary=args.output.with_suffix('.json.tmp')
    temporary.write_text(json.dumps(feed,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    temporary.replace(args.output)
    print(f"Saved {len(feed['posts'])} blog posts")

if __name__ == '__main__':main()
