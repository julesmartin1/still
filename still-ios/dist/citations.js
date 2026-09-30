import {parseText} from './engine.js';
const year='(?:18|19|20)\\d{2}[a-z]?';
const author="(?:(?:van|von|de|der|la)\\s+)*[\\p{Lu}][\\p{L}’'\\-]+(?:\\s+(?:[\\p{Lu}][\\p{L}’'\\-]+|van|von|de|der|la))*";
const names=`${author}(?:\\s+et\\s+al\\.|(?:,\\s*|\\s+(?:&|and)\\s+|,\\s*(?:&|and)\\s+)${author})*`;
const locator='(?:pp?\\.|chap\\.)\\s*\\d+(?:\\s*[–—±-]\\s*\\d+)?';
const authorYear=new RegExp(`^(?:(?:see(?: also)?|e\\.g\\.,?|cf\\.)\\s+)?${names},\\s+${year}(?:\\s*,\\s*(?:${year}|${locator}))*$`,'u');
const yearsOnly=new RegExp(`^${year}(?:\\s*[,;]\\s*(?:${year}|${locator}))*$`,'u');
export function citationSpans(text){
  const spans=[];
  for(const match of text.matchAll(/\([^()]{1,1500}\)|(?<![\p{L}\d])1(?=[\p{Lu}]|(?:see|cf|e\.g|van|von|de|der|la)\b|(?:18|19|20)\d{2})[^()]{1,1500}\)|\[\d+(?:\s*[,–-]\s*\d+)*\]/gu)){
    const raw=match[0],inside=raw.slice(1,-1).replace(/\s+/g,' ').trim(),start=match.index,end=start+raw.length;
    if(raw[0]==='['){
      const before=text.slice(Math.max(0,start-65),start);
      const nums=inside.match(/\d+/g).map(Number);
      if(nums.some(n=>n<1||n>999)||/[=+*/]\s*$/.test(before)||/[\p{L}\d_]$/u.test(before)||/\b(?:array|interval|range|index|indices|vector|matrix|equation|score|values?|ages?|aged|participants|samples?)\s*[:=]?\s*$/i.test(before))continue;
      spans.push({start,end,kind:'numbered',text:raw});continue;
    }
    const parts=inside.split(/;\s*/);
    if(parts.every(p=>authorYear.test(p))){spans.push({start,end,kind:'author-year',text:raw});continue;}
    if(yearsOnly.test(inside)){
      const before=text.slice(Math.max(0,start-100),start);
      if(!/\b(?:January|February|March|April|May|June|July|August|September|October|November|December|Spring|Summer|Autumn|Winter|Experiment|Study|Report|Edition|Copyright|Intelligence|Publication|Version)\s*$/.test(before)&&new RegExp(`(?:^|\\s)${names}\\s+$`,'u').test(before)&&!/(?:in|during|since|from|year|born|died|copyright|published)\s+[\p{Lu}][\p{L}’'-]*\s+$/u.test(before))spans.push({start,end,kind:'narrative',text:raw});
    }
    // Mixed explanatory parentheses are deliberately retained in full.
  }
  return spans;
}
export function referenceRange(text){
  const paragraphs=text.trim().split(/\n\s*\n/).filter(Boolean);
  const start=paragraphs.findIndex(p=>/^(?:\d+[.)]?\s+)?(?:references|bibliography|works cited)(?:\s*$|\n)/i.test(p.trim()));
  if(start<0)return null;
  let end=paragraphs.length;
  for(let i=start+1;i<paragraphs.length;i++)if(/^(?:appendix|appendices|supplement(?:ary)?(?: material)?|acknowledg(?:e)?ments?)\b/i.test(paragraphs[i].trim())){end=i;break;}
  return {start:start+1,end};
}
export function filteredReading(text,options={}){
  const original=parseText(text),spans=citationSpans(text),detected=referenceRange(text);
  const range=options.referenceRange||detected;
  const mask=new Uint8Array(text.length);
  if(options.skipCitations)for(const s of spans)mask.fill(1,s.start,s.end);
  const sourceWords=[...text.matchAll(/\S+/g)];
  const retained=[];let skipped=0;
  for(let sourceIndex=0;sourceIndex<sourceWords.length;sourceIndex++){
    const m=sourceWords[sourceIndex],paragraph=original.tokens[sourceIndex].paragraph;
    const inReferences=options.skipReferences&&range&&paragraph+1>=range.start&&paragraph+1<=range.end;
    let value='';if(!inReferences)for(let j=0;j<m[0].length;j++)if(!mask[m.index+j])value+=m[0][j];
    if(!value){skipped++;continue;}
    if(/^[.,;:!?…“”‘’"\')\]]+$/.test(value)&&value!==m[0]){if(retained.length&&retained.at(-1).originalParagraph===paragraph){retained.at(-1).text+=value;retained.at(-1).sourceEnd=sourceIndex;}skipped++;continue;}
    retained.push({text:value,sourceIndex,sourceEnd:sourceIndex,originalParagraph:paragraph});
  }
  const paragraphs=[];const origins=[];let previous=-1;
  for(const t of retained){if(t.originalParagraph!==previous){paragraphs.push([]);previous=t.originalParagraph;}paragraphs.at(-1).push(t.text);origins.push(t);}
  const visible=parseText(paragraphs.map(p=>p.join(' ')).join('\n\n'));
  visible.tokens.forEach((t,i)=>Object.assign(t,{sourceIndex:origins[i].sourceIndex,sourceEnd:origins[i].sourceEnd,originalParagraph:origins[i].originalParagraph}));
  return {...visible,original,spans,detected,range,skipped};
}
export function visibleIndex(tokens,sourceIndex){const i=tokens.findIndex(t=>t.sourceIndex>=sourceIndex);return i<0?tokens.length:i;}
