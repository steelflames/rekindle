import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { importSnapshot, parseTextImport } from '../server/sources.js';

test('synthetic sample preserves every nonempty author boundary, even without vote footers', () => {
  const text=readFileSync(new URL('../resources/sample-thread.txt',import.meta.url),'utf8');
  const lines=text.replace(/\r\n?/g,'\n').split('\n');
  const snapshot=importSnapshot(text,'synthetic-sample.txt');
  const sampleAuthorHeaders=[
    {author:'FixtureMaker01',line:5},{author:'FixtureReader02',line:18},
    {author:'FixtureGuide03',line:25},{author:'FixtureEmpty04',line:38},
    {author:'FixtureJoker05',line:42},{author:'FixtureMaker01',line:53},
    {author:'FixtureObserver06',line:61},{author:'FixtureReader07',line:69},
  ];
  const emptyHeaders=new Set([38]);
  assert.equal(snapshot.comments.length,7);
  assert.deepEqual(snapshot.comments.map(c=>[c.author,c.score]),[
    ['FixtureMaker01',12],['FixtureReader02',null],['FixtureGuide03',3],
    ['FixtureJoker05',7],['FixtureMaker01',null],['FixtureObserver06',null],['FixtureReader07',null],
  ]);
  let commentIndex=0;
  for(let i=0;i<sampleAuthorHeaders.length;i++){
    const header=sampleAuthorHeaders[i];
    assert.equal(lines[header.line-1],header.author,'fixture must match the raw source author');
    if(emptyHeaders.has(header.line))continue;
    const comment=snapshot.comments[commentIndex++];
    const [,startText,endText]=comment.locator!.match(/: lines (\d+)-(\d+)$/)!;
    const start=Number(startText),end=Number(endText);
    assert.ok(start>header.line+2,`${header.author} body begins after its own timestamp`);
    assert.ok(end<(sampleAuthorHeaders[i+1]?.line??lines.length),`${header.author} body must stop before the next author`);
    assert.equal(comment.body,lines.slice(start-1,end).join('\n'),'body remains an exact contiguous source slice');
    assert.ok(!/^(?:u\/\S+ avatar|\d+ more repl(?:y|ies)|Community Info Section)$/m.test(comment.body));
    assert.equal(comment.parentId,null);assert.equal(comment.permalink,null);assert.equal(comment.publishedAt,null);
  }
  assert.equal(snapshot.comments[1].body,'    Could the hand be catching on the frame?\n\nI would check the clearance before changing the gears.');
  assert.equal(snapshot.comments[1].score,null,'a later author vote cannot leak backwards');
  assert.equal(snapshot.comments.filter(c=>c.author==='FixtureMaker01').length,2,'repeated authors remain separate comments');
  assert.equal(new Set(snapshot.comments.map(c=>c.id)).size,7);
  assert.equal(snapshot.comments.filter(c=>c.author==='FixtureObserver06').length,1,'a matching avatar is not another author');
  assert.ok(!snapshot.comments.some(c=>c.body.includes('Unattributable interface tail')));
  assert.equal(snapshot.comments.at(-1)!.body,'The final fictional comment has no captured vote controls.');
  assert.equal(snapshot.coverage.retrieved,7);assert.equal(snapshot.coverage.analyzed,0);
});

test('footerless synthetic comments retain paragraphs, repeated authors, final body, and unknown scores', () => {
  const snapshot=parseTextImport(`Synthetic example : r/fixture
Comments Section
Alice_1
•
1h ago

    A quoted line whose indentation matters.

First person's final paragraph.
Bob_2
•
30m ago

Second person's words.
Upvote
9
Downvote
Reply
Award
Share
Alice_1
•
2m ago

Final footerless words.
Community Info Section
Sidebar prose.`,'synthetic.txt');
  assert.deepEqual(snapshot.comments.map(c=>[c.author,c.score]),[['Alice_1',null],['Bob_2',9],['Alice_1',null]]);
  assert.equal(snapshot.comments[0].body,"    A quoted line whose indentation matters.\n\nFirst person's final paragraph.");
  assert.equal(snapshot.comments[1].body,"Second person's words.");
  assert.equal(snapshot.comments[2].body,'Final footerless words.');
  assert.equal(new Set(snapshot.comments.map(c=>c.id)).size,3);
});

test('uncertain synthetic author headers are excluded and cannot contaminate a preceding quote', () => {
  const snapshot=parseTextImport(`Synthetic uncertain export : r/fixture
Comments Section
Known_1
•
1h ago

Known words only.
???
•
1h ago

Unknown author's words.
Malformed_2
•
yesterday

Unsupported timestamp words.
u/Other_3 avatar
Conflicting_3
•
1h ago

Conflicting identity words.
Recovered_4
•
1h ago

Recovered words only.
u/Orphan_5 avatar
Unattributable tail.
Community Info Section`,'synthetic-uncertain.txt');
  assert.deepEqual(snapshot.comments.map(c=>[c.author,c.body]),[['Known_1','Known words only.'],['Recovered_4','Recovered words only.']]);
  assert.ok(snapshot.coverage.limits.includes('3 malformed or conflicting author headers were excluded.'));
  assert.ok(snapshot.comments.every(c=>c.parentId===null&&c.score===null));
});
