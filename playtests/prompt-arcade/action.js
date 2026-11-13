const W=400,H=470;
const clamp=(n,min,max)=>Math.max(min,Math.min(max,n));

function game(root,restart,{draw,step,input,controls=[],help}) {
  const stats=document.createElement('div');
  stats.className='stats';
  const canvas=document.createElement('canvas');
  canvas.width=W;
  canvas.height=H;
  canvas.setAttribute('aria-label',help);
  const ctx=canvas.getContext('2d');
  const actions=document.createElement('div');
  actions.className='controls';
  const feedback=document.createElement('p');
  feedback.className='feedback';
  feedback.setAttribute('role','status');
  for(const [label,action] of controls) {
    const btn=document.createElement('button');
    btn.textContent=label;
    btn.onclick=()=>input(action);
    actions.append(btn);
  }
  root.append(stats,canvas,actions,feedback);
  let done=false,handle,last;
  const finish=message=>{
    if(done) return;
    done=true;
    feedback.textContent=message;
    for(const item of actions.children) item.disabled=true;
    const again=document.createElement('button');
    again.textContent='Play again';
    again.className='primary';
    again.onclick=restart;
    root.append(again);
  };
  function frame(time) {
    const dt=last===undefined?0:Math.min(.04,(time-last)/1000);
    last=time;
    if(!done) step(dt,finish,stats);
    draw(ctx);
    if(!done) handle=requestAnimationFrame(frame);
  }
  const point=e=>{
    const box=canvas.getBoundingClientRect();
    const scale=Math.min(box.width/W,box.height/H);
    return [(e.clientX-box.left-(box.width-W*scale)/2)/scale,(e.clientY-box.top-(box.height-H*scale)/2)/scale];
  };
  for(const phase of ['down','move','up','cancel']) canvas.addEventListener('pointer'+phase,e=>{
    if(done) return;
    if(phase==='down') canvas.setPointerCapture(e.pointerId);
    input(phase,point(e));
  });
  const keys={ArrowLeft:'left',ArrowRight:'right',ArrowUp:'up',ArrowDown:'down',' ':'up'};
  const onKey=e=>{
    const action=keys[e.key];
    if(done||!action||e.repeat||(e.target.tagName==='BUTTON'&&e.key===' '))return;
    e.preventDefault();
    input(action);
  };
  window.addEventListener('keydown',onKey);
  handle=requestAnimationFrame(frame);
  return ()=>{
    window.removeEventListener('keydown',onKey);
    cancelAnimationFrame(handle);
  };
}
const rect=(ctx,color,x,y,w,h)=>{ctx.fillStyle=color;ctx.fillRect(x,y,w,h);};
function label(ctx,text,x,y,color='#fff',size=16,align='center') {
  ctx.fillStyle=color;
  ctx.font='bold '+size+'px system-ui';
  ctx.textAlign=align;
  ctx.fillText(text,x,y);
}
function cat(ctx,x,y,angle=0,scale=1) {
  ctx.save();
  ctx.translate(x,y);
  ctx.rotate(angle);
  ctx.scale(scale,scale);
  ctx.fillStyle='#f4a95c';
  ctx.beginPath();
  ctx.ellipse(0,2,17,14,0,0,Math.PI*2);
  ctx.fill();
  for(const sign of [-1,1]) {
    ctx.beginPath();
    ctx.moveTo(sign*4,-7);
    ctx.lineTo(sign*12,-19);
    ctx.lineTo(sign*15,-5);
    ctx.fill();
    rect(ctx,'#39283b',sign*6-1,-1,2,4);
  }
  rect(ctx,'#a44b65',-2,5,4,3);
  ctx.restore();
}
function sahur(ctx,x,y) {
  rect(ctx,'#3a2021',x-16,y-18,32,38);
  rect(ctx,'#ae693f',x-12,y-15,24,31);
  rect(ctx,'#e39a58',x-9,y-13,4,24);
  rect(ctx,'#281b29',x-7,y-5,4,5);
  rect(ctx,'#281b29',x+4,y-5,4,5);
  rect(ctx,'#f4c891',x-4,y+6,10,3);
  rect(ctx,'#493044',x-12,y+17,8,8);
  rect(ctx,'#493044',x+4,y+17,8,8);
}
function cappuccino(ctx,x,y) {
  rect(ctx,'#d6d7f4',x-10,y-9,23,15);
  rect(ctx,'#47314c',x-13,y-11,26,5);
  rect(ctx,'#4c3756',x-12,y+5,24,14);
  rect(ctx,'#eb6482',x-12,y+8,24,3);
}
export function runner(root,restart) {
  const lanes=[102,200,298];
  let lane=1,x=200,t=0,spawn=.6,started=false,gesture,score=0,objects=[],sequence=0;
  const pattern=[[0],[1],[2],[0,1],[2],[1,2],[0],[0,2],[1]];
  return game(root,restart,{
    controls:[['← Left','left'],['Start','up'],['Right →','right']],
    help:'Three-lane subway runner',
    input(action,point) {
      if(action==='down'){gesture=point;return;}
      if(action==='up'&&point) {
        if(!gesture)return;
        const shift=point[0]-gesture[0];
        gesture=null;
        if(Math.abs(shift)>22)action=shift>0?'right':'left';
        else if(point[0]<W/3)action='left';
        else if(point[0]>W*2/3)action='right';
      }
      if(action==='cancel'){gesture=null;return;}
      if(!['left','right','up'].includes(action))return;
      started=true;
      lane=clamp(lane+(action==='left'?-1:action==='right'?1:0),0,2);
    },
    step(dt,finish,stats) {
      stats.textContent=Math.floor(score)+' m · Escape at 600 m';
      if(!started)return;
      t+=dt;
      score+=dt*25;
      x+=(lanes[lane]-x)*Math.min(1,dt*16);
      spawn-=dt;
      if(spawn<=0){
        const blocked=pattern[sequence++%pattern.length];
        for(const target of blocked) objects.push({x:lanes[target],y:-30});
        spawn=Math.max(.71,1.23-t*.02);
      }
      for(const block of objects) {
        block.y+=dt*(185+t*4);
        if(Math.abs(x-block.x)<32&&Math.abs(361-block.y)<27) {
          finish('Cappuccino Assassino caught you at '+Math.floor(score)+' m.');
          return;
        }
      }
      objects=objects.filter(block=>block.y<H+40);
      if(score>=600)finish('You made it out of the subway.');
    },
    draw(ctx) {
      rect(ctx,'#211c33',0,0,W,H);
      for(const [x,color] of [[14,'#4a2f4a'],[343,'#5b3151']]) {
        rect(ctx,color,x,0,43,H);
        for(let y=-50+(t*98)%81;y<H;y+=81) {
          rect(ctx,'#2e213b',x+4,y,35,64);
          rect(ctx,'#ff9a61',x+13,y+8,16,5);
        }
      }
      for(const x of lanes) {
        rect(ctx,'#292b3e',x-43,0,86,H);
        for(let y=-35+(t*150)%35;y<H;y+=35)rect(ctx,'#3b3a4d',x-37,y,74,5);
        for(const rail of [-31,27])rect(ctx,'#798096',x+rail,0,4,H);
      }
      for(const {x,y} of objects) {
        rect(ctx,'#793b61',x-27,y-13,54,29);
        rect(ctx,'#ffbd69',x-26,y-10,52,9);
        for(let p=-22;p<=18;p+=13)rect(ctx,'#332541',x+p,y-10,6,9);
      }
      cappuccino(ctx,x+(lanes[1]-x)*.28,421);
      sahur(ctx,x,361+Math.sin(t*20)*2);
      if(!started) {
        rect(ctx,'#19182cf2',24,150,352,115);
        label(ctx,'Night Market Metro',200,194,'#ffd587',24);
        label(ctx,'Tap Start or swipe to run',200,229);
      }
    }
  });
}

