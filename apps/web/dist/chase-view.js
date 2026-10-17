// Small rear camera uses the existing WebGL context; it is a real view of the pursuer.
export function createChaseView(THREE, scene, asset, host, renderer) {
  const stage = host.parentElement;
  const hearts = document.createElement('div'); hearts.id = 'life-hud'; hearts.className = 'life-hud';
  hearts.setAttribute('role', 'img'); hearts.setAttribute('aria-label', '3 de 3 vidas');
  hearts.innerHTML = '<span aria-hidden="true">♥</span><span aria-hidden="true">♥</span><span aria-hidden="true">♥</span><small id="protection-label"></small>';
  const rear = document.createElement('div'); rear.id = 'rear-view'; rear.className = 'rear-view';
  rear.setAttribute('role', 'img'); rear.setAttribute('aria-label', 'Vista trasera del pulpo');
  rear.innerHTML = '<span class="rear-title">A TU ESPALDA</span><strong id="chase-distance">48 m</strong><span id="chase-hint">Mantén el ritmo</span>';
  const flash = document.createElement('div'); flash.className = 'hit-feedback'; flash.setAttribute('aria-hidden', 'true');
  stage.append(hearts, rear, flash);
  const heartIcons=[...hearts.querySelectorAll('span')],protectionLabel=hearts.querySelector('small');
  const distanceLabel=rear.querySelector('strong'),hintLabel=rear.querySelector('#chase-hint');
  let lastProtection='',lastDistance='',lastHint='',lastAria='',fullWidth=0,fullHeight=0;
  const camera = new THREE.PerspectiveCamera(48, 1.8, .1, 180);
  const octopus = asset.scene; scene.add(octopus);
  const mixer = new THREE.AnimationMixer(octopus);
  for (const clip of asset.animations) mixer.clipAction(clip).play();
  const froth = new THREE.Group(); scene.add(froth);
  for (let i = 0; i < 3; i++) {
    const ring = new THREE.Mesh(new THREE.RingGeometry(3.5 + i, 3.65 + i, 48), new THREE.MeshBasicMaterial({color:0xf4ffdc, transparent:true, opacity:.26, side:THREE.DoubleSide, depthWrite:false}));
    ring.rotation.x = -Math.PI / 2; ring.position.y = .025 + i * .005; froth.add(ring);
  }
  let viewport = null, time = 0, lastLives = -1;
  const motion = matchMedia('(prefers-reduced-motion: reduce)');
  function resize() {
    const a = host.getBoundingClientRect(), b = rear.getBoundingClientRect();
    if (!a.width || !b.width) return;
    viewport = { x: b.left - a.left, y: a.bottom - b.bottom, w: b.width, h: b.height };
    fullWidth=host.clientWidth;fullHeight=host.clientHeight;
    camera.aspect = b.width / b.height; camera.updateProjectionMatrix();
  }
  new ResizeObserver(resize).observe(rear);
  function update(player, chase, state, dt) {
    if (state === 'running' || state === 'countdown') { time += dt; mixer.update(dt * (chase.retreat ? .65 : 1.1)); }
    octopus.position.set(player.x, Math.sin(time * 2) * .1 - (chase.retreat > 0 ? .7 : 0), player.z + chase.gap);
    octopus.rotation.z = motion.matches ? 0 : Math.sin(time * 1.7) * .035;
    froth.position.set(octopus.position.x, 0, octopus.position.z);
    froth.scale.setScalar(1 + Math.sin(time * 3) * .04);
    camera.position.set(player.x, 5.2, player.z - 7);
    camera.lookAt(player.x, 1.4, player.z + Math.max(15, chase.gap));
    if (lastLives !== player.lives) {
      heartIcons.forEach((heart, i) => heart.classList.toggle('lost', i >= player.lives));
      hearts.setAttribute('aria-label', `${player.lives} de 3 vidas`); lastLives = player.lives;
    }
    const protection=player.protection > 0 && !player.disqualified && state !== 'finished' ? 'PROTECCIÓN' : '';
    if(protection!==lastProtection){protectionLabel.textContent=protection;lastProtection=protection;}
    const danger = chase.gap < 15 && chase.retreat === 0 && state !== 'finished';
    rear.classList.toggle('danger', danger); rear.classList.toggle('retreating', chase.retreat > 0);
    const distance=`${Math.round(chase.gap)} m`,hint=state === 'finished' ? 'Carrera terminada' : chase.retreat > 0 ? 'Se aleja · ¡aprovecha!' : danger ? '¡Usa el impulso!' : 'Mantén el ritmo';
    if(distance!==lastDistance){distanceLabel.textContent=distance;lastDistance=distance;}
    if(hint!==lastHint){hintLabel.textContent=hint;lastHint=hint;}
    const aria=`Vista trasera: pulpo a ${Math.round(chase.gap)} metros${danger ? ', cerca' : ''}`;
    if(aria!==lastAria){rear.setAttribute('aria-label',aria);lastAria=aria;}
  }
  function render(playerGroup) {
    if(rear.hidden)return;
    if (!viewport) resize();
    if (!viewport) return;
    const { x, y, w, h } = viewport;
    const visible = playerGroup.visible; playerGroup.visible = false;
    renderer.setScissorTest(true); renderer.setScissor(x, y, w, h); renderer.setViewport(x, y, w, h);
    renderer.render(scene, camera);
    renderer.setScissorTest(false); renderer.setViewport(0, 0, fullWidth, fullHeight);
    playerGroup.visible = visible;
  }
  return {
    resize, update, render,
    setPursuitVisible(visible){rear.hidden=!visible;octopus.visible=visible;froth.visible=visible;},
    feedback(recovered = false) {
      flash.classList.remove('hit', 'recovered'); void flash.offsetWidth;
      flash.classList.add(recovered ? 'recovered' : 'hit');
    },
    reset() { time = 0; mixer.setTime(0); flash.classList.remove('hit','recovered'); lastLives = -1; resize(); },
  };
}
