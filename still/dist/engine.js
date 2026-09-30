export const clamp=(n,a,b)=>Math.min(b,Math.max(a,n));
export const cleanWord=w=>w.toLowerCase().replace(/^[^\p{L}]+|[^\p{L}]+$/gu,'');
const common=new Set('the of and a to in is you that it he was for on are as with his they at be this from i have or by one had not but what all were when we there can an your which their said if do will each about how up out them then she many some so these would other into has more her two like him see time could no make than first been its who now people my made over did down only way find use may water long little very after words just where most know get through back much before go good new write our me man too any day same right look think also around another come work three word must because does part even place well such here take why things help put different away again off went old number great tell every found still between name should home big give air line set own under read last never us left end along while might next sound below saw something thought both few those always show often together asked house world going want school important until form food keep children feet land side without boy once life enough took book hear stop almost let above sometimes answer light sea began need point city play small yet better morning room open slowly eyes window street quiet read reading pace pause start'.split(' '));
export function parseText(text){const paragraphs=text.trim().split(/\n\s*\n/).filter(Boolean);const tokens=[];paragraphs.forEach((p,paragraph)=>{let sentence=[];const finish=()=>{const length=sentence.length;const commas=sentence.filter(t=>/[,;:]/.test(t.text)).length;const complexity=clamp((length-16)*.006+commas*.018,0,.18);sentence.forEach(t=>t.complexity=complexity);sentence=[];};for(const word of p.trim().split(/\s+/)){const norm=cleanWord(word);const token={text:word,norm,paragraph,index:tokens.length,rare:!common.has(norm)&&norm.length>5,complexity:0,paragraphEnd:false};tokens.push(token);sentence.push(token);if(/[.!?][”’"')\]]*$/.test(word))finish();}finish();tokens.at(-1).paragraphEnd=true;});const difficulty=tokens.length?clamp(tokens.filter(t=>t.rare).length/tokens.length*.13,0,.07):0;return {tokens,paragraphs,difficulty};}
export const freshProfile=()=>({slowdown:0,lookups:{},rewinds:[]});
export function recordRewind(profile,paragraph,now=Date.now()){const recent=profile.rewinds.filter(r=>now-r.time<10*60*1000);if(!recent.some(r=>r.paragraph===paragraph))recent.push({paragraph,time:now});const additional=recent.length>=3&&recent.length>profile.rewinds.filter(r=>now-r.time<10*60*1000).length?.025:0;return {...profile,rewinds:recent.slice(-20),slowdown:clamp(profile.slowdown+additional,0,.2)};}
export function recordLookup(profile,word){const lookups={...profile.lookups,[cleanWord(word)]:Date.now()};return {...profile,lookups};}
// Relative weights allocate the paragraph's budget; they do not add time to it.
export function wordWeight(token,{profile=freshProfile(),now=Date.now()}={}) {
  const letters=(token.norm.match(/\p{L}/gu)||[]).length;
  let weight=clamp(1+.04*Math.max(0,letters-5),1,1.5);
  weight+=token.complexity||0;
  if(token.rare)weight+=.16;
  const looked=profile.lookups[token.norm];
  if(Number.isFinite(looked))weight+=.25*clamp(1-(now-looked)/86400000/30,0,1);
  if(/[,;:][”’"')\]]*$/.test(token.text))weight+=.35;
  if(/[.!?][”’"')\]]*$/.test(token.text))weight+=.7;
  if(token.paragraphEnd)weight+=.6;
  return weight;
}
export function targetWpm(base,profile=freshProfile(),replay=false) {
  return clamp(base,80,600)/(1+clamp(profile.slowdown||0,0,.2))/(replay?1.16:1);
}
// Reserve a readable share for every word, then allocate the remainder by weight.
export function minimumWordTime(average) {
  return Math.max(.85*average,Math.min(140,.95*average));
}
export function allocateWordTimes(weights,budget) {
  if(!weights.length)return [];
  const minimum=minimumWordTime(budget/weights.length),result=new Array(weights.length);
  let pending=weights.map((weight,index)=>({weight,index})),remaining=budget;
  while(pending.length){
    const total=pending.reduce((sum,w)=>sum+w.weight,0);
    const pinned=pending.filter(w=>remaining*w.weight/total<minimum);
    if(!pinned.length){for(const w of pending)result[w.index]=remaining*w.weight/total;break;}
    const pinnedIndices=new Set(pinned.map(w=>w.index));
    for(const w of pinned){result[w.index]=minimum;remaining-=minimum;}
    pending=pending.filter(w=>!pinnedIndices.has(w.index));
  }
  return result;
}
export function buildTimingPlan(tokens,{base=260,profile=freshProfile(),replayParagraph=null,now=Date.now()}={}) {
  const groups=new Map();
  tokens.forEach((token,index)=>{if(!groups.has(token.paragraph))groups.set(token.paragraph,[]);groups.get(token.paragraph).push({index,weight:wordWeight(token,{profile,now})});});
  const durations=new Array(tokens.length);
  for(const [paragraph,words] of groups){
    const budget=words.length*60000/targetWpm(base,profile,paragraph===replayParagraph);
    const allocated=allocateWordTimes(words.map(w=>w.weight),budget);
    words.forEach((word,i)=>durations[word.index]=allocated[i]);
  }
  return durations;
}
export class Playback{constructor({length,duration,onWord,onEnd,schedule=(fn,ms)=>setTimeout(fn,ms),cancel=id=>clearTimeout(id),clock=()=>performance.now()}){Object.assign(this,{length,duration,onWord,onEnd,schedule,cancel,clock});this.index=0;this.playing=false;this.timer=null;this.finished=false;}play(){if(this.playing||!this.length)return;if(this.finished){this.index=0;this.finished=false;}this.playing=true;this.deadline=this.clock();this.onWord(this.index);this.queue();}queue(){this.deadline=this.clock()+this.duration(this.index);this.timer=this.schedule(()=>{if(!this.playing)return;if(this.index>=this.length-1){this.pause();this.finished=true;this.onEnd();return;}this.index++;this.onWord(this.index);this.queue();},Math.max(0,this.deadline-this.clock()));}pause(){this.playing=false;this.cancel(this.timer);this.timer=null;}seek(index){this.pause();this.index=clamp(index,0,Math.max(0,this.length-1));this.finished=false;this.onWord(this.index);}retime(){if(this.playing){this.cancel(this.timer);this.deadline=this.clock();this.queue();}}}
