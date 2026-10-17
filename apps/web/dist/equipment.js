import * as THREE from './vendor/three.module.js';
import { findItem } from './economy.js';
import { configureIllustratedMaterial } from './illustrated-materials.js';

// The same authored geometry is used by thumbnails, previews and race actors.
// Geometry belongs to the loaded kit; each live actor owns its material copies.
export function createEquipmentKit(assets, wasteModels = []) {
  const owned = new WeakMap();
  function model(id, type, ownMaterials) {
    const item = findItem(id);
    if (!item || item.type !== type || !assets[id]) throw new Error(`Equipo desconocido: ${id}`);
    const root = assets[id].scene.clone(true);
    root.userData.equipmentId = id;
    root.traverse(o=>{if(o.isMesh){o.castShadow=!o.material.transparent;o.receiveShadow=!o.material.transparent;}});
    if (ownMaterials) {
      const copies = new Map();
      root.traverse(o => {
        if (!o.material) return;
        if (!copies.has(o.material)) copies.set(o.material, configureIllustratedMaterial(o.material.clone(),'equipment'));
        o.material = copies.get(o.material);
        if (o.material.name === 'BoardColor' || o.material.name === 'NetColor') o.material.color.set(item.color);
        if (o.material.transparent) o.material.depthWrite = false;
      });
      owned.set(root, new Set(copies.values()));
    }
    return root;
  }
  return {
    board(id = 'coral', ownMaterials = true) { return model(id, 'board', ownMaterials); },
    net(id = 'red-base', ownMaterials = true) {
      const group = model(id, 'net', ownMaterials);
      const head = group.getObjectByName(`NetHead-${id}`);
      if (!head) throw new Error(`Falta el anclaje de la red: ${id}`);
      const catchVisual = new THREE.Group(); catchVisual.name = 'CaughtWaste';
      catchVisual.position.y = -.31; catchVisual.visible = false; head.add(catchVisual);
      wasteModels.forEach(model => {
        const caught = model.clone(true); caught.scale.setScalar(.5); caught.visible = false; catchVisual.add(caught);
      });
      return { group, head, catchVisual };
    },
    dispose(root) {
      for (const mat of owned.get(root) || []) mat.dispose();
      owned.delete(root);
    },
  };
}
