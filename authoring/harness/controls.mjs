// Reference games for art review when a generated build fails the gameplay checks.
const variable = (type, init) => ({ type, init: String(init) });
const set = (name, to) => ({ set: name, to: String(to) });
const rect = (x,y,w,h,fill) => ({node:'rect',x,y,w,h,fill,radius:8});
const text = (value,x,y,size=20) => ({node:'text',text:value,x,y,size,anchor:'center',color:'#F5EDD7'});
const circle = (x,y,r,fill) => ({node:'circle',x,y,r,fill});
const tap = (node,input,withPayload={}) => ({...node,on_tap:{input,with:withPayload}});
const incr = (name,by=1) => ({incr:name,by:String(by)});
const when = (condition,then,otherwise) => ({if:condition,then,...(otherwise?{else:otherwise}:{})});
const rule = (id,on,actions) => ({id,on,do:actions});

export function referenceGame(id) {
  const title = {grove:'Glow Grove',signal:'Signal Forge',harbor:'Harbor Run'}[id];
  if (!title) return;
  const root = {node:'group',children:[text(title,180,48,27)]};
  const game = {
    format:'microgame/0.1',meta:{title,seed:1},state:{},inputs:{},rules:[],objectives:{},
    presentation:{canvas:{w:360,h:640,background:'#171F30'},root}
  };
  const children = root.children;
  if (id === 'grove') {
    game.meta.instructions='Tap where the moth should go. Collect three lights and reach the arch.';
    game.state = Object.fromEntries(Object.entries({px:60,py:520,tx:60,ty:520}).map(([name,v])=>[name,variable('float',v+'.0')]));
    game.state.count=variable('int',0);
    game.inputs.seek={payload:{x:'float',y:'float'}};
    game.rules.push(rule('seek','seek',[set('tx','event.x'),set('ty','event.y')]));
    const near = (x,y,r) => 'dist(vec(px, py), vec('+x+'.0, '+y+'.0)) <= '+r+'.0';
    const wall = (x,y) => '('+x+' >= 120.0 and '+x+' <= 240.0 and '+y+' >= 330.0 and '+y+' <= 370.0)';
    const move = [
      {let:{dx:'tx - px',dy:'ty - py',length:'max(0.001, dist(vec(px, py), vec(tx, ty)))'}},
      {let:{nx:'px + dx / length * min(3.0, length)',ny:'py + dy / length * min(3.0, length)'}},
      when('not '+wall('nx','ny'),[set('px','nx'),set('py','ny')]),
    ];
    children.push(tap(rect(0,104,360,536,'#00000000'),'seek',{x:'pointer.x',y:'pointer.y'}));
    children.push(rect(120,330,120,40,'#714C67'),circle(290,195,25,'#59728D'));
    children.push(text('EXIT',290,195,12),text("= 'Lights ' + str(count) + '/3'",180,82,16));
    for (const [index,[x,y]] of [[60,430],[300,415],[300,245]].entries()) {
      const name='light_'+index;
      game.state[name]=variable('bool',false);
      move.push(when('not '+name+' and '+near(x,y,20),[set(name,'true'),incr('count')]));
      children.push({...circle(x,y,10,'#FFDC83'),visible:'= not '+name});
    }
    children.push(circle('= px','= py',13,'#E6DAF4'));
    game.rules.push(rule('walk','tick',move));
    game.objectives={score:'count',win:'count == 3 and '+near(290,195,24),time_limit:'45s',on_timeout:'lose'};
  } else if (id === 'signal') {
    game.meta.instructions='Tap Strike when the moving pulse crosses the center.';
    game.state={hits:variable('int',0),misses:variable('int',0),target:variable('int',2000)};
    game.inputs.strike={payload:{}};
    game.rules.push(rule('strike','strike',[
      when('abs(now - target) <= 150',[incr('hits')],[incr('misses')]),incr('target',2000)
    ]));
    children.push(text("= str(hits) + ' hits     ' + str(misses) + ' misses'",180,83,16),
      rect(40,304,280,20,'#303A5F'),rect(169.5,296,21,36,'#D98748'),
      circle('= clamp(180.0 + (now - target) * 0.07, 44.0, 316.0)',314,9,'#FFE38D'),
      tap(rect(105,450,150,60,'#8B502D'),'strike'),text('STRIKE',180,480));
    game.objectives={score:'hits',win:'hits >= 3',lose:'misses >= 2',time_limit:'20s',on_timeout:'lose'};
  } else {
    game.meta.instructions='Budget fuel and time. Choose your route, then dock.';
    game.state={stage:variable('int',0),fuel:variable('int',2),time_left:variable('int',5)};
    game.inputs.choose={payload:{choice:'int'}};
    game.rules.push(rule('choose','choose',[
      when('stage == 0',[when('event.choice == 0',[incr('fuel',-1),incr('time_left',-1)],[incr('time_left',-2)])],
        [when('stage == 1',[when('event.choice == 0',[incr('fuel',-1),incr('time_left',-1)],[incr('time_left',-3)])],
          [incr('fuel',-1),incr('time_left',-1)])]),
      incr('stage')
    ]));
    children.push(text("= 'Fuel ' + str(fuel) + '     Time ' + str(time_left)",180,83,17),
      text("= if stage == 0 then 'Choose your route' else if stage == 1 then 'Cross the harbor' else 'Reach the dock'",180,270,21),
      tap(rect(45,353,270,64,'#274C5B'),'choose',{choice:'0'}),
      text("= if stage == 0 then 'Shoals · 1 fuel, 1 time' else if stage == 1 then 'Engine · 1 fuel, 1 time' else 'Dock · 1 fuel, 1 time'",180,385,17),
      {...tap(rect(45,433,270,64,'#274C5B'),'choose',{choice:'1'}),visible:'= stage < 2'},
      {...text("= if stage == 0 then 'Channel · 2 time' else 'Drift · 3 time'",180,465,17),visible:'= stage < 2'});
    game.objectives={score:'stage',win:'stage >= 3 and fuel >= 0 and time_left >= 0',lose:'fuel < 0 or time_left < 0'};
  }
  return game;
}
