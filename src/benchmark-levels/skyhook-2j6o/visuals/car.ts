import {
  BoxGeometry,
  Color,
  CylinderGeometry,
  Group,
  Mesh,
  MeshBasicMaterial,
} from 'three';
import { CLAMP_SLOTS } from '../gameplay';
import { RAIL_BASIS, TETHER_OFFSET } from '../rail';
import { createLightMaterial, createPanelMaterial, setPanelBase, type PanelMaterial } from './materials';
import { GUNMETAL, HAZARD_ORANGE, hdr, INSTRUMENT, PANEL, PANEL_DARK, WARNING_RED } from './palette';

// The climber: the camera is its turret, so what the player sees of it is the
// leading edge of the deck along the bottom of the view, the grip hub and
// tether rollers at the lower left, and the status lamps that double as a
// diegetic hull gauge. Local frame is RAIL_BASIS: x right, y up, -z ahead.

export type ClimberCar = {
  root: Group;
  deckMaterial: PanelMaterial;
  lamps: Mesh[];
  strobe: Mesh;
  rollers: Mesh[];
  scorches: Mesh[];
  setHull(current: number, max: number): void;
};

const DECK_TOP = -3.0;
const DECK_END = -6.0;

export function createClimberCar(): ClimberCar {
  const root = new Group();
  root.quaternion.copy(RAIL_BASIS);

  const deckMaterial = createPanelMaterial(PANEL);
  const deck = new Mesh(new BoxGeometry(9.4, 0.6, 9.5), deckMaterial);
  deck.position.set(0, DECK_TOP - 0.3, DECK_END + 4.75);
  root.add(deck);

  // Leading-edge bumper with hazard chevrons.
  const bumper = new Mesh(new BoxGeometry(9.6, 0.8, 0.5), createPanelMaterial(PANEL_DARK));
  bumper.position.set(0, DECK_TOP - 0.2, DECK_END - 0.2);
  root.add(bumper);
  const orange = createLightMaterial(HAZARD_ORANGE, 0.85);
  const darkStripe = new MeshBasicMaterial({ color: GUNMETAL.clone() });
  // Chevrons painted along the leading edge of the deck top, angled like a
  // hazard bar, so the turret sees them from above.
  for (let i = 0; i < 8; i += 1) {
    const stripe = new Mesh(new BoxGeometry(0.7, 0.05, 1.4), i % 2 === 0 ? orange : darkStripe);
    stripe.position.set(-4.0 + i * 1.15, DECK_TOP + 0.03, DECK_END + 0.9);
    stripe.rotation.y = -0.6;
    root.add(stripe);
  }

  // Raised side rails, and slot pads where limpets like to clamp.
  for (const side of [-1, 1]) {
    const rail = new Mesh(new BoxGeometry(0.34, 0.5, 9.2), createPanelMaterial(PANEL_DARK));
    rail.position.set(side * 4.75, DECK_TOP + 0.15, DECK_END + 4.6);
    root.add(rail);
  }
  for (const slot of CLAMP_SLOTS) {
    const pad = new Mesh(new BoxGeometry(1.5, 0.05, 1.5), createPanelMaterial(PANEL_DARK.clone().multiplyScalar(1.3)));
    pad.position.set(slot.x, DECK_TOP + 0.03, -slot.z);
    root.add(pad);
  }

  // Grip hub around the tether, lower left: a housing with two rollers and an
  // amber strobe. The tether passes straight through it.
  const hub = new Group();
  hub.position.set(TETHER_OFFSET.x, TETHER_OFFSET.y, 0);
  const housing = new Mesh(new BoxGeometry(2.6, 2.4, 6.5), createPanelMaterial(PANEL));
  housing.position.set(0, 0, -1.5);
  hub.add(housing);
  const band = new Mesh(new BoxGeometry(2.7, 0.35, 0.3), orange);
  band.position.set(0, 0.6, -4.6);
  hub.add(band);
  const rollers: Mesh[] = [];
  for (const y of [-1.0, 1.0]) {
    const roller = new Mesh(new CylinderGeometry(0.5, 0.5, 1.6, 12), createPanelMaterial(PANEL_DARK));
    roller.rotation.z = Math.PI / 2;
    roller.position.set(0, y, -5.1);
    hub.add(roller);
    rollers.push(roller);
  }
  const strobe = new Mesh(new BoxGeometry(0.35, 0.35, 0.35), createLightMaterial(HAZARD_ORANGE, 1.6));
  strobe.position.set(1.0, 1.35, -3.2);
  hub.add(strobe);
  // Strut from the hub to the deck.
  const strut = new Mesh(new BoxGeometry(0.5, 0.5, 2.2), createPanelMaterial(PANEL_DARK));
  strut.position.set(1.9, -0.2, -3.5);
  strut.rotation.z = -0.5;
  hub.add(strut);
  root.add(hub);

  // Five status lamps along the leading edge: lit instrument-white while the
  // hull point behind them is intact, warning red once it is gone.
  const lamps: Mesh[] = [];
  for (let i = 0; i < 5; i += 1) {
    const lamp = new Mesh(new BoxGeometry(0.42, 0.08, 0.16), createLightMaterial(INSTRUMENT, 1.4));
    lamp.position.set(-2.4 + i * 1.2, DECK_TOP + 0.04, DECK_END + 2.2);
    root.add(lamp);
    lamps.push(lamp);
  }

  // Scorch marks appear where the hull took hits; hidden until then.
  const scorches: Mesh[] = [];
  const scorchMaterial = new MeshBasicMaterial({ color: new Color(0.05, 0.04, 0.04) });
  for (let i = 0; i < 5; i += 1) {
    const scorch = new Mesh(new BoxGeometry(1.4 + (i % 2) * 0.6, 0.04, 1.1 + (i % 3) * 0.4), scorchMaterial);
    scorch.position.set(-3 + ((i * 2.9) % 6), DECK_TOP + 0.04, DECK_END + 1.2 + ((i * 1.7) % 3.5));
    scorch.rotation.y = i * 0.9;
    scorch.visible = false;
    root.add(scorch);
    scorches.push(scorch);
  }

  const car: ClimberCar = {
    root,
    deckMaterial,
    lamps,
    strobe,
    rollers,
    scorches,
    setHull(current, max) {
      for (const [index, lamp] of lamps.entries()) {
        const threshold = ((index + 1) / lamps.length) * max;
        const intact = current >= threshold - 1e-6;
        (lamp.material as MeshBasicMaterial).color.copy(intact ? hdr(INSTRUMENT, 1.4) : hdr(WARNING_RED, 1.6));
      }
      const lost = Math.max(0, Math.min(scorches.length, max - current));
      for (const [index, scorch] of scorches.entries()) scorch.visible = index < lost;
    },
  };
  return car;
}

export function flashDeck(car: ClimberCar, color: Color) {
  setPanelBase(car.deckMaterial, color);
}

const DECK_HOT = hdr(HAZARD_ORANGE, 1.2);
const deckScratch = new Color();

export function restoreDeck(car: ClimberCar, t: number) {
  setPanelBase(car.deckMaterial, deckScratch.copy(PANEL).lerp(DECK_HOT, t));
}
