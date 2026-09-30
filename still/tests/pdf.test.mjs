import {test} from 'node:test';import assert from 'node:assert/strict';import {pageText,extractPdf,pdfErrorMessage} from '../dist/pdf-import.js';
const item=(str,x,y,hasEOL=false)=>({str,transform:[12,0,0,12,x,y],width:str.length*6,height:12,hasEOL});
const file={name:'Reading.pdf',size:40,type:'application/pdf',arrayBuffer:async()=>new TextEncoder().encode('%PDF-1.7\nfixture').buffer};
function mock(pages){let destroyed=false;return {getDocument:()=>({promise:Promise.resolve({numPages:pages.length,getPage:async n=>({getTextContent:async()=>({items:pages[n-1]}),cleanup(){}})}),destroy:async()=>{destroyed=true;}}),destroyed:()=>destroyed};}
test('PDF fragments form words, lines and paragraphs without concatenation',()=>{assert.equal(pageText([item('Hel',0,700),item('lo',18,700),item('world.',36,700,true),item('Second line.',0,684,true),item('New paragraph.',0,645,true)]),'Hello world. Second line.\n\nNew paragraph.');});
test('PDF import preserves page order and reports empty pages',async()=>{const m=mock([[item('First page.',0,700,true)],[],[item('Third page.',0,700,true)]]);const progress=[];const r=await extractPdf(file,{getDocument:m.getDocument,onProgress:(a,b)=>progress.push([a,b])});assert.equal(r.text,'First page.\n\nThird page.');assert.equal(r.blankPages,1);assert.equal(r.pages,3);assert.deepEqual(progress,[[1,3],[2,3],[3,3]]);assert.ok(m.destroyed());});
test('image-only PDF fails clearly and releases the document',async()=>{const m=mock([[]]);await assert.rejects(extractPdf(file,{getDocument:m.getDocument}),/No selectable text/);assert.ok(m.destroyed());});
test('invalid, oversized and cancelled inputs do not start parsing',async()=>{const no=()=>{throw Error('should not parse')};await assert.rejects(extractPdf({...file,size:51*1024*1024},{getDocument:no}),/smaller than 50 MB/);await assert.rejects(extractPdf({...file,arrayBuffer:async()=>new TextEncoder().encode('not pdf').buffer},{getDocument:no}),/could not be read/);const c=new AbortController();c.abort();await assert.rejects(extractPdf(file,{signal:c.signal,getDocument:no}),{name:'AbortError'});});
test('password and malformed PDF failures have actionable messages',()=>{assert.match(pdfErrorMessage({name:'PasswordException'}),/unlocked copy/);assert.match(pdfErrorMessage({name:'InvalidPDFException'}),/another PDF/);});

test('transient reader and file-access errors explain recovery',()=>{
 assert.match(pdfErrorMessage(new TypeError('Failed to fetch dynamically imported module')),/reader could not finish loading/);
 assert.match(pdfErrorMessage({name:'NotReadableError'}),/downloaded to your device/);
 assert.match(pdfErrorMessage(new Error('Unknown parse failure')),/Retry this file/);
 assert.equal(pdfErrorMessage({userMessage:'No selectable text found',message:'worker failure'}),'No selectable text found');
});