export function crossing(root,restart) {
  const tile=55, lanes=6;
  let col=3,row=0,displayX=200,displayY=433,rotation=0,t=0,started=false,gesture,hopCooldown=0;
  const traffic=Array.from({length:lanes},(_,i)=>({speed:(i%2?1:-1)*(53+i*9),gap:i%2?173:210,offset:20+93*i,color:['#ee9b55','#68b2c6','#db6c81'][i%3]}));
  const yFor=r=>433-tile*r;
  const xFor=c=>35+c*55;
  function vehicles(road) {
    const start=((road.offset+road.speed*t)%road.gap+road.gap)%road.gap;
    return Array.from({length:5},(_,i)=>start+(i-1)*road.gap);
  }
  return game(root,restart,{
    controls:[['←','left'],['↑ Hop','up'],['↓','down'],['→','right']],
    help:'Hop a spinning cat between rows of traffic',
    input(action,point) {
      if(action==='down'&&point){gesture=point;return;}
      if(action==='cancel'){gesture=null;return;}
      if(action==='up'&&point){
        if(!gesture)return;
        const dx=point[0]-gesture[0],dy=point[1]-gesture[1];
        gesture=null;
        if(Math.max(Math.abs(dx),Math.abs(dy))>17)action=Math.abs(dx)>Math.abs(dy)?(dx<0?'left':'right'):(dy<0?'up':'down');
      }
      if(!['left','right','up','down'].includes(action)||hopCooldown>0)return;
      started=true;
      hopCooldown=.17;
      col=clamp(col+(action==='left'?-1:action==='right'?1:0),0,6);
      row=clamp(row+(action==='up'?1:action==='down'?-1:0),0,7);
      rotation+=Math.PI*2;
    },
    step(dt,finish,stats) {
      if(started)t+=dt;
      hopCooldown=Math.max(0,hopCooldown-dt);
      displayX+=(xFor(col)-displayX)*Math.min(1,dt*17);
      displayY+=(yFor(row)-displayY)*Math.min(1,dt*17);
      stats.textContent=Math.min(row,6)+' / 6 roads crossed';
      if(row===7){displayY=yFor(7);finish('You reached the far sidewalk.');}
      const road=traffic[row-1];
      if(road&&Math.abs(displayY-yFor(row))<19&&vehicles(road).some(x=>Math.abs(x-displayX)<33))finish('Traffic got you. Try timing the next gap.');
    },
    draw(ctx) {
      rect(ctx,'#36504c',0,0,W,H);
      for(let i=0;i<lanes;i++){
        const y=yFor(i+1), road=traffic[i];
        rect(ctx,i%2?'#333c4a':'#2c3543',0,y-tile/2,W,tile);
        for(let x=5;x<W;x+=35)rect(ctx,'#687078',x,y+tile/2-2,16,2);
        for(const x of vehicles(road)) {
          rect(ctx,'#212b3a',x-27,y-13,54,29);
          rect(ctx,road.color,x-25,y-12,50,23);
          rect(ctx,'#2f475b',x-8,y-10,16,19);
          rect(ctx,'#f6d69f',x+(road.speed>0?19:-25),y-8,6,7);
        }
      }
      label(ctx,'SAFE SIDEWALK',200,23,'#cce3b8',13);
      const angle=rotation+Math.sin(t*7)*.08+(displayY-yFor(row))*.13+(displayX-xFor(col))*.13;
      cat(ctx,displayX,displayY,angle,1.12);
      if(!started)label(ctx,'Tap ↑ Hop to cross',200,392,'#ffe6a5');
    }
  });
}

