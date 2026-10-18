/**
 * REFERENCIA HISTÓRICA DEL FRONTEND PREPARADO.
 *
 * E43 cerró el contrato realtime v1 en:
 *   ../../../../contracts/realtime/events.md
 *   ../../../../contracts/realtime/v1.ts
 *
 * Los tipos realtime de este archivo ya NO son normativos: conservan la forma
 * con la que se preparó el frontend antes de E43 (waiting/running/ended, bots,
 * lengthMeters, sin DNF completo y con profile.updated).
 *
 * Los tipos de perfil/acciones siguen siendo propuesta de frontera pública
 * hasta E45, que decidirá HTTP/OpenAPI. Go↔Rust usa proto/player_profile.proto.
 */
export type MapId = 'maracaibo' | 'orinoco';
export type MaterialId = 'plastic' | 'metal';
export type CharacterId = 'nico' | 'luna' | 'amara' | 'samuel';
export type BoardId = 'coral' | 'manglar' | 'sol';
export type OutfitId = 'costero' | 'brisa' | 'uva';
export type NetId = 'red-base' | 'red-reuso' | 'red-marea' | 'red-cobre' | 'red-faro' | 'red-aurora' | 'red-sol';
export type HairStyleId = 'swept' | 'curls' | 'bun' | 'ponytail' | 'afro';
export type SkinId = 'light' | 'warm' | 'medium' | 'dark' | 'deep';
export type HairColorId = 'black' | 'brown' | 'blonde' | 'copper' | 'silver' | 'blue';
export type ItemId = CharacterId | BoardId | OutfitId | NetId | HairStyleId;
export type PlayerId = string;
export type RoomId = string;
export type RaceId = string;
export type NetSide = -1 | 1;
export interface Equipment {
  board: BoardId; outfit: OutfitId; net: NetId;
  hair: HairStyleId; character: CharacterId;
}
export interface Appearance { skin: SkinId; hairColor: HairColorId; }
/** Forma local existente. settled es historial local de 40 IDs, no el libro de premios del servidor. */
export interface LocalProfileV1 {
  version: 1;
  coins: number; plastic: number; metal: number;
  totalCleaned: number; races: number;
  owned: ItemId[]; equipped: Equipment; appearance: Appearance;
  settled: string[];
}
/** DTO online: mantiene campos de UI, sin exponer el historial local como autoridad. */
export type OnlineProfile = Omit<LocalProfileV1, 'settled'>;
export interface ProfileEnvelope {
  playerId: PlayerId; // Identidad confirmada de esta sesión, no el personaje cosmético.
  profileRevision: number;
  profile: OnlineProfile;
  requestId?: string;
}
export type ProfileAction =
  | {type: 'buy' | 'craft' | 'equip'; id: ItemId}
  | {type: 'appearance'; field: 'skin'; value: SkinId}
  | {type: 'appearance'; field: 'hairColor'; value: HairColorId}
  | {type: 'exchange'; material: MaterialId; amount: number};
