import { instanceScenery } from './scenery-instancing.js';
import { createShoreLayout,shorePoint,shoreVisible } from './shore-layout.js';
import { createContactFoam } from './contact-foam.js';
import { createRockKit } from './rock-kit.js';
import { createCoastalRibbon } from './coastal-ribbon.js';

export function createIllustratedShore(THREE,parent,{islands,shoreAssets,boatAsset,rockAssets}) {
  const root=new THREE.Group();root.name='ComposedMaracaiboBanks';parent.add(root);
  const coast=createCoastalRibbon(THREE,root),windows=[];
  const bounds=Object.fromEntries(Object.entries(shoreAssets).map(([name,asset])=>{
    asset.scene.updateMatrixWorld(true);const box=new THREE.Box3().setFromObject(asset.scene,true);
    return [name,{minX:box.min.x,maxX:box.max.x,minZ:box.min.z,maxZ:box.max.z}];
  }));
  const layout=createShoreLayout(islands,bounds),placements=[...layout.banks,...layout.forest,...layout.backdrop];
  for(const [variant,asset]of Object.entries(shoreAssets)){
    const members=placements.filter(bank=>bank.variant===variant);
    const batches=instanceScenery(THREE,asset.scene,members,root);
    batches.forEach(batch=>{batch.userData.shoreVariant=variant;batch.instanceMatrix.setUsage(THREE.DynamicDrawUsage);});
    windows.push({members,batches,matrices:batches.map(batch=>batch.instanceMatrix.array.slice())});
  }
  const stones=[],boats=[];
  layout.banks.forEach((bank,index)=>{
    // Rocks sit at the water-facing shelf, with unequal spacing and silhouette.
    for(const [j,t]of [-.72,-.22,.31,.77].entries()){
      const point=shorePoint(bank,bank.rx*Math.sqrt(1-t*t)*.96,bank.rz*t);
      stones.push({...point,y:-.06,angle:index*.73+j*.91,variant:(index+j)%4,scale:.55+(index+j)%3*.18});
    }
    if(bank.variant==='village'){
      const point=shorePoint(bank,bank.rx*.92,bank.rz*.95+4);
      boats.push({...point,x:bank.side*Math.max(27,Math.abs(point.x)),y:.01,scale:.8,angle:bank.angle+.18,color:index%2?0xa7bfa3:0xdca67b});
    }
  });
  const rocks=createRockKit(THREE,root,rockAssets,stones.length);rocks.sync(stones);
  instanceScenery(THREE,boatAsset.scene,boats,root);
  const shoreFoam=createContactFoam(THREE,root,layout.banks.length,0xe9ffed);
  shoreFoam.sync(layout.banks.map(bank=>({x:bank.x,z:bank.z,rx:bank.rx*1.13,rz:bank.rz*1.13,angle:bank.angle,kind:1})));
  let lastBucket=null;
  function setView(viewZ){
    if(!Number.isFinite(viewZ))return;
    const bucket=Math.floor(viewZ/24);if(bucket===lastBucket)return;lastBucket=bucket;
    // Only copy when entering another stretch. Existing arrays and bounds stay
    // valid, and the same visible set serves both cameras without extra draws.
    const center=bucket*24;
    for(const window of windows){
      for(let batchIndex=0;batchIndex<window.batches.length;batchIndex++){
        const batch=window.batches[batchIndex],source=window.matrices[batchIndex],target=batch.instanceMatrix.array;
        let count=0;
        for(let index=0;index<window.members.length;index++)if(shoreVisible(window.members[index],center)){
          const from=index*16,to=count*16;
          for(let element=0;element<16;element++)target[to+element]=source[from+element];count++;
        }
        batch.count=count;batch.instanceMatrix.needsUpdate=true;
      }
    }
  }
  return {shoreFoam,layout,root,setView,coast};
}
