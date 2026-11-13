const make = (tag,text = '',className = '') => {
  const node = document.createElement(tag);
  node.textContent = text;
  node.className = className;
  return node;
};
const button = (text,action,className = '') => {
  const node = make('button',text,className);
  node.type = 'button';
  node.onclick = action;
  return node;
};
const end = (root,title,detail,restart) => root.replaceChildren(
  make('h2',title),make('p',detail),button('Play again',restart,'primary')
);

export function leia(root,restart) {
  const rooms = {
    cell: ['▥','Detention Block AA-23','Your cell door opens during a power flicker. A patrol is approaching. A maintenance droid rolls past the lift.',[['Follow the maintenance droid','service'],['Take the lift to the hangar','checkpoint'],['Ambush the patrol','patrol']]],
    patrol: ['⚠','Stolen comlink','You stun the lead trooper and take his comlink. Over it, an officer asks for a clearance code.',[['Imitate an officer and send the patrol away','service'],['Give the trooper’s serial number as clearance','captured']]],
    service: ['◫','Service crawlspace','A map shows two paths. The control room has a hangar override. A chute leads under the checkpoint.',[['Cut power to the tractor beam','control'],['Slide down the chute','chute']]],
    checkpoint: ['⚑','Imperial checkpoint','The lift opens onto a scanner. A trooper asks for identification while a cargo sled approaches.',[['Slip under the cargo sled','chute'],['Present the prisoner wristband','captured']]],
    control: ['⌁','Tractor beam controls','You disable the beam and recover a backup of the Death Star plans. Two ships are within reach.',[['Board the cargo shuttle','full'],['Steal a TIE fighter','fighter']]],
    chute: ['▤','Hangar underpass','You reach the hangar. A small maintenance pod can slip out through the waste port. The shuttle sits in the tractor beam’s path.',[['Use the maintenance pod','pod'],['Take the cargo shuttle','captured']]],
    fighter: ['◈','TIE fighter cockpit','The hangar controller demands a flight code. The open waste port is too narrow for the fighter.',[['Fly out with the returning patrol','full'],['Fire at the hangar doors','captured']]],
  };
  const endings = {
    full:['Escape with the plans','You jump clear of the Death Star and transmit the recovered plans to the Rebel fleet.'],
    pod:['Escape in the maintenance pod','You reach a Rebel pickup point. The backup plans are still in the control room.'],
    captured:['Captured','The blast doors close and stormtroopers surround you. A different route could get you out.'],
  };
  function show(id) {
    if (endings[id]) return end(root,...endings[id],restart);
    const [art,title,story,choices] = rooms[id];
    const list = make('div','','choices');
    for (const [label,next] of choices) list.append(button(label,() => show(next)));
    root.replaceChildren(make('div',art,'banner'),make('h2',title),make('p',story),list);
  }
  show('cell');
}

function quiz(root,restart,{questions,host,map}) {
  let index=0, score=0;
  function show() {
    if (index === questions.length) return end(root,'Round complete',score+' of '+questions.length+' correct',restart);
    const [prompt,choices,correct,detail,location] = questions[index];
    const status=make('div','Question '+(index+1)+' of '+questions.length+' · '+score+' correct','stats');
    const list=make('div','','choices');
    const feedback=make('p','','feedback');
    feedback.setAttribute('role','status');
    for (const choice of choices) list.append(button(choice,() => {
      score += Number(choice === correct);
      for (const item of list.children) item.disabled=true;
      feedback.textContent=(choice === correct ? 'Correct. ' : 'Answer: '+correct+'. ')+detail;
      root.append(button(index+1===questions.length?'See score':'Next question',() => {index++;show();},'primary'));
    }));
    root.replaceChildren(status);
    if (host) root.append(make('div','🎙️ '+host,'banner'));
    if (map) root.append(map(location));
    root.append(make('h2',prompt),list,feedback);
  }
  show();
}

