import { createCourse, COURSE_LENGTH, COURSE_WIDTH } from '../../dist/maps.js';

export function makeNetworkStart() {
  const course = createCourse('maracaibo');
  return {
    type: 'race.start', protocolVersion: 1, raceId: 'race-a', serverTimeMs: 1700000000000, startsAtMs: 1700000003000,
    rulesVersion: 'rules-v1',
    course: {
      mapId: course.id, courseVersion: 'course-v1', initialSeed: 57, lengthMeters: COURSE_LENGTH, lateralLimitMeters: COURSE_WIDTH,
      obstacles: course.obstacles.map((entry, index) => ({ id: `obstacle:${index}`, x: entry.x, z: entry.z, radius: entry.radius })),
      trash: course.trash.map((entry, index) => ({ ...entry, id: `trash:${index}` })),
      lifesavers: course.lifesavers.map((entry, index) => ({ ...entry, id: `life:${index}` })),
    },
    members: ['rival', 'self'].map((playerId, index) => ({
      playerId, displayName: index ? 'Tú' : 'Amara', controller: 'human', ready: true, connected: true,
      equipment: { character: index ? 'nico' : 'amara', hair: index ? 'swept' : 'afro', board: 'coral', net: 'red-base', outfit: 'costero' },
      appearance: { skin: index ? 'medium' : 'dark', hairColor: 'brown' },
    })),
  };
}

export function makeNetworkSnapshot(start = makeNetworkStart(), tick = 1) {
  return {
    raceId: start.raceId, tick, serverTimeMs: start.serverTimeMs + tick * 50, elapsedSeconds: tick * .05,
    state: 'running', countdownSeconds: 0,
    players: start.members.map(({ playerId }, index) => ({
      playerId, state: 'racing', x: index * 3, z: -tick * 2, speed: 16, turn: 0,
      netSide: 1, netAngle: 0, energy: 0, boosting: false, jump: 0, jumpVelocity: 0,
      lives: 3, protection: 0, hit: 0, collected: 0, plastic: 0, metal: 0,
      catchTimer: 0, landingTimer: 0, finishTimeSeconds: null, lastProcessedInputSeq: tick, lastProcessedJumpSeq: 0,
    })),
    trash: start.course.trash.map(({ id }) => ({ itemId: id, collectedBy: null })),
    lifesavers: start.course.lifesavers.map(({ id }) => ({ itemId: id, collectedBy: null })),
    pursuits: [{ pursuitId: 'octopus:self', targetPlayerId: 'self', gap: 48, retreat: 0 }],
  };
}