/** El cliente nunca envía una acción finish ni cantidades de premio. */
export interface ProfileActionRequest { requestId: string; action: ProfileAction; }
export interface CatalogItem {
  id: ItemId;
  type: 'board' | 'outfit' | 'net' | 'hair' | 'character';
  name: string; description: string;
  price?: number; recipe?: {plastic: number; metal: number};
  color?: string; rarity?: string;
  skin?: SkinId; hairColor?: HairColorId; hair?: HairStyleId;
  gender?: string; morph?: string | null;
}
export interface CatalogResponse {
  catalogVersion: string;
  rulesVersion: string;
  courseVersion: string;
  items: CatalogItem[];
  skinTones: {id: SkinId; name: string; color: string}[];
  hairColors: {id: HairColorId; name: string; color: string}[];
  maps: {id: MapId; name: string}[];
}
export interface RoomMember {
  playerId: PlayerId; displayName: string;
  controller: 'human' | 'bot'; ready: boolean; connected: boolean;
  equipment: Equipment; appearance: Appearance;
}
export interface RoomState {
  roomId: RoomId; mapId: MapId; capacity: 4;
  rulesVersion: string; courseVersion: string;
  state: 'waiting' | 'countdown' | 'running' | 'ended';
  members: RoomMember[];
}
export interface CreateRoomRequest { requestId: string; mapId: MapId; }
export interface JoinRoomRequest { requestId: string; }
export interface JoinRoomResponse { selfPlayerId: PlayerId; room: RoomState; }
/** Posición lógica: X lateral, Z hacia delante negativo. Sin altura de oleaje visual. */
export interface XZ { x: number; z: number; }
export interface CourseManifest {
  mapId: MapId; courseVersion: string; initialSeed: number;
  lengthMeters: number; lateralLimitMeters: number;
  obstacles: (XZ & {id: string; radius: number})[];
  trash: (XZ & {id: string; kind: 0 | 1 | 2; rotation: number; phase: number})[];
  lifesavers: (XZ & {id: string})[];
}
export interface PlayerState extends XZ {
  playerId: PlayerId;
  state: 'racing' | 'finished' | 'disqualified' | 'left';
  speed: number; turn: number; netSide: NetSide; netAngle: number;
  energy: number; boosting: boolean;
  jump: number; jumpVelocity: number;
  lives: number; protection: number; hit: number;
  collected: number; plastic: number; metal: number;
  /** Señales opcionales para reconstruir una pose al recibir/reanudar estado. */
  catchTimer?: number; landingTimer?: number;
  finishTimeSeconds: number | null;
  lastProcessedInputSeq: number;
  lastProcessedJumpSeq: number;
}
/** null implica disponible; un ID estable sustituye al índice local 0–3. */
export interface PickupOwnership { itemId: string; collectedBy: PlayerId | null; }
/** Array flexible para permitir acordar un pulpo por jugador o uno compartido. */
export interface PursuitState { pursuitId: string; targetPlayerId: PlayerId; gap: number; retreat: number; }
export interface RaceSnapshot {
  raceId: RaceId; tick: number;
  serverTimeMs: number; // Marca UTC del servidor; no es elapsed.
  elapsedSeconds: number;
  state: 'countdown' | 'running' | 'ended'; countdownSeconds: number;
  players: PlayerState[];
  /** El adaptador actual espera listas completas; acordar este requisito con backend. */
  trash: PickupOwnership[]; lifesavers: PickupOwnership[];
  pursuits: PursuitState[];
}
export interface RaceInput {
  type: 'race.input'; protocolVersion: 1; raceId: RaceId;
  seq: number; // Entero creciente por sesión, con regla de reentrada acordada.
  steer: number; // Validar -1 <= steer <= 1.
  netSide: NetSide; boost: boolean;
  jumpSeq: number; // Aumenta por pulsación; el servidor consume cada nueva secuencia una vez.
}
export type ClientMessage = RaceInput
  | {type: 'room.ready'; protocolVersion: 1; roomId: RoomId; ready: boolean}
  | {type: 'room.leave'; protocolVersion: 1; roomId: RoomId};
export interface RaceEventBase { eventId: string; raceId: RaceId; tick: number; }
export type RaceEvent = RaceEventBase & (
  | {kind: 'trash.collected'; itemId: string; playerId: PlayerId; material: MaterialId}
  | {kind: 'life.collected'; itemId: string; playerId: PlayerId; lives: number}
  | {kind: 'player.hit'; playerId: PlayerId; cause: 'obstacle' | 'octopus'; lives: number}
  | {kind: 'player.finished'; playerId: PlayerId; finishTimeSeconds: number}
  | {kind: 'player.disqualified'; playerId: PlayerId}
);
export interface ParticipantResult {
  playerId: PlayerId;
  outcome: 'finished' | 'disqualified' | 'left';
  rank: number | null; finishTimeSeconds: number | null;
  collected: {plastic: number; metal: number};
  /** Confirmado por servidor. Cero al descalificarse/salir según la regla actual. */
  credited: {plastic: number; metal: number};
  settlementId: string | null;
}
export interface RaceResult { raceId: RaceId; participants: ParticipantResult[]; }
export type ErrorCode = 'INVALID_ACTION' | 'INVALID_ITEM' | 'INSUFFICIENT_COINS'
  | 'INSUFFICIENT_MATERIALS' | 'NOT_OWNED' | 'ALREADY_OWNED' | 'INVALID_APPEARANCE'
  | 'ROOM_FULL' | 'ROOM_NOT_FOUND' | 'RACE_NOT_ACTIVE' | 'NOT_A_MEMBER'
  | 'INCOMPATIBLE_VERSION' | 'SESSION_REQUIRED';
export interface ApiError { code: ErrorCode; message: string; requestId?: string; }
export type ServerMessage =
  | {type: 'room.state'; protocolVersion: 1; selfPlayerId: PlayerId; room: RoomState}
  | {type: 'race.start'; protocolVersion: 1; raceId: RaceId; serverTimeMs: number; startsAtMs: number; rulesVersion: string; course: CourseManifest; members: RoomMember[]}
  | {type: 'race.snapshot'; protocolVersion: 1; snapshot: RaceSnapshot}
  | {type: 'race.event'; protocolVersion: 1; event: RaceEvent}
  | {type: 'race.ended'; protocolVersion: 1; result: RaceResult}
  | {type: 'profile.updated'; protocolVersion: 1; data: ProfileEnvelope}
  | {type: 'error'; protocolVersion: 1; error: ApiError};
