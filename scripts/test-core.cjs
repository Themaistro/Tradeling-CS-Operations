/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
function load(file, db, extras = {}) {
  const code = ts.transpileModule(fs.readFileSync(path.join(root, file), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  const m = { exports: {} };
  const resolver = name => {
    if (extras[name]) return extras[name];
    if (name === '@/lib/db/prisma') return { prisma: db };
    if (name === 'next/server') return { NextResponse: { json: (body, options) => ({ body, status: options?.status || 200 }) } };
    if (name.startsWith('@/')) return load('src/' + name.slice(2) + (name.includes('task-icon') ? '.tsx' : '.ts'), db, extras);
    return require(name);
  };
  new Function('require', 'module', 'exports', code)(resolver, m, m.exports);
  return m.exports;
}
const request = body => ({ json: async () => body });
async function tasks() {
  let stored = null, version = 0;
  const windows = [{ dayOfWeek: 3, startTime: '09:00', endTime: '18:00' }];
  const db = { appSettings: { findUnique: async () => ({timezone:'UTC'}) }, shiftAssignment: { findFirst: async () => ({ shift: { startTime: '09:00', endTime: '18:00' }, employee: { accountCapabilities: [{ accountId: 'a' }] } }) }, taskCategory: { findFirst: async () => ({ name: 'Chats', accountId: 'a', defaultPriority: 1, account: { active: true, operatingWindows: windows } }) }, taskAssignment: { findUnique: async () => stored, upsert: async ({ update }) => { stored = update; return update; } } };
  const route = load('src/app/api/daily/tasks/route.ts', db, { '@/lib/validation': {...load('src/lib/validation.ts',{}),operationToday:()=> '2026-10-14'}, '@/lib/daily-plan': { changedPlan: async () => { version++; } } });
  const input = { date: '2026-10-14', employeeId: 'agent', categoryId: 'chat' };
  assert.equal((await route.POST(request(input))).status, 200);
  assert.equal(stored.startTime, '09:00'); assert.equal(stored.endTime, '18:00');
  await route.POST(request({ ...input, note: 'Updated note' }));
  assert.equal(stored.startTime, '09:00'); assert.equal(stored.note, 'Updated note');
  assert.equal((await route.POST(request({ ...input, startTime: '20:00', endTime: '21:00' }))).status, 400);
  assert.equal((await route.POST(request({ ...input, date: '2026-02-30' }))).status, 400);
  assert.equal(version, 2);
  console.log('PASS manual task defaults, note preservation, interval validation, valid dates, and revision updates');
}
async function leave() {
  let reopened = false, applied = false;
  const date = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
  const tx = { timeOff: { findMany: async () => [], deleteMany: async () => {}, createMany: async () => {} }, shiftAssignment: { findMany: async () => [{ schedulePeriodId: 'period', schedulePeriod: { year: 2026, month: 10, status: 'DRAFT' } }], updateMany: async () => { applied = true; } }, schedulePeriod: { updateMany: async () => { reopened = true; } }, employee: { update: async () => {} }, dayOffPreference: { deleteMany: async () => {} }, taskAssignment: { deleteMany: async () => {} }, breakSchedule: { deleteMany: async () => {} } };
  const db = { appSettings: { findUnique: async () => ({ timezone: 'UTC' }) }, $transaction: async fn => fn(tx) };
  const route = load('src/app/api/team/[id]/route.ts', db);
  const input = { name: 'Test Agent', slackId: null, isBilingual: false, preferredShiftId: null, daysOff: [], timeOff: [{ date, type: 'ANNUAL_LEAVE' }] };
  assert.equal((await route.PATCH(request(input), { params: Promise.resolve({ id: 'agent' }) })).status, 200);
  assert(reopened && applied);
  input.timeOff[0].date = '2020-01-01';
  assert.equal((await route.PATCH(request(input), { params: Promise.resolve({ id: 'agent' }) })).status, 409);
  console.log('PASS planned leave saves on an existing draft roster and past leave is protected');
}
function cover() {
  const { mainBreakCover } = load('src/lib/main-break-cover.ts', {});
  const workers = ['owner', 'cover'].map(employeeId => ({ employeeId, shift: { startTime: '09:00', endTime: '18:00' }, employee: { isBilingual: false } }));
  const account = { id: 'a', employeeCapabilities: [{ employeeId: 'owner' }], coverageRequirements: [{ dayOfWeek: 3, startTime: '09:00', endTime: '18:00', minimumBilingual: 0 }] };
  assert.equal(mainBreakCover('owner','13:00','13:40',3,workers,[],[account]),null);
  account.employeeCapabilities.push({ employeeId: 'cover' });
  assert.equal(mainBreakCover('owner','13:00','13:40',3,workers,[],[account]),'cover');
  assert.equal(mainBreakCover('owner','13:00','13:40',3,workers,[{ employeeId:'cover',startTime:'13:00',endTime:'13:20' }],[account]),null);
  account.coverageRequirements[0].minimumBilingual = 1;
  assert.equal(mainBreakCover('owner','13:00','13:40',3,workers,[],[account]),null);
  console.log('PASS main-break qualification, availability and configured language cover');
}
function clocksAndMessages() {
  const { sameRequestOrigin } = load('src/lib/auth/request-origin.ts',{});
  assert(sameRequestOrigin(new Request('http://localhost:3000/',{headers:{Host:'demo.internal.test',Origin:'http://demo.internal.test'}})));
  assert(!sameRequestOrigin(new Request('http://localhost:3000/',{headers:{Host:'demo.internal.test',Origin:'http://wrong-site.invalid'}})));
  const validation = load('src/lib/validation.ts', {});
  assert(!validation.clock.safeParse('25:99').success);
  assert(!validation.timezone.safeParse('invalid-zone').success);
  assert(validation.clock.safeParse('13:22').success);
  const { boundedBlocks } = load('src/lib/slack/blocks.ts', {});
  const blocks = boundedBlocks([{ type:'section',text:{type:'mrkdwn',text:Array(70).fill('A normal task description with some details.').join('\n')} }]);
  assert(blocks.length > 1); assert(blocks.every(b=>b.text.text.length <= 3000));
  console.log('PASS clock/timezone validation and Slack section size limits');
}
async function acknowledgements() {
  const handlers = {}; const records = new Map(); let updates = 0;
  const db = { appSettings: { findUnique: async () => ({}) }, employee: { findUnique: async () => ({ id:'agent',status:'ACTIVE' }) }, dailyPlan: { findUnique: async () => ({ revision:2 }) }, slackPostLog: { findFirst: async () => ({ planRevision:2 }) }, taskAssignment: { findMany: async () => [{ categoryId:'task1' },{ categoryId:'task2' }] }, acknowledgement: { upsert: async data => { updates++; const key=JSON.stringify(data.where); if(!records.has(key))records.set(key,{...data.create,acknowledgedAt:Date.now()}); assert.deepEqual(data.update,{}); } } };
  class Socket { on(name,fn){handlers[name]=fn;} async start(){} }
  const previousApp=process.env.SLACK_APP_TOKEN,previousBot=process.env.SLACK_BOT_TOKEN;
  process.env.SLACK_APP_TOKEN='isolated';process.env.SLACK_BOT_TOKEN='isolated';
  const app={prepare:async()=>{},getRequestHandler:()=>()=>{}};
  const req = name => name==='http'?{createServer:()=>({listen:()=>{}})}:name==='next'?()=>app:name==='node-cron'?{schedule:()=>{}}:name==='@prisma/client'?{PrismaClient:class { constructor(){return db;} }}:name==='@slack/socket-mode'?{SocketModeClient:Socket}:name==='dotenv'?{config:()=>{}}:require(name);
  new Function('require','console',fs.readFileSync(path.join(root,'server.js'),'utf8'))(req,{log:()=>{},error:()=>{}});
  await new Promise(resolve=>setImmediate(resolve));
  const event=revision=>({ack:async()=>{},body:{actions:[{action_id:'acknowledge_roster',value:`2026-10-14|${revision}`}],user:{id:'slack-agent'},message:{ts:'posted-message'}}});
  await handlers.interactive(event(1));assert.equal(updates,0);
  await handlers.interactive(event(2));const first=JSON.stringify([...records]);
  await handlers.interactive(event(2));assert.equal(JSON.stringify([...records]),first);assert.equal(records.size,2);
  if(previousApp===undefined)delete process.env.SLACK_APP_TOKEN;else process.env.SLACK_APP_TOKEN=previousApp;
  if(previousBot===undefined)delete process.env.SLACK_BOT_TOKEN;else process.env.SLACK_BOT_TOKEN=previousBot;
  console.log('PASS stale acknowledgement buttons are ignored and repeat clicks preserve first timestamps');
}
async function everyoneCoverage(weekday, loneAfternoon) {
  const date = new Date(Date.now()+86400000*7); while(date.getUTCDay() !== weekday)date.setUTCDate(date.getUTCDate()+1);
  const dateValue=date.toISOString().slice(0,10);
  const accounts=['Trade','HB'].map((name,i)=>({id:'account'+i,name,employeeCapabilities:['day','night'].map(employeeId=>({employeeId})),coverageRequirements:i===0?([0,6].includes(weekday)?[]:[{dayOfWeek:weekday,startTime:'09:00',endTime:'18:00',minimumBilingual:0}]):[{dayOfWeek:weekday,startTime:'09:00',endTime:'18:00',minimumBilingual:0},{dayOfWeek:weekday,startTime:'18:00',endTime:'22:00',minimumBilingual:0}]}));
  const categories=accounts.flatMap(a=>[{id:a.id+'calls',accountId:a.id,name:'Calls',mode:'EVERYONE',isLive:true,defaultPriority:1,rotationOrder:0},{id:a.id+'chats',accountId:a.id,name:'Chats',mode:'FOCUS',isLive:true,defaultPriority:1,rotationOrder:1}]);
  const roster=['day','night'].filter(id=>!loneAfternoon||id==='night').map(employeeId=>({employeeId,employee:{name:employeeId,isBilingual:false},shiftId:employeeId,shift:{name:employeeId,startTime:employeeId==='night'?'13:00':'09:00',endTime:employeeId==='night'?'22:00':'18:00',staffingRules:[]}}));
  let rows=[];
  const db={shiftAssignment:{findMany:async()=>roster},taskCategory:{findMany:async()=>categories},account:{findMany:async()=>accounts},taskAssignment:{findMany:async()=>[],count:async()=>0},rotationBaseline:{findMany:async()=>[]},breakSchedule:{count:async()=>0},appSettings:{upsert:async()=>({timezone:'UTC',weekStartsOn:1,mainBreakMinutes:0,shortBreakMinutes:0})},$transaction:async fn=>fn({taskAssignment:{createMany:async x=>{rows=x.data}},breakSchedule:{createMany:async()=>{}},dailyPlan:{upsert:async()=>{}}})};
  const route=load('src/app/api/daily/plan/route.ts',db,{'@/lib/daily-plan':{operationHash:async()=> 'fixture'}});
  const result=await route.POST(request({date:dateValue}));assert.equal(result.status,200,JSON.stringify(result));
  const calls=rows.filter(r=>r.categoryId.endsWith('calls'));assert(calls.every(r=>r.priority===1));
  assert(calls.some(r=>r.employeeId==='night'&&r.categoryId==='account1calls'&&r.startTime==='13:00'&&r.endTime==='22:00'));
  if(weekday!==6)assert(calls.some(r=>r.employeeId==='night'&&r.categoryId==='account0calls'&&r.startTime==='13:00'&&r.endTime==='18:00'));
  else assert(!calls.some(r=>r.categoryId==='account0calls'));
  assert.equal(new Set(rows.map(r=>r.employeeId+'|'+r.categoryId)).size,rows.length);
  console.log(`PASS ${weekday===6?'weekend':'weekday'} Everyone coverage${loneAfternoon?' with a lone afternoon shift':''}`);
}
async function breakExceptions() {
  let saved; let revision = 0;
  let workers = ['agent','cover'].map(employeeId=>({employeeId,shift:{startTime:'09:00',endTime:'18:00'},employee:{isBilingual:false}}));
  let breaks = [];
  const settings = {timezone:'UTC',mainBreakMinutes:40,shortBreakMinutes:20,shortBreakDelayMinutes:120,breakGapMinutes:10,maxConcurrentMainBreaks:2};
  const db = {shiftAssignment:{findMany:async()=>workers},breakSchedule:{findMany:async()=>breaks,upsert:async({create})=>(saved={id:'saved',...create}),update:async()=>{}},appSettings:{upsert:async()=>settings},account:{findMany:async()=>[]}};
  const route=load('src/app/api/daily/breaks/route.ts',db,{'@/lib/validation':{...load('src/lib/validation.ts',{}),operationToday:()=> '2026-10-14'},'@/lib/daily-plan':{changedPlan:async()=>revision++}});
  const input={date:'2026-10-16',employeeId:'agent',type:'MAIN',startTime:'12:30',endTime:'14:00'};
  assert.equal((await route.POST(request(input))).status,400);
  assert.equal((await route.POST(request({...input,allowDurationException:true}))).status,200);
  assert.equal(saved.durationException,true); assert.equal(settings.mainBreakMinutes,40);
  assert.equal((await route.POST(request({...input,endTime:'19:00',allowDurationException:true}))).status,400);
  breaks=[{employeeId:'agent',type:'SHORT',startTime:'13:30',endTime:'13:50'}];
  assert.equal((await route.POST(request({...input,allowDurationException:true}))).status,409);
  breaks=[]; workers=workers.slice(0,1);
  assert.equal((await route.POST(request({...input,allowDurationException:true}))).status,409);
  workers.push({employeeId:'cover',shift:{startTime:'09:00',endTime:'18:00'},employee:{isBilingual:false}});
  assert.equal((await route.POST(request({...input,endTime:'13:10'}))).status,200);
  assert.equal(saved.durationException,false); assert.equal(revision,2);
  console.log('PASS one-day break exceptions require explicit consent and preserve shift, overlap, coverage, and normal settings');
}
function scheduleFairness() {
  const {generateSchedule}=load('src/features/scheduling/engine/generate-schedule.ts',{});
  const employees=Array.from({length:6},(_,index)=>({id:'agent'+index,name:'Agent '+index,isBilingual:index<2,accountIds:['t','h'],preferredShiftId:null,dayOffPreferences:[],timeOff:[]}));
  const shifts=[{id:'day',name:'Day',startTime:'09:00',minimumByDay:{0:1,1:5,2:4,3:4,4:4,5:4,6:1},bilingualByDay:{},requiredAccountIdsByDay:{}},{id:'night',name:'Night',startTime:'13:00',minimumByDay:{0:1,1:1,2:1,3:1,4:1,5:1,6:1},bilingualByDay:{},requiredAccountIdsByDay:{}}];
  for(const weekStartsOn of [0,1]) {
    let previous=[];
    for(const [year,month] of [[2026,11],[2026,12],[2027,1]]) {
      const prior=Object.fromEntries(employees.map(e=>[e.id,previous.filter(a=>a.employeeId===e.id).slice(-7)]));
      const fairness=Object.fromEntries(employees.map(e=>[e.id,previous.filter(a=>a.employeeId===e.id)]));
      const snapshot=JSON.stringify(fairness);
      const result=generateSchedule({year,month,employees,shifts,maxConsecutiveDays:5,maxWeeklyDays:5,weekStartsOn,operatingDays:[0,1,2,3,4,5,6],variationSeed:12345,priorAssignments:prior,fairnessHistory:fairness});
      assert.equal(JSON.stringify(fairness),snapshot);assert.equal(result.warnings.filter(w=>w.severity==='critical').length,0);
      previous.push(...result.assignments);
      for(const employee of employees){let run=0;const weeks=new Map();for(const row of previous.filter(a=>a.employeeId===employee.id).sort((a,b)=>a.date.localeCompare(b.date))){run=row.status==='WORKING'?run+1:0;assert(run<=5);const date=new Date(row.date+'T12:00:00Z');date.setUTCDate(date.getUTCDate()-((date.getUTCDay()-weekStartsOn+7)%7));const week=date.toISOString().slice(0,10);weeks.set(week,(weeks.get(week)||0)+(row.status==='WORKING'?1:0));}assert([...weeks.values()].every(count=>count<=5));}
    }
    const weekendTotals=employees.map(e=>previous.filter(a=>a.employeeId===e.id&&a.status==='WORKING'&&[0,6].includes(new Date(a.date+'T12:00:00Z').getUTCDay())).length);
    // Regression baseline concentrated all 54 weekend assignments on two agents.
    // Fairness is a soft target; continuity can prevent an exact equal split.
    assert(weekendTotals.every(count=>count>0));
    assert(Math.max(...weekendTotals)-Math.min(...weekendTotals)<27,JSON.stringify({weekStartsOn,weekendTotals}));
  }
  console.log('PASS cross-month fairness with Sunday/Monday weeks preserves coverage, history and work limits');
}
(async () => { await tasks(); await leave(); cover(); await breakExceptions(); clocksAndMessages(); await acknowledgements(); await everyoneCoverage(3,false); await everyoneCoverage(6,false); await everyoneCoverage(3,true); scheduleFairness(); })().catch(error => { console.error(error); process.exitCode = 1; });
