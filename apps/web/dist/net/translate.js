const ROOM_STATES = { LOBBY: 'waiting', COUNTDOWN: 'countdown', RACING: 'running', RESULTS: 'ended' };
const TRASH_KINDS = { bottle: 0, pipe: 1, wrapper: 2 };
const CHARACTER_NAMES = { nico: 'Nico', luna: 'Luna', amara: 'Amara', samuel: 'Samuel' };
// Go's hit sets 1.15 s of slowdown and 2.6 s of protection; the recoil effect
// reads the remaining slowdown, derived here from the authoritative protection.
const HIT_SLOW_SECONDS = 1.15;
const HIT_PROTECTION_SECONDS = 2.6;
const filled = (...values) => values.every(value => value !== '');
function equipment(e) {
    return filled(e.boardId, e.outfitId, e.netId, e.hairId, e.characterId)
        ? { board: e.boardId, outfit: e.outfitId, net: e.netId, hair: e.hairId, character: e.characterId } : null;
}
function appearance(a) {
    return filled(a.skinId, a.hairColorId) ? { skin: a.skinId, hairColor: a.hairColorId } : null;
}
/** First characters of the opaque playerId, the same on every client (the Python CLI prints p_ plus these). */
export function playerTag(playerId) {
    return playerId.replace(/^p_/, '').slice(0, 4);
}
/** Go publishes the opaque playerId as displayName; show the chosen character
 *  instead, with a short tag so players with the same character can be told apart. */
export function displayName(member, characterId) {
    const name = member.displayName.trim();
    if (name && name !== member.playerId)
        return name.slice(0, 80);
    const base = (characterId && CHARACTER_NAMES[characterId]) || 'Surfista';
    const tag = playerTag(member.playerId);
    return tag ? `${base} · #${tag}` : base;
}
export function roomState(room) {
    if (room.state === 'CLOSED')
        return null;
    return {
        roomId: room.roomId, mapId: room.mapId, capacity: 4, rulesVersion: room.rulesVersion, courseVersion: room.courseVersion,
        state: ROOM_STATES[room.state], raceId: room.raceId, countdownEndsAtMs: room.countdownEndsAtMs,
        members: room.members.map(member => ({
            playerId: member.playerId,
            displayName: displayName(member, member.equipment.characterId),
            controller: 'human',
            ready: member.ready,
            connected: member.connected,
            participantState: member.participantState,
            profileRevision: member.profileRevision,
            reduceChoice: member.reduceChoice,
            equipment: equipment(member.equipment),
            appearance: appearance(member.appearance),
        })),
    };
}
function course(manifest) {
    return {
        mapId: manifest.mapId,
        courseVersion: manifest.courseVersion,
        initialSeed: 0,
        lengthMeters: manifest.lengthUnits,
        lateralLimitMeters: manifest.lateralLimitUnits,
        obstacles: manifest.obstacles.map(o => ({ id: o.itemId, x: o.x, z: o.z, radius: o.radius })),
        trash: manifest.trash.map(t => ({ id: t.itemId, x: t.x, z: t.z, kind: TRASH_KINDS[t.kind], rotation: t.rotation, phase: t.phase })),
        lifesavers: manifest.lifesavers.map(l => ({ id: l.itemId, x: l.x, z: l.z })),
    };
}
export function raceStart(message, room) {
    const members = new Map((room?.members ?? []).map(member => [member.playerId, member]));
    return {
        type: 'race.start',
        protocolVersion: 1,
        raceId: message.raceId,
        serverTimeMs: message.serverTimeMs,
        startsAtMs: message.startedAtMs,
        rulesVersion: message.rulesVersion,
        course: course(message.course),
        members: message.roster.map(entry => {
            const member = members.get(entry.playerId);
            return {
                playerId: entry.playerId,
                displayName: displayName(member ?? { playerId: entry.playerId, displayName: '' }, entry.equipment.characterId),
                controller: 'human',
                ready: true,
                connected: member?.connected ?? true,
                equipment: { board: entry.equipment.boardId, outfit: entry.equipment.outfitId, net: entry.equipment.netId, hair: entry.equipment.hairId, character: entry.equipment.characterId },
                appearance: { skin: entry.appearance.skinId, hairColor: entry.appearance.hairColorId },
            };
        }),
    };
}
/**
 * After a reload during RACING, Go replays room.state and a full snapshot but
 * not race.start (E43). The versioned manifest for room.courseVersion plus the
 * prepared members rebuild an equivalent start for presentation only.
 */
