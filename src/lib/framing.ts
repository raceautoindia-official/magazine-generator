// Pure module, used on the server and in the browser: how a picture sits in a frame.
//
// A frame always shows a part of its picture that has the frame's own shape. At zoom 1 that part is as large as
// the picture allows, so the picture just fills the frame. x and y say where the part lies in the room it has to
// move: 0 = against the left (top) edge of the picture, 1 = against the right (bottom) edge. Because the part
// never leaves the picture, a frame can never show an empty band.

export type Framing = { x: number; y: number; zoom: number };

export const MAX_ZOOM = 4;

const unit = (value: number) => Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0.5));

export function tidyFraming(framing: Framing): Framing {
  return { x: unit(framing.x), y: unit(framing.y), zoom: Math.min(MAX_ZOOM, Math.max(1, Number.isFinite(framing.zoom) ? framing.zoom : 1)) };
}

/** The part of a picture (in its pixels) that a frame of the given shape shows. */
export function frameArea(width: number, height: number, aspect: number, framing: Framing): { left: number; top: number; width: number; height: number } {
  const { x, y, zoom } = tidyFraming(framing);
  let baseWidth = width;
  let baseHeight = Math.round(baseWidth / aspect);
  if (baseHeight > height) {
    baseHeight = height;
    baseWidth = Math.round(baseHeight * aspect);
  }
  const partWidth = Math.max(1, Math.min(width, Math.round(baseWidth / zoom)));
  const partHeight = Math.max(1, Math.min(height, Math.round(baseHeight / zoom)));
  return { left: Math.round(x * (width - partWidth)), top: Math.round(y * (height - partHeight)), width: partWidth, height: partHeight };
}

/** The framing that shows a given part at zoom 1; used to express the automatic crop around a subject. */
export function framingOfArea(width: number, height: number, area: { left: number; top: number; width: number; height: number }): Framing {
  return {
    x: width > area.width ? area.left / (width - area.width) : 0.5,
    y: height > area.height ? area.top / (height - area.height) : 0.5,
    zoom: 1,
  };
}

/**
 * The same framing as CSS for an <img> that fills its frame with object-fit: cover. It shows exactly the part
 * frameArea() gives, so the picture on the Design tab and the one cut for the PDF are the same.
 */
export function framingCss(framing: Framing): string {
  const { x, y, zoom } = tidyFraming(framing);
  const at = `${+(x * 100).toFixed(3)}% ${+(y * 100).toFixed(3)}%`;
  return `object-fit:cover;object-position:${at};transform:scale(${+zoom.toFixed(4)});transform-origin:${at}`;
}

/**
 * A drag of (dx, dy) pixels on a frame of the given size, for a picture of the given natural size:
 * the picture follows the pointer. An axis with no room to move stays where it is.
 */
export function dragFraming(framing: Framing, frame: { width: number; height: number }, natural: { width: number; height: number }, dx: number, dy: number): Framing {
  const fit = Math.max(frame.width / natural.width, frame.height / natural.height) * framing.zoom;
  const roomX = natural.width * fit - frame.width;
  const roomY = natural.height * fit - frame.height;
  return tidyFraming({
    x: roomX > 0.5 ? framing.x - dx / roomX : framing.x,
    y: roomY > 0.5 ? framing.y - dy / roomY : framing.y,
    zoom: framing.zoom,
  });
}