export function brainrot(root,restart) {
  quiz(root,restart,{host:'Mr. Beast',questions:[
    ['Which character is a wooden night watchman with a bat?',['Brr Brr Patapim','Tung Tung Tung Sahur','Bombardiro Crocodilo'],'Tung Tung Tung Sahur','Its repeated name imitates a knocking sound.'],
    ['Who is the ninja with a coffee cup for a head?',['Cappuccino Assassino','Tralalero Tralala','Lirili Larila'],'Cappuccino Assassino','The cup carries swords.'],
    ['Who is usually pictured as a shark wearing sneakers?',['Ballerina Cappuccina','Tralalero Tralala','Tung Tung Tung Sahur'],'Tralalero Tralala','Look for the blue shoes.'],
    ['Which character mixes a crocodile with an aircraft?',['Bombardiro Crocodilo','Lirili Larila','Brr Brr Patapim'],'Bombardiro Crocodilo','The crocodile head sits at the front of the plane.'],
    ['Who pairs ballet with a cappuccino head?',['Cappuccino Assassino','Ballerina Cappuccina','Tralalero Tralala'],'Ballerina Cappuccina','Her tutu and pointe shoes give it away.'],
    ['Which two belong in the coffee-themed matchup?',['Patapim and Tralalero','Sahur and Crocodilo','Cappuccina and Assassino'],'Cappuccina and Assassino','A dancer and an assassin, both served in cups.'],
  ]});
}

const mythRounds = [
  ['Name one of the original twelve Titans.',[[25,'Cronus','Kronos'],[30,'Rhea'],[45,'Oceanus','Okeanos'],[50,'Tethys'],[55,'Hyperion'],[60,'Theia','Thea'],[65,'Iapetus'],[70,'Mnemosyne'],[75,'Themis'],[80,'Coeus','Koios'],[85,'Phoebe','Phoibe'],[95,'Crius','Krios']]],
  ['Name one of the nine Muses.',[[25,'Calliope','Kalliope'],[40,'Clio','Kleio'],[50,'Thalia'],[60,'Melpomene'],[65,'Terpsichore'],[70,'Erato'],[75,'Urania','Ourania'],[85,'Euterpe'],[95,'Polyhymnia','Polymnia']]],
  ['Name one of the three Gorgons.',[[20,'Medusa'],[65,'Stheno'],[90,'Euryale']]],
  ['Name one of the three judges of the Underworld.',[[25,'Minos'],[70,'Rhadamanthus','Rhadamanthys'],[90,'Aeacus','Aiakos']]],
  ['Name one of the four winds called the Anemoi.',[[25,'Zephyrus','Zephyr'],[55,'Boreas'],[80,'Notus','Notos'],[95,'Eurus','Euros']]],
  ['Name one of the six children of Cronus and Rhea.',[[20,'Zeus'],[25,'Poseidon'],[30,'Hades'],[40,'Hera'],[70,'Demeter'],[95,'Hestia']]],
  ['Name a monster from this set: lion, serpent, boar, hind, bull, or birds from Heracles’ labors.',[[20,'Nemean Lion','Lion'],[25,'Lernaean Hydra','Hydra','Serpent'],[60,'Erymanthian Boar','Boar'],[95,'Ceryneian Hind','Hind'],[75,'Cretan Bull','Bull'],[90,'Stymphalian Birds','Birds']]],
];
const normalize = text => text.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z]/g,'').replace(/^the/,'');
export function myth(root,restart) {
  let index=0, depth=0, timer;
  function show() {
    if (index === mythRounds.length) return end(root,'Dive complete',depth+' m below the surface',restart);
    const [prompt,answers]=mythRounds[index];
    const stats=make('div','','stats');
    const bar=make('div','','depth');
    const fill=make('div');
    fill.style.width=Math.min(100,depth/70)+'%';
    bar.append(fill);
    const form=make('form','','entry');
    const input=make('input');
    input.placeholder='Type a name';
    input.setAttribute('aria-label','Your answer');
    input.autocomplete='off';
    const submit=make('button','Dive','primary');
    submit.type='submit';
    form.append(input,submit);
    const feedback=make('p','Rarity points use preset values.','feedback');
    feedback.setAttribute('role','status');
    let locked=false;
    const finish=(timedOut=false) => {
      if(locked) return;
      locked=true;
      clearInterval(timer);
      input.disabled=submit.disabled=true;
      const guess=normalize(input.value);
      const match=!timedOut && answers.find(([, ...aliases]) => aliases.some(alias => normalize(alias) === guess));
      const points=match ? match[0] : 0;
      depth+=points*10;
      fill.style.width=Math.min(100,depth/70)+'%';
      stats.textContent='Prompt '+(index+1)+' of 7 · '+depth+' m';
      feedback.textContent=match ? match[1]+' earns '+points+' points and '+points*10+' m.' :
        (timedOut?'Time is up. ':'That answer earns 0 points. ')+'Examples: '+answers.slice(0,3).map(a=>a[1]).join(', ')+'.';
      root.append(button('Continue',() => {index++;show();},'primary'));
    };
    form.onsubmit=event=>{event.preventDefault();if(input.value.trim()) finish();};
    const deadline=Date.now()+20000;
    function tick() {
      const left=Math.max(0,Math.ceil((deadline-Date.now())/1000));
      stats.textContent='Prompt '+(index+1)+' of 7 · '+depth+' m · '+left+' s';
      if(!left) finish(true);
    }
    root.replaceChildren(stats,bar,make('h2',prompt),form,feedback);
    tick();
    timer=setInterval(tick,150);
  }
  root.append(make('div','🔱','banner'),button('Begin dive',show,'primary'));
  return () => clearInterval(timer);
}

