import assert from 'node:assert/strict';

const boardStart = [false,true,false,true,true,true,false,true,false];
const dt = 1000 / 60;

export function runChecks(engine, game, id) {
  const tests = [];
  function test(name, verify) {
    const session = engine.load(JSON.stringify(game), 1);
    let tick = 0;
    const replay = [];
    function step(count = 1) {
      for (let i = 0; i < count && session.phase() === 'playing'; i++) {
        session.step(dt);
        tick++;
      }
    }
    function until(ms) {
      while (session.status().time_ms < ms && session.phase() === 'playing') step();
      assert.equal(session.status().time_ms, ms);
    }
    function tap(x, y, caption, steps = 1) {
      session.frame();
      replay.push({ tick, x, y, caption });
      session.pointer('down', x, y);
      session.pointer('up', x, y);
      step(steps);
    }
    try {
      verify({ session, step, until, tap, state: () => session.state(), phase: () => session.phase() });
      tests.push({ name, passed: true, replay, final: session.status() });
    } catch (error) {
      tests.push({ name, passed: false, error: error.message });
    } finally {
      session.dispose();
    }
  }
  if (id === 'grove') {
    test('Move and block at the wall', ({ tap, state }) => {
      tap(180, 425, 'Move to the wall approach', 150);
      assert.ok(Math.abs(state().px - 180) < 8, 'did not move to wall approach');
      tap(180, 267, 'The wall blocks a straight path', 165);
      assert.ok(state().py >= 367 && state().py <= 401, 'did not stop at the wall');
    });
    test('A pickup counts once', ({ tap, state }) => {
      tap(60,430,'Collect one light',120);
      assert.equal(state().count,1);
      tap(60,520,'Leave the pickup',120);
      tap(60,430,'Revisit the pickup',120);
      assert.equal(state().count,1);
    });
    test('Only three lights unlock the exit', ({ tap, state, phase }) => {
      tap(295,515,'Go around the garden wall',180);
      tap(290,195,'Try the exit early',240);
      assert.equal(phase(),'playing');
      assert.ok(state().count<3);
      tap(295,480,'Return for the missing light',240);
      tap(60,480,'Cross below the wall',170);
      tap(60,430,'Collect the west light',100);
      assert.equal(state().count,3);
      tap(60,227,'Circle the wall on the west',165);
      tap(290,195,'All three lights unlock the exit',180);
      assert.equal(phase(),'won');
    });
  }
  if (id === 'signal') {
    test('Inclusive window edges and center', ({ until, tap, state, phase }) => {
      // The runtime evaluates a queued tap at the next simulation step.
      for (const [index,ms] of [1833,3983,6133].entries()) {
        until(ms);
        tap(180,480,['Early edge: −150 ms','Center: on time','Late edge: +150 ms'][index]);
        assert.equal(state().hits,index+1);
      }
      assert.equal(phase(),'won');
    });
    test('Outside the window misses on both sides', ({ until,tap,state,phase }) => {
      until(1816);tap(180,480,'Too early');assert.equal(state().misses,1);
      until(4150);tap(180,480,'Too late');assert.equal(state().misses,2);
      assert.equal(phase(),'lost');
    });
    test('No input expires', ({ step,phase }) => {step(1210);assert.equal(phase(),'lost');});
  }
  if (id === 'prism') {
    const cell = (tap,i) => tap(100+80*(i%3),260+80*Math.floor(i/3),'Tap window '+(i+1),22);
    test('A corner flips exactly three cells', ({tap,state}) => {
      assert.deepEqual(state().board.cells,boardStart);
      cell(tap,0);
      assert.deepEqual(state().board.cells,boardStart.map((v,i)=>[0,1,3].includes(i)?!v:v));
      assert.equal(state().moves,1);
    });
    test('The fourth legal move can win', ({tap,state,phase}) => {
      for(const i of [0,2,6,8])cell(tap,i);
      assert.equal(state().moves,4);
      assert.equal(phase(),'won');
    });
    test('Four unsolved moves lose', ({tap,phase}) => {
      for(let i=0;i<4;i++)cell(tap,4);
      assert.equal(phase(),'lost');
    });
  }
  if (id === 'harbor') {
    for (const [name, route, expected, fuel, time] of [
      ['Shoals and drift win',[0,1],'won',0,0],['Channel and engine win',[1,0],'won',0,1],
      ['Shoals and engine run out of fuel',[0,0],'lost',-1,2],['Channel and drift run out of time',[1,1],'lost',1,-1],
    ]) {
      test(name, ({tap,step,state,phase}) => {
        step(180);
        assert.equal(state().time_left,5,'reading must not consume time');
        for (const [stage,choice] of [...route,0].entries()) {
          tap(180,385+80*choice,stage===2?'Dock':stage===0?['Take the shoals','Take the channel'][choice]:['Use the engine','Drift'][choice],105);
        }
        assert.equal(phase(),expected);
        assert.equal(state().fuel,fuel);
        assert.equal(state().time_left,time);
      });
    }
  }
  if (id === 'relay') {
    test('Turn alternation, individual scores and a win', ({tap,state,phase}) => {
      for(const [i,x] of [106,254,106,106].entries()){
        tap(x,340,'Player '+(i%2+1)+' throws',30);
        assert.equal(state().throws,i+1);
        if(i<3)assert.equal(state().player,(i+1)%2+1);
      }
      assert.equal(state().p1,4);assert.equal(state().p2,3);assert.equal(phase(),'won');
    });
    test('A tap outside the lanterns is ignored', ({tap,state}) => {
      tap(180,500,'Tap outside both targets',30);
      assert.equal(state().throws,0);assert.equal(state().player,1);
    });
    test('Four low throws lose', ({tap,state,phase}) => {
      for(let i=0;i<4;i++)tap(254,340,'Blue lantern: one point',30);
      assert.equal(state().p1,2);assert.equal(state().p2,2);assert.equal(phase(),'lost');
    });
  }
  return tests;
}
