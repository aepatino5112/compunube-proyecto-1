// Original procedural effects. A single context starts only from a user gesture.
export function createGameAudio(Context = globalThis.AudioContext || globalThis.webkitAudioContext) {
  let context, master, water, waterFilter, noise, enabled = true, audible = false, lastAmbient = -1;
  const voices = new Set(), lastCue = new Map();
  function clearVoices() {
    for (const source of voices) { try { source.stop(); } catch {} }
    voices.clear();
  }
  function gain(node, value) {
    node.gain.cancelScheduledValues(context.currentTime);
    node.gain.setTargetAtTime(value,context.currentTime,.025);
  }
  function init() {
    context = new Context(); master = context.createGain(); master.gain.value = 0;
    master.connect(context.destination);
    noise = context.createBuffer(1,context.sampleRate*2,context.sampleRate);
    const samples = noise.getChannelData(0); let previous=0, seed=191;
    for(let i=0;i<samples.length;i++) {
      seed=(seed*1664525+1013904223)>>>0;
      previous=(previous+(seed/4294967296*2-1)*.08)/1.04;samples[i]=previous*3;
    }
    const source=context.createBufferSource();source.buffer=noise;source.loop=true;
    waterFilter=context.createBiquadFilter();waterFilter.type='lowpass';waterFilter.frequency.value=450;
    water=context.createGain();water.gain.value=0;
    source.connect(waterFilter).connect(water).connect(master);source.start();
  }
  function tone(frequency, end, duration, delay=0, volume=.2, type='sine') {
    const at=context.currentTime+delay, source=context.createOscillator(), envelope=context.createGain();
    source.type=type;source.frequency.setValueAtTime(frequency,at);
    source.frequency.exponentialRampToValueAtTime(end,at+duration);
    envelope.gain.setValueAtTime(.0001,at);envelope.gain.exponentialRampToValueAtTime(volume,at+.012);
    envelope.gain.exponentialRampToValueAtTime(.0001,at+duration);
    source.connect(envelope).connect(master);voices.add(source);
    source.onended=()=>{source.disconnect();envelope.disconnect();voices.delete(source);};
    source.start(at);source.stop(at+duration+.025);
  }
  function splash(duration=.2, frequency=650) {
    const source=context.createBufferSource(), filter=context.createBiquadFilter(), envelope=context.createGain(), at=context.currentTime;
    source.buffer=noise;filter.type='bandpass';filter.frequency.value=frequency;filter.Q.value=.5;
    envelope.gain.setValueAtTime(.3,at);envelope.gain.exponentialRampToValueAtTime(.0001,at+duration);
    source.connect(filter).connect(envelope).connect(master);voices.add(source);
    source.onended=()=>{source.disconnect();filter.disconnect();envelope.disconnect();voices.delete(source);};
    source.start(at);source.stop(at+duration);
  }
  return {
    get enabled() { return enabled; },
    async unlock() {
      if (!enabled || !Context) return;
      try { if (!context) init(); if(context.state==='suspended')await context.resume(); }
      catch { /* Missing or blocked audio never prevents a race. */ }
    },
    setEnabled(value) { enabled=Boolean(value); if(master)gain(master,enabled && audible ? .2 : 0); if(!enabled)clearVoices(); },
    update(state,boosting=false) {
      const next=state==='running'||state==='countdown'||state==='finished';
      if(context && master) {
        if(audible!==next)gain(master,enabled && next ? .2 : 0);
        const ambient=state==='running' ? .035+(boosting ? .035 : 0) : 0;
        if(lastAmbient!==ambient){gain(water,ambient);lastAmbient=ambient;}
        if(state==='paused'||state==='menu')clearVoices();
      }
      audible=next;
    },
    cue(kind,variant=0) {
      if(!context||context.state!=='running'||!enabled||!audible||voices.size>20)return;
      const now=context.currentTime;
      if(now-(lastCue.get(kind)??-Infinity)<(kind==='danger'?2.5:kind==='boost'?.35:.07))return;
      lastCue.set(kind,now);
      if(kind==='collect'){splash(.14);tone(variant===1?900:520,variant===1?650:820,.14,0,.18,variant===1?'triangle':'sine');}
      else if(kind==='boost'){splash(.38,1200);tone(160,330,.3,0,.11);}
      else if(kind==='jump')tone(190,440,.19,0,.13);
      else if(kind==='hit'){splash(.22,180);tone(110,55,.25,0,.24,'triangle');}
      else if(kind==='life'){tone(550,550,.14);tone(830,830,.22,.13);}
      else if(kind==='danger'){tone(220,180,.16,0,.17,'triangle');tone(220,180,.16,.22,.17,'triangle');}
      else if(kind==='finish') [523,659,784].forEach((f,i)=>tone(f,f,.34,i*.14,.2));
      else if(kind==='out') [260,210,150].forEach((f,i)=>tone(f,f,.25,i*.15,.16,'triangle'));
    },
  };
}

export function mountAudioControls(audio) {
  let enabled=true;
  try {enabled=localStorage.getItem('compunube.sound.v1')!=='off';}catch{}
  audio.setEnabled(enabled);
  const menu=document.createElement('button'),race=document.createElement('button');
  menu.id='sound-menu';race.id='sound-race';race.className='sound-toggle';
  document.querySelector('.menu-footer>div').insertBefore(menu,document.querySelector('.version'));
  document.getElementById('pause').after(race);
  function render() {
    for(const button of [menu,race]) {
      button.setAttribute('aria-pressed',String(audio.enabled));
      button.setAttribute('aria-label',audio.enabled?'Silenciar sonido':'Activar sonido');
      button.title=audio.enabled?'Silenciar sonido':'Activar sonido';
    }
    menu.textContent=audio.enabled?'Sonido: sí':'Sonido: no';race.textContent=audio.enabled?'♪':'♪̸';
  }
  for(const button of [menu,race])button.addEventListener('click',()=>{
    audio.setEnabled(!audio.enabled);audio.unlock();
    try {localStorage.setItem('compunube.sound.v1',audio.enabled?'on':'off');}catch{}
    render();
  });
  render();
}
