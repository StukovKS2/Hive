import type { GoldenPathfindingCase } from '../fixtures/golden-pathfinding-cases';
import { createPathfinderFromFixture } from './pathfinding-map-generator';

export interface GoldenPathResult {
  rawPath: Array<{ x: number; y: number }>;
  noPath: boolean;
  replanned: boolean;
}

export function runGoldenPathfindingCase(testCase: GoldenPathfindingCase): GoldenPathResult {
  const pathfinder = createPathfinderFromFixture(testCase.fixture);

  if (testCase.mode === 'combat') {
    const combat = testCase.combat!;
    pathfinder.setCombatTarget(combat.target, combat.range, combat.primaryEnemyId);
  } else {
    pathfinder.setTarget(testCase.fixture.goal, 0.2);
  }

  if (testCase.setup === 'learned-blocked-at-start') {
    pathfinder.next(testCase.fixture.start);
    pathfinder.reportStall(testCase.fixture.start);
  }

  const step = pathfinder.next(testCase.fixture.start);
  return {
    rawPath: pathfinder.getPlannedTiles(),
    noPath: step.noPath === true,
    replanned: step.replanned === true,
  };
}
