import type { LevelDefinition } from '../../engine/types';
import { createLockOnRunner } from '../../engine/lock-on-runner';
import { createAudio } from './audio';
import { BPM, createGameplay, TIME } from './gameplay';
import { createWorld, createEnemyMesh, createProjectileMesh, createReticle, setEnemyDenied, setEnemyLocked, setReticleActive } from './visuals';
export const tinkerBall034dLevel: LevelDefinition = {
  id: 'tinker-ball-034d', title: 'Tinker Ball',
  description: 'A marble with a mission. Unstick the workshop, wear what you rescue, and roll right through the mess.',
  bpm: BPM, markers: { buttons: 4, spools: 18, birds: 32, spill: TIME.bar(23), clean: 57 },
  sections: [{ name: 'Pocket-sized', time: 0 }, { name: 'Spool slalom', time: 15 }, { name: 'Big ideas', time: 30 }, { name: 'The glue that binds', time: TIME.bar(23) }, { name: 'All picked up', time: 56.25 }],
  post: { clearColor: 0x584c43, bloom: { strength: .22, threshold: 1, radius: .12 }, vignette: { inner: .5, outer: 1.25, strength: .24 } },
  createAudio,
  createRuntime(ctx) {
    const world = createWorld(ctx.scene, ctx.bus, ctx.camera), gameplay = createGameplay(ctx.bus);
    const game = createLockOnRunner({ ...ctx, level: { ...gameplay, detailsForRun: () => [`${world.count} rescued supplies collected`, world.clean ? 'The spill is clean. Everything sticks!' : 'The spill still has a sticky heart.'] }, visuals: { createEnemyMesh, createProjectileMesh, createReticle, setEnemyDenied, setEnemyLocked, setReticleActive } });
    let elapsed = 0, callout = -1;
    const captions = [{ t: 0, text: 'POCKET-SIZED / Unstick the little things' }, { t: 15, text: 'SPOOL SLALOM / Every piece comes with you' }, { t: 30, text: 'BIG IDEAS / Small ball. Bigger ambitions.' }, { t: 43.125, text: 'THE GLUE THAT BINDS / Crack all three layers' }, { t: 56.25, text: 'THE LAST SWEEP' }];
    const off = ctx.bus.on('runstart', () => { elapsed = 0; callout = -1; });
    return { update(dt) { game.update(dt); world.update(dt); if (game.state === 'running') {
        elapsed += dt;
        const i = captions.filter(c => elapsed >= c.t).length - 1;
        if (i !== callout) {
          callout = i;
          ctx.hud.setCallout(captions[i].text);
        }
        if (elapsed - captions[i].t > 3)
          ctx.hud.setCallout('');
      } }, dispose() { off(); game.dispose(); world.dispose(); } };
  },
};
