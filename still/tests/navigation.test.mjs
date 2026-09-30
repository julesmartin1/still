import {test} from 'node:test';
import assert from 'node:assert/strict';
import {parseText} from '../dist/engine.js';
import {buildParagraphIndex,paragraphStart,findPassages} from '../dist/navigation.js';
import {readingSummary} from '../dist/library.js';
const tokens=parseText('A quiet morning.\n\nAn extraordinary discovery, just outside.\n\nThe last paragraph is here.').tokens;
const groups=buildParagraphIndex(tokens);
test('paragraph jump uses exact token positions and rejects invalid input',()=>{
 assert.equal(paragraphStart(groups,1),0);assert.equal(paragraphStart(groups,2),3);
 for(const value of [0,4,NaN,1.5])assert.equal(paragraphStart(groups,value),null);
});
test('search finds phrases case-insensitively and selects the matching word',()=>{
 const result=findPassages(groups,'EXTRAORDINARY discovery');assert.equal(result.length,1);assert.equal(result[0].paragraph,1);assert.equal(result[0].index,4);
 assert.equal(findPassages(groups,'discovery, just')[0].index,5);
 assert.equal(findPassages(groups,'last paragraph')[0].index,9);
 assert.deepEqual(findPassages(groups,'no such phrase'),[]);assert.deepEqual(findPassages(groups,'   '),[]);
});
test('search returns bounded results without crossing paragraphs',()=>{
 const indexed=buildParagraphIndex(parseText(Array.from({length:25},(_,i)=>`A shared word ${i}`).join('\n\n')).tokens);
 assert.equal(findPassages(indexed,'shared').length,20);
 assert.deepEqual(findPassages(groups,'morning an'),[]);
});
test('bookshelf summaries exclude text but preserve saved progress',()=>{
 const summary=readingSummary({id:'book',title:'Book',text:'private words',index:12,wordCount:100,updatedAt:123,finished:false});
 assert.equal(summary.index,12);assert.equal(summary.title,'Book');assert.equal('text' in summary,false);
});
