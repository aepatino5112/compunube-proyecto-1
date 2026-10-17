// Opt-in local instrumentation; ordinary game screens carry no diagnostic panel.
export function createRenderDiagnostics() {
  if(new URLSearchParams(location.search).get('rendimiento')!=='1')return {frame(){},record(){}};
  const panel=document.createElement('output');panel.id='render-diagnostics';
  panel.setAttribute('aria-label','Diagnóstico de rendimiento');
  panel.style.cssText='position:fixed;z-index:100;bottom:12px;left:12px;max-width:calc(100vw - 48px);padding:12px 16px;border-radius:10px;background:#173e38ee;color:#f4fff1;font:12px/1.7 monospace;white-space:pre-wrap;pointer-events:none';
  document.body.append(panel);
  let frames=0,draws=0,lastReport=-Infinity,data={update:0,main:0,rear:0,calls:0,triangles:0};
  return {
    record(update,main,rear,calls,triangles){draws++;data={update,main,rear,calls,triangles};},
    frame(now,gap,state){
      frames++;if(now-lastReport<500)return;lastReport=now;
      panel.textContent=`RENDIMIENTO · ${state}\nIntervalo del navegador: ${gap.toFixed(1)} ms\nActualización JS: ${data.update.toFixed(1)} ms\nDibujo principal / trasero: ${data.main.toFixed(1)} / ${data.rear.toFixed(1)} ms\nLlamadas / triángulos: ${data.calls} / ${data.triangles}\nFotogramas recibidos / dibujados: ${frames} / ${draws}\nTiempos de CPU; GPU no medida por separado.`;
    }
  };
}
