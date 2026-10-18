/**
 * E43 — contrato realtime público v1.
 * Fuente normativa junto a events.md.
 * Transporte: JSON text frames sobre WebSocket, subprotocol compunube.realtime.v1.
 */

export const REALTIME_PROTOCOL_VERSION = 1 as const;
export const REALTIME_SUBPROTOCOL = 'compunube.realtime.v1' as const;

export type MapId = 'maracaibo' | 'orinoco';
export type MaterialId = 'plastic' | 'metal';
export type ReduceChoice = 'reusable' | 'disposable';
export type RoomLifecycleState = 'LOBBY' | 'COUNTDOWN' | 'RACING' | 'RESULTS' | 'CLOSED';
export type ParticipantState =
  | 'not_ready'
  | 'ready'
  | 'racing'
  | 'reconnecting'
  | 'finished'
  | 'disqualified'
  | 'left'
  | 'dnf';

export interface Equipment {
  boardId: string;
  outfitId: string;
  netId: string;
  hairId: string;
  characterId: string;
}

export interface Appearance {
  skinId: string;
  hairColorId: string;
}

export interface RoomMember {
  playerId: string;
  displayName: string;
  connected: boolean;
  ready: boolean;
  participantState: ParticipantState;
  profileRevision: number;
  reduceChoice: ReduceChoice | null;
  equipment: Equipment;
  appearance: Appearance;
}

export interface RoomState {
  roomId: string;
  mapId: MapId;
  capacity: 4;
  state: RoomLifecycleState;
  rulesVersion: string;
  courseVersion: string;
  raceId: string | null;
  countdownEndsAtMs: number | null;
  members: RoomMember[];
}

export type RoomReadyMessage =
  | {
      type: 'room.ready';
      protocolVersion: 1;
      roomId: string;
      ready: true;
      profileRevision: number;
      reduceChoice: ReduceChoice;
    }
  | {
      type: 'room.ready';
      protocolVersion: 1;
      roomId: string;
      ready: false;
      profileRevision?: number;
      reduceChoice?: never;
    };

export interface RoomLeaveMessage {
  type: 'room.leave';
  protocolVersion: 1;
  roomId: string;
}

export interface RaceInputMessage {
  type: 'race.input';
  protocolVersion: 1;
  raceId: string;
  seq: number;
  steer: number;
  netSide: -1 | 1;
  boost: boolean;
  jumpSeq: number;
}

export type ClientRealtimeMessage =
  | RoomReadyMessage
  | RoomLeaveMessage
  | RaceInputMessage;

export interface RoomStateMessage {
  type: 'room.state';
  protocolVersion: 1;
  selfPlayerId: string;
  room: RoomState;
}

export interface CoursePoint {
  x: number;
  z: number;
}

export interface CourseObstacle extends CoursePoint {
  itemId: string;
  radius: number;
}

export interface CourseTrash extends CoursePoint {
  itemId: string;
  kind: 'bottle' | 'pipe' | 'wrapper';
  material: MaterialId;
  rotation: number;
  phase: number;
}

export interface CourseLifesaver extends CoursePoint {
  itemId: string;
}

export interface CourseManifest {
  mapId: MapId;
  courseVersion: string;
  lengthUnits: number;
  lateralLimitUnits: number;
  startSlotsX: number[];
  obstacles: CourseObstacle[];
  trash: CourseTrash[];
  lifesavers: CourseLifesaver[];
}

export interface RaceStartMessage {
  type: 'race.start';
  protocolVersion: 1;
  roomId: string;
  raceId: string;
  serverTimeMs: number;
  startedAtMs: number;
  rulesVersion: string;
  course: CourseManifest;
  roster: Array<{
    playerId: string;
    startSlotX: number;
    equipment: Equipment;
    appearance: Appearance;
    reduceChoice: ReduceChoice;
  }>;
}

export interface PlayerSnapshot {
  playerId: string;
  participantState:
    | 'racing'
    | 'reconnecting'
    | 'finished'
    | 'disqualified'
    | 'left'
    | 'dnf';
  x: number;
  z: number;
  speed: number;
  steer: number;
  netSide: -1 | 1;
  netAngle: number;
  energy: number;
  boosting: boolean;
  jumpHeight: number;
  jumpVelocity: number;
  lives: number;
  protectionRemainingMs: number;
  collectedPlastic: number;
  collectedMetal: number;
  finishTimeMs: number | null;
  lastProcessedInputSeq: number;
  lastProcessedJumpSeq: number;
}

export interface PickupOwnership {
  itemId: string;
  collectedBy: string | null;
}

export interface PursuitSnapshot {
  targetPlayerId: string;
  gap: number;
  retreatRemainingMs: number;
}

export interface RaceSnapshot {
  raceId: string;
  tick: number;
  serverTimeMs: number;
  elapsedMs: number;
  players: PlayerSnapshot[];
  trash: PickupOwnership[];
  lifesavers: PickupOwnership[];
  pursuits: PursuitSnapshot[];
}

export interface RaceSnapshotMessage {
  type: 'race.snapshot';
  protocolVersion: 1;
  snapshot: RaceSnapshot;
}

export interface RaceEventBase {
  eventId: string;
  raceId: string;
  tick: number;
}

export type RaceEvent = RaceEventBase & (
  | {kind: 'trash.collected'; itemId: string; playerId: string; material: MaterialId}
  | {kind: 'lifesaver.collected'; itemId: string; playerId: string; lives: number}
  | {kind: 'player.hit'; playerId: string; cause: 'obstacle' | 'octopus'; lives: number}
  | {kind: 'player.finished'; playerId: string; finishTimeMs: number}
  | {kind: 'player.disqualified'; playerId: string}
  | {kind: 'player.left'; playerId: string}
  | {kind: 'player.dnf'; playerId: string}
);

export interface RaceEventMessage {
  type: 'race.event';
  protocolVersion: 1;
  event: RaceEvent;
}

export interface ParticipantResult {
  playerId: string;
  outcome: 'finished' | 'disqualified' | 'left' | 'dnf';
  rank: number | null;
  finishTimeMs: number | null;
  collected: {plastic: number; metal: number};
  credited: {plastic: number; metal: number};
  reduceChoice: ReduceChoice;
  settlementState: 'pending' | 'confirmed';
}

export interface RaceResult {
  raceId: string;
  roomId: string;
  rulesVersion: string;
  courseVersion: string;
  endedAtMs: number;
  participants: ParticipantResult[];
}

export interface RaceEndedMessage {
  type: 'race.ended';
  protocolVersion: 1;
  result: RaceResult;
}

export type RealtimeErrorCode =
  | 'INVALID_MESSAGE'
  | 'INCOMPATIBLE_VERSION'
  | 'SESSION_REQUIRED'
  | 'ROOM_NOT_FOUND'
  | 'ROOM_FULL'
  | 'NOT_A_MEMBER'
  | 'INVALID_STATE'
  | 'INVALID_READY'
  | 'PROFILE_STALE'
  | 'PROFILE_UNAVAILABLE'
  | 'INVALID_INPUT'
  | 'RACE_NOT_ACTIVE'
  | 'RATE_LIMITED'
  | 'INTERNAL_ERROR';

export interface RealtimeErrorMessage {
  type: 'error';
  protocolVersion: 1;
  error: {
    code: RealtimeErrorCode;
    message: string;
    relatedType: string | null;
    fatal: boolean;
  };
}

export type ServerRealtimeMessage =
  | RoomStateMessage
  | RaceStartMessage
  | RaceSnapshotMessage
  | RaceEventMessage
  | RaceEndedMessage
  | RealtimeErrorMessage;
