import test from 'node:test';
import assert from 'node:assert/strict';
import {IdleSession,ADMIN_IDLE_MS} from './idle-session.js';

function fixture(shared={value:null}) {
  let time=1000000, expired=0, timerId=0;const timers=new Map();
  const tracker=new IdleSession({now:()=>time,read:()=>shared.value,write:v=>{shared.value=v},onExpire:()=>expired++,setTimer:(fn,delay)=>{timers.set(++timerId,{fn,at:time+delay});return timerId},clearTimer:id=>timers.delete(id)});
  return {tracker,shared,get expired(){return expired},setTime(t){time=t},get time(){return time},advance(ms){time+=ms},runTimers(){for(const[id,t]of [...timers])if(t.at<=time){timers.delete(id);t.fn()}}};
}
test('the configured timeout is exactly ten minutes',()=>assert.equal(ADMIN_IDLE_MS,600000));
test('default native timers keep the global receiver through start, activity and stop',t=>{
 const calls=[];
 t.mock.method(globalThis,'setTimeout',function(callback,delay){
  assert.equal(this,globalThis,'browser setTimeout requires its global receiver');
  calls.push(['set',delay]);return calls.length;
 });
 t.mock.method(globalThis,'clearTimeout',function(id){
  assert.equal(this,globalThis,'browser clearTimeout requires its global receiver');
  calls.push(['clear',id]);
 });
 try{
  const tracker=new IdleSession({now:()=>1000000});
  assert.equal(tracker.start('browser-session'),true);
  assert.equal(tracker.activity(),true);
  tracker.stop();
  assert.equal(tracker.running,false);
  assert.deepEqual(calls,[['set',600000],['clear',1],['set',600000],['clear',3]]);
 }finally{t.mock.restoreAll()}
});
test('active before600000ms, expired at600000ms and cannot revive with click',()=>{
 const f=fixture();f.tracker.start('a');f.advance(599999);assert.equal(f.tracker.check(),true);f.advance(1);assert.equal(f.tracker.activity(),false);assert.equal(f.expired,1);assert.equal(f.tracker.running,false);assert.equal(f.tracker.activity(),false);
});
test('genuine activity resets the deadline',()=>{
 const f=fixture();f.tracker.start('a');f.advance(500000);assert.equal(f.tracker.activity(),true);f.advance(599999);assert.equal(f.tracker.check(),true);f.advance(1);assert.equal(f.tracker.check(),false);
});
test('sleeping/background tab checks wall clock before resume can refresh it',()=>{
 const f=fixture();f.tracker.start('a');f.advance(3600000);assert.equal(f.tracker.activity(),false);assert.equal(f.expired,1);
});
test('timer expiry locks even without additional UI events',()=>{
 const f=fixture();f.tracker.start('a');f.advance(600000);f.runTimers();assert.equal(f.expired,1);
});
test('same-session tab activity is shared, other session IDs are ignored',()=>{
 const shared={value:null},a=fixture(shared),b=fixture(shared);a.tracker.start('same');b.tracker.start('same');a.advance(550000);b.advance(550000);a.tracker.activity();b.advance(100000);assert.equal(b.tracker.check(),true);shared.value={sid:'other',at:b.time};b.advance(500000);assert.equal(b.tracker.check(),false);
});
test('reload restores the previous timestamp and does not reset inactivity',()=>{
 const f=fixture();const old=f.time-599999;assert.equal(f.tracker.start('a',old),true);f.advance(1);assert.equal(f.tracker.check(),false);
});
test('restoring an expired session and moving a clock backwards both fail closed',()=>{
 const f=fixture();assert.equal(f.tracker.start('a',f.time-600000),false);const g=fixture();g.tracker.start('b');g.setTime(g.time-6000);assert.equal(g.tracker.check(),false);
});
