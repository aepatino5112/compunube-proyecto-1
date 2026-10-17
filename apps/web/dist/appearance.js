export const HAIR_STYLES=['swept','curls','bun','ponytail','afro'];
export const SKIN_TONES=[
  {id:'light',name:'Claro',color:'#edbfa0'},
  {id:'warm',name:'Claro cálido',color:'#d99c6e'},
  {id:'medium',name:'Medio',color:'#ad6b45'},
  {id:'dark',name:'Oscuro',color:'#754630'},
  {id:'deep',name:'Profundo',color:'#49312b'},
];
export const HAIR_COLORS=[
  {id:'black',name:'Negro',color:'#29201d'},
  {id:'brown',name:'Castaño',color:'#71442c'},
  {id:'blonde',name:'Rubio',color:'#e3af3d'},
  {id:'copper',name:'Cobrizo',color:'#ba6339'},
  {id:'silver',name:'Plateado',color:'#b8c2c7'},
  {id:'blue',name:'Azul',color:'#5884b7'},
];
export const CHARACTERS=[
  {id:'nico',name:'Nico',gender:'Hombre',morph:null,skin:'medium',hairColor:'brown',hair:'swept',description:'Hombros amplios, mangas navy y bermudas con paneles claros. Su chaleco lleva una V que sigue el ritmo de la ola.'},
  {id:'luna',name:'Luna',gender:'Mujer',morph:'Luna',skin:'light',hairColor:'blonde',hair:'ponytail',description:'Paneles lavanda, short deportivo y una coleta agrupada que acompaña el giro. Su lugar favorito está entre el sol y el agua.'},
  {id:'amara',name:'Amara',gender:'Mujer',morph:'Amara',skin:'dark',hairColor:'black',hair:'afro',description:'Rizos con volumen, chaleco con paneles claros y una silueta deportiva. Lleva el ritmo del club.'},
  {id:'samuel',name:'Samuel',gender:'Hombre',morph:'Samuel',skin:'dark',hairColor:'copper',hair:'curls',description:'Figura esbelta, lycra teal y ocre, bermudas largas y rizos cobrizos. Cada recorrido es una nueva historia.'},
];
export const findCharacter=id=>CHARACTERS.find(character=>character.id===id)||CHARACTERS[0];
export function raceRoster(playerId){
  const player=findCharacter(playerId);
  return [player,...['amara','luna','samuel','nico'].filter(id=>id!==player.id).map(findCharacter)];
}
export function restoreAppearance(value={}) {
  return {
    skin:SKIN_TONES.some(tone=>tone.id===value?.skin)?value.skin:'medium',
    hairColor:HAIR_COLORS.some(tone=>tone.id===value?.hairColor)?value.hairColor:'brown',
  };
}
