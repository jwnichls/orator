// Browser APIs jsdom lacks, stubbed for the web test project.
import "fake-indexeddb/auto";
import { cleanup } from "@testing-library/react";
import { Blob as NodeBlob } from "node:buffer";
import { afterEach } from "vitest";

// jsdom's Blob can't be structured-cloned into (fake) IndexedDB or read by Node's Response; browsers have one Blob.
globalThis.Blob = NodeBlob as unknown as typeof Blob;

afterEach(() => cleanup());

// Tests encode an image's size in its bytes as "WxH" so putAssetBlob can "measure" it.
globalThis.createImageBitmap = (async (blob: Blob) => {
  const [w, h] = (await blob.text()).split("x").map(Number);
  return { width: w || 1, height: h || 1, close() {} };
}) as unknown as typeof createImageBitmap;

let urlSeq = 0;
URL.createObjectURL = () => `blob:test/${++urlSeq}`;
URL.revokeObjectURL = () => {};

// ProseMirror measures layout when scrolling the selection into view.
const rect = { x: 0, y: 0, top: 0, left: 0, bottom: 0, right: 0, width: 0, height: 0, toJSON() {} };
Element.prototype.getBoundingClientRect = () => rect as DOMRect;
Element.prototype.getClientRects = () => ({ length: 0, item: () => null, [Symbol.iterator]: [][Symbol.iterator] }) as unknown as DOMRectList;
Range.prototype.getBoundingClientRect = () => rect as DOMRect;
Range.prototype.getClientRects = () => ({ length: 0, item: () => null, [Symbol.iterator]: [][Symbol.iterator] }) as unknown as DOMRectList;
document.elementFromPoint = () => null;
Element.prototype.scrollIntoView = () => {};
