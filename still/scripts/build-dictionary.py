"""Extract one leading WordNet sense per part of speech; preserve source license.
Usage: python3 scripts/build-dictionary.py /path/to/wordnet-db/package
"""
import sys,json,pathlib,shutil
source=pathlib.Path(sys.argv[1]);dest=pathlib.Path(__file__).resolve().parents[1]/'dist'/'dictionary';dest.mkdir(exist_ok=True)
words={}
for pos in ['noun','verb','adj','adv']:
    gloss={}
    for line in (source/'dict'/('data.'+pos)).read_text().splitlines():
        if line and line[0].isdigit() and '|' in line:
            fields,definition=line.split('|',1);gloss[fields.split()[0]]=definition.strip()
    for line in (source/'dict'/('index.'+pos)).read_text().splitlines():
        if not line or line[0].isspace():continue
        f=line.split();word=f[0]
        if not word.isalpha():continue
        pointer_count=int(f[3]);offset=f[6+pointer_count]
        definition=gloss.get(offset)
        if definition:words.setdefault(word,[]).append({'part':pos,'definition':definition})
for letter in 'abcdefghijklmnopqrstuvwxyz':
    (dest/(letter+'.json')).write_text(json.dumps({k:v for k,v in words.items() if k.startswith(letter)},ensure_ascii=False,separators=(',',':')))
shutil.copyfile(source/'LICENSE',dest/'LICENSE.txt')
(dest/'README.txt').write_text('Derived from WordNet 3.1, distributed through wordnet-db 3.1.14.\nhttps://github.com/moos/wordnet-db\nModified: alphabetic single words; first sense per part of speech; partitioned JSON.\nSee LICENSE.txt for terms and copyright.\n')
print(f'Bundled {len(words):,} dictionary headwords')