export function resumedStart(room, manifest, snapshot) {
    if (room.state !== 'RACING' || !room.raceId || snapshot.raceId !== room.raceId ||
        manifest.mapId !== room.mapId || manifest.courseVersion !== room.courseVersion)
        return null;
    const racing = new Set(snapshot.players.map(player => player.playerId));
    const roster = room.members.filter(member => racing.has(member.playerId));
    if (roster.length !== racing.size || roster.some(member => member.reduceChoice === null))
        return null;
    return {
        type: 'race.start', protocolVersion: 1, roomId: room.roomId, raceId: room.raceId,
        serverTimeMs: snapshot.serverTimeMs, startedAtMs: snapshot.serverTimeMs - snapshot.elapsedMs,
        rulesVersion: room.rulesVersion, course: manifest,
        roster: roster.map((member, index) => ({
            playerId: member.playerId, startSlotX: manifest.startSlotsX[index] ?? 0,
            equipment: member.equipment, appearance: member.appearance, reduceChoice: member.reduceChoice ?? 'reusable',
        })),
    };
}
function player(p) {
    const protection = p.protectionRemainingMs / 1000;
    return {
        playerId: p.playerId,
        state: p.participantState,
        x: p.x, z: p.z, speed: p.speed, turn: p.steer,
        netSide: p.netSide, netAngle: p.netAngle, energy: p.energy, boosting: p.boosting,
        jump: p.jumpHeight, jumpVelocity: p.jumpVelocity,
        lives: p.lives, protection,
        hit: Math.max(0, protection - (HIT_PROTECTION_SECONDS - HIT_SLOW_SECONDS)),
        collected: p.collectedPlastic + p.collectedMetal, plastic: p.collectedPlastic, metal: p.collectedMetal,
        finishTimeSeconds: p.finishTimeMs === null ? null : p.finishTimeMs / 1000,
        lastProcessedInputSeq: p.lastProcessedInputSeq,
        lastProcessedJumpSeq: p.lastProcessedJumpSeq,
    };
}
export function raceSnapshot(snapshot) {
    return {
        raceId: snapshot.raceId,
        tick: snapshot.tick,
        serverTimeMs: snapshot.serverTimeMs,
        elapsedSeconds: snapshot.elapsedMs / 1000,
        // E43 snapshots only exist while RACING; the countdown lives in room.state.
        state: 'running',
        countdownSeconds: 0,
        players: snapshot.players.map(player),
        trash: snapshot.trash.map(item => ({ itemId: item.itemId, collectedBy: item.collectedBy })),
        lifesavers: snapshot.lifesavers.map(item => ({ itemId: item.itemId, collectedBy: item.collectedBy })),
        pursuits: snapshot.pursuits.map(p => ({
            pursuitId: `pursuit:${p.targetPlayerId}`, targetPlayerId: p.targetPlayerId,
            gap: p.gap, retreat: p.retreatRemainingMs / 1000,
        })),
    };
}
export function raceEvent(event) {
    switch (event.kind) {
        case 'lifesaver.collected':
            return { ...event, kind: 'life.collected' };
        case 'player.finished': {
            const { finishTimeMs, ...rest } = event;
            return { ...rest, finishTimeSeconds: finishTimeMs / 1000 };
        }
        default:
            return event;
    }
}
export function raceResult(result) {
    return {
        raceId: result.raceId,
        roomId: result.roomId,
        rulesVersion: result.rulesVersion,
        courseVersion: result.courseVersion,
        endedAtMs: result.endedAtMs,
        participants: result.participants.map(p => ({
            playerId: p.playerId,
            outcome: p.outcome,
            rank: p.rank,
            finishTimeSeconds: p.finishTimeMs === null ? null : p.finishTimeMs / 1000,
            collected: { ...p.collected },
            credited: { ...p.credited },
            reduceChoice: p.reduceChoice,
            settlementState: p.settlementState,
            settlementId: null,
        })),
    };
}