export function cars(root,restart) {
  let round=['Toyota','Honda','BMW','Mercedes-Benz','Porsche','Ferrari','Ford','Hyundai'];
  let winners=[], pair=0;
  const votes=new Map();
  function show() {
    if(round.length===1) {
      end(root,round[0]+' wins','Your picks across the seven matchups',restart);
      const list=make('ul','','results');
      for(const [brand,count] of [...votes].sort((a,b)=>b[1]-a[1])) {
        const li=make('li',brand);
        li.append(make('strong',count+' wins'));
        list.append(li);
      }
      root.insertBefore(list,root.lastChild);
      return;
    }
    const picks=make('div','','pick');
    for(const brand of round.slice(pair,pair+2)) picks.append(button(brand,() => {
      votes.set(brand,(votes.get(brand)||0)+1);
      winners.push(brand);
      pair+=2;
      if(pair===round.length){round=winners;winners=[];pair=0;}
      show();
    }));
    root.replaceChildren(make('div',({8:'Quarterfinal',4:'Semifinal',2:'Final'})[round.length]+' · Match '+(pair/2+1)+' of '+round.length/2,'stats'),
      make('h2','Which brand would you pick?'),picks);
  }
  show();
}

const continents = [
  [[-167,65],[-152,71],[-126,72],[-109,75],[-81,72],[-60,56],[-56,48],[-68,44],[-80,26],[-97,20],[-87,14],[-78,9],[-84,8],[-105,21],[-116,31],[-125,49],[-143,60]],
  [[-81,11],[-68,12],[-51,3],[-35,-6],[-42,-22],[-55,-35],[-67,-55],[-74,-52],[-72,-35],[-80,-16]],
  [[-72,78],[-56,83],[-21,81],[-19,72],[-42,60],[-60,64]],
  [[-10,37],[-10,45],[0,52],[9,56],[6,63],[21,71],[43,70],[70,76],[105,77],[138,72],[177,66],[167,57],[141,51],[130,44],[122,32],[109,20],[107,9],[97,6],[91,23],[80,8],[70,24],[57,26],[51,14],[44,12],[34,31],[24,36],[10,37],[5,44],[-3,37]],
  [[-17,14],[-16,29],[-6,36],[10,37],[26,33],[35,30],[44,11],[51,11],[41,-3],[34,-18],[26,-34],[17,-35],[10,-19],[9,1],[-4,5],[-15,10]],
  [[112,-22],[123,-14],[134,-12],[141,-19],[153,-26],[150,-38],[137,-36],[129,-32],[115,-35]],
  [[95,5],[108,-6],[121,-9],[140,-8],[152,-11],[148,-4],[128,1],[116,8],[109,1]],
  [[130,32],[137,38],[144,45],[146,42],[141,35],[136,33]],
  [[44,-12],[51,-15],[49,-24],[43,-26]],
  [[165,-45],[175,-35],[178,-38],[169,-47]],
  [[-180,-70],[-145,-75],[-80,-73],[-55,-64],[-20,-73],[45,-68],[90,-66],[150,-72],[180,-69],[180,-85],[-180,-85]],
];

