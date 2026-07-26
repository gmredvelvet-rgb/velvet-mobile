/**
 * Velvet Mobile — token movement.
 *
 * The joystick used to write `tokenDoc.update({x, y})`: one database
 * round-trip per tile, each animating and coming to a stop on its own, which
 * is why holding the stick read as a run of separate jumps rather than as
 * walking. Movement now goes through `TokenDocument#move()` — the same
 * movement API the core's own arrow keys use — and each step is given the
 * weight of a chess piece: the token lifts, slides and lands.
 *
 * Two deliberate constraints:
 *
 * - **Public API only.** The shift maths below reproduce what
 *   `PlaceableObject._getShiftedPosition` does rather than calling it, so a
 *   protected method disappearing cannot take token movement with it.
 * - **`CONFIG.Token.objectClass` is left alone.** Replacing the Token class is
 *   how movement modules such as Aeris Tokens hook the canvas, and only one
 *   module can hold that slot. Animating through `Token#animate` costs us
 *   nothing and keeps us a good neighbour.
 *
 * @module canvas/token-mover
 */

import { Logger } from "../core/logger.mjs";
import { Settings } from "../core/settings.mjs";
import { Motion } from "../motion/animation-engine.mjs";
import {
  MODULE_ID, MOVE_STYLES, STEP_LIFT, STEP_RISE_SHARE, STEP_LIFT_MIN_MS, STEP_LIFT_MAX_MS
} from "../core/constants.mjs";

/** Which footstep sound comes next, so consecutive steps alternate. */
let footIndex = 0;

/**
 * One axis of the direction mask.
 * @param {number} delta      -1, 0 or 1 for this axis.
 * @param {number} value      The token's real coordinate.
 * @param {number} snapped    The same coordinate snapped to the grid.
 * @param {number} negative   The direction bit for a negative delta.
 * @param {number} positive   The direction bit for a positive delta.
 * @returns {number}          The bit to contribute, or 0 to re-align instead.
 */
function axis(delta, value, snapped, negative, positive) {
  if (delta < 0) return value <= snapped + 0.5 ? negative : 0;
  if (delta > 0) return value >= snapped - 0.5 ? positive : 0;
  return 0;
}

/**
 * Where one step in this direction lands.
 *
 * Mirrors the core's keyboard movement. Three details matter and are easy to
 * get wrong: a token that has drifted off-grid re-aligns instead of skipping
 * a cell (hence the comparisons against the snapped position); hexagonal
 * grids need a one-pixel bias so the top-left corner resolves into the
 * intended hex rather than its neighbour; and grids with illegal diagonals
 * answer with the point unchanged, which the caller reads as "no move".
 *
 * @param {TokenDocument} tokenDoc
 * @param {number} dx
 * @param {number} dy
 * @returns {{x: number, y: number}|null}
 */
function shiftedPosition(tokenDoc, dx, dy) {
  const grid = tokenDoc.parent?.grid ?? canvas?.grid;
  if (!grid || typeof grid.getShiftedPoint !== "function") return null;

  const source = tokenDoc._source ?? tokenDoc;
  const position = { x: source.x, y: source.y };
  const snapped = typeof tokenDoc.getSnappedPosition === "function"
    ? tokenDoc.getSnappedPosition({
      x: position.x,
      y: position.y,
      elevation: tokenDoc.elevation,
      width: tokenDoc.width,
      height: tokenDoc.height,
      shape: tokenDoc.shape
    })
    : position;

  /* An axis only contributes a direction when the token is not already past
     the cell it would move away from. A token that drifted right of its cell
     therefore steps *back onto* the grid when pushed left, rather than
     skipping a whole cell — which is why a zero direction is meaningful here
     and must not be substituted with the raw one. */
  const D = CONST.MOVEMENT_DIRECTIONS;
  const direction = axis(dx, position.x, snapped.x, D.LEFT, D.RIGHT)
    | axis(dy, position.y, snapped.y, D.UP, D.DOWN);

  const biasX = grid.isHexagonal && !grid.columns ? 1 : 0;
  const biasY = grid.isHexagonal && grid.columns ? 1 : 0;
  const shifted = grid.getShiftedPoint({ x: snapped.x + biasX, y: snapped.y + biasY }, direction);

  const x = Math.round(shifted.x - biasX);
  const y = Math.round(shifted.y - biasY);
  if (x === source.x && y === source.y) return null;
  return { x, y };
}

/**
 * How long the core will take to slide this token one cell, in milliseconds.
 * The lift is timed against it so the token is back on the board as it
 * arrives, whatever movement speed the action or the system asks for.
 * @param {Token} token
 * @returns {number}
 */
