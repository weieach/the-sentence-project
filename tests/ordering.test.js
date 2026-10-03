import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createApp } from '../server/index.js';
import { createWorker } from '../server/worker.js';
import { createStorage } from '../server/storage.js';
import { HttpError } from '../server/validation.js';
const ids = ['11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222'];
for (const runtime of ['local','hosted']) {
  test(`${runtime}: gallery ordering requires admin access, validates IDs, and persists selection`, async t => {
    let order = 'newest';
    let custom = [...ids];
    const rows = () => (order === 'custom' ? custom : order === 'oldest' ? [...ids].reverse() : ids).map(id => ({id}));
    const storage = {configured:true, getOrder:async()=>order,list:async()=>rows(),listAdmin:async()=>rows(),setOrder:async data=>{
      if (data.ids && (data.ids.length !== ids.length || data.ids.some(id=>!ids.includes(id)))) throw new HttpError(409,'Refresh the list.');
      order = data.order;
      if (data.ids) custom = data.ids;
      return {order};
    }};
    let request;
    if(runtime === 'local') {
      const server = createApp({storage,secret:'ordering-tests',password:'upload',adminUsername:'test',adminPassword:'test'});
      server.listen(0,'127.0.0.1'); await once(server,'listening');
      t.after(()=>new Promise(resolve=>{server.closeAllConnections();server.close(resolve);}));
      request = (path,options)=>fetch(`http://127.0.0.1:${server.address().port}${path}`,options);
    } else {
      const app = createWorker({storageFactory:()=>storage});
      request = (path,options)=>app.fetch(new Request(`https://sentence.example${path}`,options),{SUPABASE_URL:'https://test.supabase.co',SUPABASE_SECRET_KEY:'test',SESSION_SECRET:'ordering-tests',UPLOAD_PASSWORD:'upload',ADMIN_USERNAME:'test',ADMIN_PASSWORD:'test'});
    }
    const login = async (path,body)=>(await request(path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)})).headers.get('set-cookie').split(';')[0];
    const cookie = await login('/api/admin-session',{username:'test',password:'test'});
    const uploadCookie = await login('/api/session',{password:'upload'});
    const put = (body,headers={})=>request('/api/admin-order',{method:'PUT',headers:{cookie,'Content-Type':'application/json',...headers},body:JSON.stringify(body)});
    for(const badCookie of ['',uploadCookie,cookie+'bad']) {
      assert.equal((await request('/api/admin-order',{headers:{cookie:badCookie}})).status,401);
      assert.equal((await put({order:'oldest'},{cookie:badCookie})).status,401);
    }
    assert.equal((await put({order:'oldest'},{origin:'https://other.example'})).status,403);
    assert.equal((await put({order:'oldest'},{'sec-fetch-site':'cross-site'})).status,403);
    for(const data of [null,{}, {order:'bad'},{order:'custom',ids:['bad']},{order:'custom',ids:[ids[0],ids[0]]},{order:'newest',ids}]) assert.equal((await put(data)).status,400);
    assert.equal((await put({order:'custom',ids:[ids[0]]})).status,409);
    assert.equal(order,'newest');
    assert.equal((await put({order:'oldest'})).status,200);
    assert.equal((await (await request('/api/admin-order',{headers:{cookie}})).json()).order,'oldest');
    assert.deepEqual((await (await request('/api/entries')).json()).entries.map(x=>x.id),[...ids].reverse());
    assert.equal((await put({order:'custom',ids})).status,200);
    assert.deepEqual((await (await request('/api/entries')).json()).entries.map(x=>x.id),ids);
    assert.equal((await put({order:'newest'})).status,200);
    assert.equal((await put({order:'custom'})).status,200);
    assert.deepEqual(custom,ids);
  });
}
test('Supabase uses the selected order consistently for public and admin pagination',async()=>{
  for(const [order,expected] of [['newest','created_at.desc,id.desc'],['oldest','created_at.asc,id.asc'],['custom','display_order.asc,created_at.desc,id.desc']]) {
    let queries=0;
    const storage=createStorage({url:'https://test.supabase.co',key:'test',fetchImpl:async url=>{
      if(url.includes('/gallery_settings')) return Response.json([{sort_order:order}]);
      const query=new URL(url).searchParams;
      assert.equal(query.get('order'),expected);assert.equal(query.get('offset'),'50');queries++;
      return Response.json([]);
    }});
    await storage.list(50);await storage.listAdmin(50);assert.equal(queries,2);
  }
});
test('custom ordering makes one atomic RPC and reports stale-list conflicts',async()=>{
  let calls=0;
  const storage=createStorage({url:'https://test.supabase.co',key:'test',fetchImpl:async(url,options)=>{
    assert.equal(new URL(url).pathname,'/rest/v1/rpc/set_gallery_order');
    assert.deepEqual(JSON.parse(options.body),{p_order:'custom',p_ids:ids});
    calls++;return Response.json(calls===1);
  }});
  assert.deepEqual(await storage.setOrder({order:'custom',ids}),{order:'custom'});
  await assert.rejects(storage.setOrder({order:'custom',ids}),{status:409});
});
