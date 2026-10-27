// All mutations return a new profile. Material spending and rewards are atomic.
import { CHARACTERS,SKIN_TONES,HAIR_COLORS,restoreAppearance } from './appearance.js';
export const CATALOG = [
  ...CHARACTERS.map(character=>({...character,type:'character',price:0})),
  { id: 'coral', type: 'board', name: 'Coral', color: '#ef795e', price: 0, description: 'Tu primera compañera de olas. Ligera, cálida y lista para volver al agua.' },
  { id: 'manglar', type: 'board', name: 'Manglar', color: '#378875', price: 300, description: 'Cola de pez, listones de madera recuperada y dos quillas. Una compañera con carácter de manglar.' },
  { id: 'sol', type: 'board', name: 'Sol del lago', color: '#e8bb53', price: 500, description: 'Una tabla redondeada con rayos de coral y líneas crema. Un poco del sol de Maracaibo para cada recorrido.' },
  { id: 'costero', type: 'outfit', name: 'Costero', color: '#ef795e', price: 0, description: 'El uniforme del club. Hecho para acompañarte muchas carreras.' },
  { id: 'brisa', type: 'outfit', name: 'Brisa', color: '#749dcc', price: 200, description: 'Azul de cielo para una nueva vuelta por el lago.' },
  { id: 'uva', type: 'outfit', name: 'Atardecer', color: '#a28abc', price: 400, description: 'Una paleta tranquila para dejar una buena huella.' },
  { id: 'swept', type: 'hair', name: 'Al viento', color: '#54321f', price: 0, description: 'Mechones peinados hacia atrás y una nuca corta. Disponible para todo el club.' },
  { id: 'curls', type: 'hair', name: 'Rizos', color: '#382219', price: 0, description: 'Una corona de rizos con volumen y silueta propia. Disponible para todo el club.' },
  { id: 'bun', type: 'hair', name: 'Recogido', color: '#66341e', price: 0, description: 'Cabello recogido con moño y mechones marcados. Disponible para todo el club.' },
  { id: 'ponytail', type: 'hair', name: 'Coleta', color: '#e9bd60', price: 0, description: 'Coleta larga con mechones curvos y una banda de tela. Disponible para todo el club.' },
  { id: 'afro', type: 'hair', name: 'Afro', color: '#29201d', price: 0, description: 'Rizos amplios que forman una silueta redondeada con volumen propio. Disponible para todo el club.' },
  { id: 'red-base', type: 'net', name: 'Red costera', color: '#2e7373', price: 0, description: 'Tu recogedor de confianza. Cambia de lado con Z y X.' },
  { id: 'red-reuso', type: 'net', name: 'Red reutilizada', color: '#e8b753', recipe: { plastic: 30, metal: 15 }, description: 'Marco cuadrado de esquinas suaves, mango de madera y uniones recuperadas. Tus materiales vuelven al agua como herramienta.' },
  { id: 'red-marea', type: 'net', name: 'Red marea', color: '#a38bc4', recipe: { plastic: 50, metal: 25 }, description: 'Marco ovalado de doble aro y bolsa profunda en U. Una segunda vida para el plástico y la chatarra.' },
  { id: 'red-cobre', type: 'net', name: 'Cobre', color: '#c8855d', rarity: 'Destacada', recipe: { plastic: 60, metal: 40 }, description: 'Mango de cobre recuperado y aro hexagonal. Un acabado cálido con uniones visibles.' },
  { id: 'red-faro', type: 'net', name: 'Faro', color: '#52c9b3', rarity: 'Especial', recipe: { plastic: 80, metal: 50 }, description: 'Mango de acero, aro octagonal y bandas de luz verde agua. Un faro pequeño para tu estilo.' },
  { id: 'red-aurora', type: 'net', name: 'Aurora', color: '#789af1', rarity: 'Especial', recipe: { plastic: 100, metal: 60 }, description: 'Acero, aro en forma de gota y luces azules. La bolsa conserva su fondo en U.' },
  { id: 'red-sol', type: 'net', name: 'Sol del puente', color: '#e9b44d', rarity: 'Especial', recipe: { plastic: 120, metal: 80 }, description: 'Aro ancho de doble borde y bandas ámbar sobre acero. Un recuerdo del sol de Maracaibo.' },
];
for (const item of CATALOG.filter(item=>item.type==='net')) item.rarity ??= item.id==='red-marea'?'Destacada':'Común';
export const findItem = id => CATALOG.find(item => item.id === id);
export const freshProfile = () => ({ version: 1, coins: 0, plastic: 0, metal: 0, totalCleaned: 0, races: 0, owned: ['coral', 'costero', 'red-base',...CATALOG.filter(item=>['hair','character'].includes(item.type)).map(item=>item.id)], equipped: { board: 'coral', outfit: 'costero', net: 'red-base', hair: 'swept', character:'nico' }, appearance:restoreAppearance(), settled: [] });
const count = v => Number.isSafeInteger(v) && v >= 0 && v < 1e9;
export function restoreProfile(value) {
  const base = freshProfile();
  if (!value || value.version !== 1) return base;
  for (const key of ['coins', 'plastic', 'metal', 'totalCleaned', 'races']) if (count(value[key])) base[key] = value[key];
  base.owned = [...new Set([...base.owned, ...(Array.isArray(value.owned) ? value.owned.filter(id => findItem(id)) : [])])];
  for (const type of ['board', 'outfit', 'net', 'hair','character']) {
    const id = value.equipped?.[type];
    if (base.owned.includes(id) && findItem(id)?.type === type) base.equipped[type] = id;
  }
  base.appearance=restoreAppearance(value.appearance);
  base.settled = Array.isArray(value.settled) ? value.settled.filter(id => typeof id === 'string').slice(-40) : [];
  return base;
}
export function transact(profile, action) {
  const next = structuredClone(profile);
  const fail = error => ({ profile, error });
  const item = findItem(action.id);
  if (action.type === 'buy' || action.type === 'craft') {
    if (!item || next.owned.includes(item.id)) return fail('Este objeto ya está en tu equipo.');
    if (action.type === 'buy') {
      if (item.recipe || item.price === undefined) return fail('Esta herramienta se fabrica en el taller.');
      if (next.coins < item.price) return fail('Te faltan monedas. Recicla materiales en Canjear.');
      next.coins -= item.price;
    } else {
      if (!item.recipe) return fail('Este objeto no tiene receta.');
      if (next.plastic < item.recipe.plastic || next.metal < item.recipe.metal) return fail('Todavía faltan materiales para fabricarlo.');
      next.plastic -= item.recipe.plastic; next.metal -= item.recipe.metal;
    }
    next.owned.push(item.id);
  } else if (action.type === 'equip') {
    if (!item || !next.owned.includes(item.id)) return fail('Primero consigue este objeto.');
    next.equipped[item.type] = item.id;
    if(item.type==='character') {
      next.equipped.hair=item.hair;
      next.appearance={skin:item.skin,hairColor:item.hairColor};
    }
  } else if(action.type==='appearance') {
    const choices=action.field==='skin'?SKIN_TONES:action.field==='hairColor'?HAIR_COLORS:null;
    if(!choices?.some(choice=>choice.id===action.value))return fail('Elige un color disponible.');
    next.appearance={...restoreAppearance(next.appearance),[action.field]:action.value};
  } else if (action.type === 'exchange') {
    if (!['plastic', 'metal'].includes(action.material) || !count(action.amount) || action.amount < 1) return fail('Elige una cantidad válida.');
    if (next[action.material] < action.amount) return fail('No tienes esa cantidad de material.');
    next[action.material] -= action.amount;
    next.coins += action.amount * (action.material === 'plastic' ? 4 : 6);
  } else if (action.type === 'finish') {
    if (typeof action.raceId !== 'string' || !action.raceId || !count(action.plastic) || !count(action.metal)) return fail('Resultado de carrera inválido.');
    if (next.settled.includes(action.raceId)) return fail('Esta carrera ya está guardada.');
    next.plastic += action.plastic; next.metal += action.metal;
    next.totalCleaned += action.plastic + action.metal; next.races++;
    next.settled = [...next.settled, action.raceId].slice(-40);
  } else return fail('Acción desconocida.');
  return { profile: next, error: null };
}