function stepDuration(token) {
  const fallback = 200;
  try {
    const action = token.document.movementAction;
    const config = CONFIG.Token?.movement?.actions?.[action];
    const speed = config?.getAnimationOptions?.(token)?.movementSpeed
      ?? CONFIG.Token?.movement?.defaultSpeed;
    // movementSpeed is grid spaces per second.
    if (Number.isFinite(speed) && speed > 0) return Math.round(1000 / speed);
  } catch (err) {
    Logger.debug("Could not read the token's movement speed", err);
  }
  return fallback;
}

/**
 * Lift the token off the board and set it back down.
 *
 * Runs in its own named animation context. Foundry keys contexts by name and
 * each one only writes the properties it animates, so this rides alongside
 * the movement animation — position and scale never fight over a frame.
 * The landing is chained rather than awaited so the two read as one gesture.
 *
 * @param {Token} token
 */
function liftAndLand(token) {
  if (!token || typeof token.animate !== "function") return;
  // Reduced motion asks for less movement, not more: the hop is exactly the
  // kind of decorative motion that request is about.
  if (Motion.reduced) return;

  // The resting scale has to come off the source: an overlapping hop is
  // already animating `document.texture`, and reading that would compound.
  const texture = token.document?._source?.texture ?? token.document?.texture;
  const baseX = Number(texture?.scaleX);
  const baseY = Number(texture?.scaleY);
  if (!Number.isFinite(baseX) || !Number.isFinite(baseY)) return;

  const total = Math.min(STEP_LIFT_MAX_MS, Math.max(STEP_LIFT_MIN_MS, stepDuration(token)));
  const rise = Math.round(total * STEP_RISE_SHARE);
  const name = `${MODULE_ID}.step.${token.document.id}`;

  try {
    token.animate(
      { texture: { scaleX: baseX * (1 + STEP_LIFT), scaleY: baseY * (1 + STEP_LIFT) } },
      { name, duration: rise, easing: "easeOutCircle" }
    );
    token.animate(
      { texture: { scaleX: baseX, scaleY: baseY } },
      { name, duration: total - rise, easing: "easeInCircle", chain: true }
    );
  } catch (err) {
    // A token mid-teardown can refuse to animate. The move itself still
    // stands; only its flourish is lost.
    Logger.debug("Step animation refused", err);
  }
}

/**
 * A footstep, alternating between the two configured sounds so a walk does
 * not become one sample on repeat. Local to this client on purpose: the
 * player walking wants to hear themselves, the rest of the table does not.
 */
function footstep() {
  const sounds = Settings.stepSounds;
  if (!sounds.length) return;
  const volume = Number(Settings.stepVolume);
  if (Number.isNaN(volume) || volume <= 0) return;
  const src = sounds[footIndex % sounds.length];
  footIndex += 1;
  try {
    foundry.audio.AudioHelper.play({ src, volume, autoplay: true, loop: false }, false);
  } catch (err) {
    Logger.debug("Footstep sound failed", err);
  }
}

/** Forget which foot is next, so a fresh walk starts on the same one. */
export function resetFootsteps() {
  footIndex = 0;
}

/**
 * Step a token one cell.
 *
 * @param {TokenDocument} tokenDoc
 * @param {number} dx  -1, 0 or 1
 * @param {number} dy  -1, 0 or 1
 * @returns {Promise<boolean>}  Whether the token actually moved.
 */
export async function stepToken(tokenDoc, dx, dy) {
  if (!tokenDoc || (!dx && !dy)) return false;

  const target = shiftedPosition(tokenDoc, dx, dy);
  // No target means the grid refused the step — an illegal diagonal, or a
  // direction that resolves to where the token already stands.
  if (!target) return false;

  const grid = tokenDoc.parent?.grid ?? canvas?.grid;
  const weighted = Settings.moveStyle === MOVE_STYLES.WEIGHTED;

  /* The lift starts with the step rather than after it: `move()` resolves on
     the database round-trip, by which point the slide is already under way. */
  if (weighted) {
    liftAndLand(tokenDoc.object);
    footstep();
  }

  if (typeof tokenDoc.move !== "function") {
    // Cores older than the v13 movement API. Keep the old write so the
    // joystick still moves the token, just without the extras.
    await tokenDoc.update({ x: target.x, y: target.y });
    return true;
  }

  return tokenDoc.move({
    ...target,
    action: tokenDoc.movementAction,
    snapped: grid ? !grid.isGridless : true,
    explicit: false,   // the player is steering, not placing waypoints
    checkpoint: true
  }, { method: "keyboard" });
}