export function cats(root,restart) {
  const sling=[66,340], ground=418, deck=317, gravity=490;
  let shot=null, aim=null, shots=5, flying=0, time=0, quiet=0;
  const boxes=[
    {x:280,y:deck-16},{x:314,y:deck-16},{x:348,y:deck-16},
    {x:297,y:deck-48},{x:331,y:deck-48},{x:314,y:deck-80}
  ].map(box=>({...box,vx:0,vy:0,angle:0,spin:0,loose:false,off:false}));
  const trajectory=point=>{
    const dx=clamp(sling[0]-point[0],0,60);
    const dy=clamp(sling[1]-point[1],-86,16);
    return [dx*8,dy*6];
  };
  const launch=point=>{
    const [vx,vy]=trajectory(point);
    if(vx<60)return;
    shots--;
    shot={x:sling[0],y:sling[1],vx,vy};
    flying=0;
  };
  return game(root,restart,{
    controls:[['Low shot','left'],['Mid shot','up'],['High shot','right']],
    help:'Slingshot and cardboard tower. Drag the cat left and down then release.',
    input(action,point) {
      if(shot||quiet>0||shots===0)return;
      if(action==='left')launch([15,367]);
      if(action==='up'&&!point)launch([15,392]);
      if(action==='right')launch([15,399]);
      if(action==='down'&&point&&Math.hypot(point[0]-sling[0],point[1]-sling[1])<45)aim=point;
      if(action==='move'&&aim)aim=point;
      if(action==='cancel')aim=null;
      if(action==='up'&&point&&aim){aim=null;launch(point);}
    },
    step(dt,finish,stats) {
      time+=dt;
      const cleared=boxes.filter(b=>b.off).length;
      stats.textContent=shots+' shots left · '+cleared+'/'+boxes.length+' boxes knocked down';
      if(cleared===boxes.length){finish('Tower cleared!');return;}
      if(shot) {
        flying+=dt;
        shot.vy+=gravity*dt;
        shot.x+=shot.vx*dt;
        shot.y+=shot.vy*dt;
        for(const box of boxes) {
          if(!box.off&&!box.loose&&Math.abs(shot.x-box.x)<26&&Math.abs(shot.y-box.y)<25) {
            box.loose=true;
            box.vx=Math.max(60,shot.vx*.54);
            box.vy=-100;
            box.spin=4;
            shot.vx*=.63;
            shot.vy-=30;
          }
        }
        if(shot.y>=ground||shot.x>W+32||flying>3){shot=null;quiet=.45;}
      }
      for(const box of boxes) {
        if(box.off||!box.loose)continue;
        box.vy+=gravity*dt;
        box.y+=box.vy*dt;
        box.x+=box.vx*dt;
        box.angle+=box.spin*dt;
        for(const other of boxes) if(other!==box&&!other.off&&!other.loose&&Math.abs(other.x-box.x)<31&&Math.abs(other.y-box.y)<32) {
          other.loose=true;
          other.vx=Math.max(63,box.vx*.68);
          other.vy=-72;
          other.spin=3.2;
        }
        if(box.x>W+20||box.y>=ground-16)box.off=true;
      }
      quiet=Math.max(0,quiet-dt);
      if(!shots&&!shot&&!quiet&&!boxes.some(b=>b.loose&&!b.off))finish('You knocked down '+cleared+' of '+boxes.length+' boxes.');
    },
    draw(ctx) {
      rect(ctx,'#3a3147',0,0,W,H);
      for(let i=0;i<4;i++) {
        rect(ctx,'#48415b',18+103*i,53,65,134);
        rect(ctx,'#55496b',24+103*i,58,54,122);
      }
      rect(ctx,'#67535e',0,ground,W,H-ground);
      rect(ctx,'#bc835e',249,deck,139,10);
      rect(ctx,'#6d5460',263,deck+10,10,ground-deck-10);
      rect(ctx,'#6d5460',367,deck+10,10,ground-deck-10);
      for(const b of boxes) {
        if(b.off)continue;
        ctx.save();ctx.translate(b.x,b.y);ctx.rotate(b.angle);
        rect(ctx,'#442c42',-16,-16,32,32);
        rect(ctx,'#ce9e67',-15,-15,30,30);
        rect(ctx,'#f3c88a',-3,-15,6,13);
        rect(ctx,'#906544',4,6,7,4);
        ctx.restore();
      }
      rect(ctx,'#c58960',sling[0]-5,sling[1]-5,10,75);
      if(aim) {
        const [vx,vy]=trajectory(aim);
        for(let i=1;i<=13;i++) {
          const d=i*.065;
          rect(ctx,'#ffdc89',sling[0]+vx*d-2,sling[1]+vy*d+.5*gravity*d*d-2,4,4);
        }
        ctx.strokeStyle='#f6b191';
        ctx.lineWidth=3;
        ctx.beginPath();ctx.moveTo(...sling);ctx.lineTo(...aim);ctx.stroke();
      }
      if(shot)cat(ctx,shot.x,shot.y,time*9);
      else if(shots)cat(ctx,...(aim??sling));
    }
  });
}