function map([longitude,latitude,zoom]) {
  const svgNS='http://www.w3.org/2000/svg';
  const svg=document.createElementNS(svgNS,'svg');
  svg.setAttribute('viewBox','0 0 360 145');
  svg.setAttribute('class','map');
  svg.setAttribute('role','img');
  svg.setAttribute('aria-label','Regional map with a highlighted location');
  const center=Math.max(-59,Math.min(62,latitude));
  const project=([lon,lat])=>[(lon-longitude)*zoom+180,(center-lat)*zoom+72.5];
  for(const area of continents) {
    const path=document.createElementNS(svgNS,'path');
    path.setAttribute('d','M'+area.map(project).map(point=>point.join(',')).join('L')+'Z');
    svg.append(path);
  }
  const marker=document.createElementNS(svgNS,'circle');
  const [x,y]=project([longitude,latitude]);
  marker.setAttribute('cx',x);
  marker.setAttribute('cy',y);
  marker.setAttribute('r','7');
  svg.append(marker);
  return svg;
}

export function geography(root,restart) {
  quiz(root,restart,{map,questions:[
    ['Which city is marked?',['Tokyo','Seoul','Beijing'],'Tokyo','Tokyo lies on Japan’s main island, Honshu.',[139.69,35.69,4]],
    ['Which mountain range is marked?',['Rockies','Andes','Alps'],'Andes','The Andes follow the western side of South America.',[-71,-18,2.4]],
    ['Which island is marked?',['Sri Lanka','Madagascar','Tasmania'],'Madagascar','The island is across the Mozambique Channel from mainland Africa.',[47,-19,3]],
    ['Which city is marked?',['Lima','Buenos Aires','Rio de Janeiro'],'Rio de Janeiro','Rio is on Brazil’s Atlantic coast.',[-43.17,-22.91,3]],
    ['Which country is marked?',['Egypt','Greece','Spain'],'Egypt','The marker is near Cairo in northeastern Africa.',[31.24,30.04,3.1]],
    ['Which continent is marked?',['Antarctica','Europe','Australia'],'Australia','The marker is in central Australia.',[134,-25,2.8]],
  ]});
}

const categories=[
  ['Space',[['This planet is known for its prominent ring system.',['Saturn','Neptune','Mars']],['This galaxy contains our Solar System.',['Milky Way','Andromeda','Whirlpool']],['This is the largest moon of Saturn.',['Titan','Europa','Io']]]],
  ['Greek Myth',[['This god wields a thunderbolt.',['Zeus','Ares','Hermes']],['This hero slew the Minotaur.',['Theseus','Perseus','Odysseus']],['This Titan was condemned to hold up the sky.',['Atlas','Prometheus','Oceanus']]]],
  ['Video Games',[['This plumber is Luigi’s brother.',['Mario','Wario','Toad']],['These green Minecraft mobs explode.',['Creepers','Slimes','Endermen']],['This puzzle game popularized falling tetrominoes.',['Tetris','Columns','Dr. Mario']]]],
];

export function jeopardy(root,restart) {
  let score=0;
  const played=new Set();
  function board() {
    if(played.size===9) return end(root,'Board cleared','Final score: '+score,restart);
    const grid=make('div','','board');
    for(const [name] of categories) grid.append(make('strong',name));
    for(let row=0;row<3;row++) {
      categories.forEach(([name],column)=>{
        const used=played.has(row*3+column);
        const tile=button(used?'—':'$'+(row+1)*100,()=>clue(row,column));
        tile.disabled=used;
        tile.setAttribute('aria-label',name+' for '+(row+1)*100);
        grid.append(tile);
      });
    }
    root.replaceChildren(make('div','Score '+score+' · '+played.size+'/9 clues','stats'),grid);
  }
  function clue(row,column) {
    const [category,clues]=categories[column];
    const [prompt,answers]=clues[row];
    const points=(row+1)*100;
    const options=make('div','','choices');
    const correct=answers[0];
    const order=(row+column)%3;
    for(const answer of [...answers.slice(order),...answers.slice(0,order)]) {
      options.append(button('What is '+answer+'?',()=>{
        played.add(row*3+column);
        score+=answer===correct?points:-points;
        for(const item of options.children) item.disabled=true;
        root.append(make('p',answer===correct?'Correct. +'+points:'Correct response: '+correct+'. −'+points,'feedback'),
          button('Back to board',board,'primary'));
      }));
    }
    root.replaceChildren(make('div',category+' · $'+points+' · Score '+score,'stats'),make('h2',prompt),options);
  }
  board();
}

