import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {basename,join,resolve,sep} from 'node:path';
import type {TestContext} from 'node:test';

/** Fresh synthetic test storage, independent of a checkout's local artifacts. */
export function temporaryDirectory(t:Pick<TestContext,'after'>,label:string):string {
  assert.match(label,/^[a-z-]+$/);
  const prefix=`rekindle-public-${label}-`;
  const directory=mkdtempSync(join(tmpdir(),prefix));
  t.after(()=>{
    assert(resolve(directory).startsWith(resolve(tmpdir())+sep)&&basename(directory).startsWith(prefix));
    rmSync(directory,{recursive:true,force:true});
  });
  return directory;
}
