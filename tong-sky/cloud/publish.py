"""Publish only generated public-calendar JSON; credentials stay in Actions env."""
import base64,hashlib,json,os,pathlib,subprocess,sys,urllib.request,urllib.error
root=pathlib.Path(sys.argv[1]).resolve()
token=os.environ['GITHUB_TOKEN'];repo=os.environ['GITHUB_REPOSITORY'];branch=os.environ.get('SKY_DATA_BRANCH','tong-sky-data')
headers={'Authorization':'Bearer '+token,'Accept':'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28'}
def api(p,method='GET',body=None):
 req=urllib.request.Request('https://api.github.com/repos/'+repo+p,headers=headers,method=method,data=None if body is None else json.dumps(body).encode())
 with urllib.request.urlopen(req,timeout=45) as r:return json.load(r)
try:ref=api('/git/ref/heads/'+branch);head=ref['object']['sha']
except urllib.error.HTTPError as e:
 if e.code!=404:raise
 base=api('/git/ref/heads/'+os.environ.get('SKY_SOURCE_BRANCH','main'))['object']['sha']
 api('/git/refs','POST',{'ref':'refs/heads/'+branch,'sha':base});head=base
tree=api('/git/commits/'+head)['tree']['sha'];entries=[]
existing={e['path']:e['sha'] for e in api('/git/trees/'+tree+'?recursive=1')['tree'] if e['type']=='blob'}
for file in sorted(root.rglob('*.json')):
 # Generated data only; never publish source trees, tokens, logs or signing files.
 relative=file.relative_to(root).as_posix()
 if relative.split('/')[0] not in ('snapshots','regions','errors','shards','bundles'):raise RuntimeError('Unexpected generated-data path')
 content=file.read_bytes();blob=hashlib.sha1(b'blob '+str(len(content)).encode()+b'\x00'+content).hexdigest()
 if existing.get('data/'+relative)==blob:continue
 entries.append({'path':'data/'+relative,'mode':'100644','type':'blob','content':content.decode('utf-8')})
if not entries:sys.exit(0)
new=api('/git/trees','POST',{'base_tree':tree,'tree':entries})
if new['sha']==tree:sys.exit(0)
commit=api('/git/commits','POST',{'message':'Update TongSKY calendar cache [skip ci]','tree':new['sha'],'parents':[head]})
api('/git/refs/heads/'+branch,'PATCH',{'sha':commit['sha'],'force':False})