export function lego(root,restart) {
  const size=8, count=size*size, brickCount=10;
  const bricks=new Set(), flags=new Set(), opened=new Set();
  let seeded=false, flagMode=false, finished=false;
  const neighbors=index=>{
    const x=index%size,y=Math.floor(index/size);
    const around=[];
    for(let dy=-1;dy<=1;dy++) for(let dx=-1;dx<=1;dx++) {
      if((dx||dy)&&x+dx>=0&&x+dx<size&&y+dy>=0&&y+dy<size) around.push((y+dy)*size+x+dx);
    }
    return around;
  };
  const adjacent=index=>neighbors(index).filter(cell=>bricks.has(cell)).length;
  function seed(index) {
    const safe=new Set([index,...neighbors(index)]);
    const available=Array.from({length:count},(_,i)=>i).filter(i=>!safe.has(i));
    while(bricks.size<brickCount) bricks.add(available.splice(Math.floor(Math.random()*available.length),1)[0]);
    seeded=true;
  }
  const stats=make('div','','stats');
  const feedback=make('p','Start anywhere. Your first step is safe.','feedback');
  feedback.setAttribute('role','status');
  const toggle=button('Switch to Flag mode',()=>{
    flagMode=!flagMode;
    toggle.textContent=flagMode?'Switch to Step mode':'Switch to Flag mode';
    toggle.setAttribute('aria-pressed',String(flagMode));
    draw();
  });
  toggle.setAttribute('aria-pressed','false');
  const board=make('div','','mine');
  const cells=Array.from({length:count},(_,index)=>{
    const tile=button('·',()=>act(index,flagMode));
    tile.oncontextmenu=event=>{event.preventDefault();act(index,true);};
    board.append(tile);
    return tile;
  });
  function reveal(index) {
    if(opened.has(index)||flags.has(index)) return;
    opened.add(index);
    if(!adjacent(index)) neighbors(index).forEach(reveal);
  }
  function finish(won) {
    finished=true;
    toggle.disabled=true;
    feedback.textContent=won?'You made it across the bedroom.':'Ouch! You stepped on a LEGO brick.';
    root.append(button('Play again',restart,'primary'));
  }
  function act(index,flag) {
    if(finished||opened.has(index)) return;
    if(flag) {
      if(flags.has(index)) flags.delete(index);
      else if(flags.size<brickCount) flags.add(index);
    } else if(!flags.has(index)) {
      if(!seeded) seed(index);
      if(bricks.has(index)) finish(false);
      else {
        reveal(index);
        if(opened.size===count-brickCount) finish(true);
      }
    }
    draw();
  }
  function draw() {
    stats.textContent=(flagMode?'Flag':'Step')+' mode · '+(brickCount-flags.size)+' flags left';
    cells.forEach((tile,index)=>{
      const open=opened.has(index), flag=flags.has(index), brick=finished&&bricks.has(index);
      const near=open?adjacent(index):0;
      tile.className=brick?'brick':open?'open':flag?'flag':'';
      tile.textContent=brick?'▦':open?(near||''):flag?'⚑':'·';
      tile.disabled=open||finished;
      tile.setAttribute('aria-label','Row '+(Math.floor(index/size)+1)+', column '+(index%size+1)+': '+(brick?'LEGO brick':open?near+' adjacent':flag?'flagged':'covered'));
    });
  }
  root.append(make('div','☾','banner'),stats,board,feedback,toggle);
  draw();
}
