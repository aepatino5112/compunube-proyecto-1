// Shared shapes of the JavaScript game modules that stay in JavaScript
// (dist/maps.js, dist/economy.js, dist/appearance.js).
export interface CatalogEntry {
  id: string;
  type: 'character' | 'board' | 'outfit' | 'hair' | 'net';
  name: string;
  price?: number;
  recipe?: { plastic: number; metal: number };
  [extra: string]: unknown;
}
export interface ColorOption { id: string; name: string; color: string }
export interface MapEntry { id: string; name: string; [extra: string]: unknown }
