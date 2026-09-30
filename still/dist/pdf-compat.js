// Fills in the newer JavaScript built-ins that the bundled PDF.js (6.3.289,
// "modern" build) calls directly. Without these, rendering fails on
// browsers older than roughly early 2026, including Safari/iOS before 26.2,
// while the iOS app targets iOS 18.
//
// Loaded before PDF.js on the page (pdfjs.js) and inside the PDF.js worker
// (pdf-worker.mjs). Each shim only installs when the browser lacks the
// feature, and follows the TC39 specification's observable behavior for the
// way PDF.js uses it.
const define = (target, name, value) => {
  if (target && typeof target[name] !== "function")
    Object.defineProperty(target, name, {
      value,
      writable: true,
      configurable: true,
      enumerable: false,
    });
};

// Map/WeakMap "upsert" (Chrome/Edge 145, Firefox 144, Safari 26.2).
for (const Collection of [Map, WeakMap]) {
  define(Collection.prototype, "getOrInsert", function (key, value) {
    if (!this.has(key)) this.set(key, value);
    return this.get(key);
  });
  define(Collection.prototype, "getOrInsertComputed", function (key, compute) {
    if (typeof compute !== "function")
      throw new TypeError("getOrInsertComputed requires a callback");
    if (this.has(key)) return this.get(key);
    const value = compute(key);
    this.set(key, value);
    return value;
  });
}

// Promise.try (Safari 18.2).
define(Promise, "try", function (callback, ...args) {
  return new this((resolve) => resolve(callback(...args)));
});

// Promise.withResolvers (Safari 17.4). Included for older WebViews.
define(Promise, "withResolvers", function () {
  let resolve, reject;
  const promise = new this((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
});

// Math.sumPrecise. PDF.js only sums small integer sizes, but this uses
// Neumaier compensated summation so ordinary float input stays accurate.
define(Math, "sumPrecise", function (values) {
  let sum = 0,
    compensation = 0,
    any = false;
  for (const value of values) {
    if (typeof value !== "number")
      throw new TypeError("Math.sumPrecise expects numbers");
    any = true;
    const next = sum + value;
    compensation +=
      Math.abs(sum) >= Math.abs(value)
        ? sum - next + value
        : value - next + sum;
    sum = next;
  }
  return any ? sum + compensation : -0;
});

// Uint8Array base64/hex helpers (Safari 18.2, Chrome 140).
define(Uint8Array.prototype, "toBase64", function () {
  let binary = "";
  for (let i = 0; i < this.length; i += 32768)
    binary += String.fromCharCode(...this.subarray(i, i + 32768));
  return btoa(binary);
});
define(Uint8Array, "fromBase64", function (string) {
  if (typeof string !== "string")
    throw new TypeError("Uint8Array.fromBase64 expects a string");
  const binary = atob(string.replace(/[\t\n\f\r ]/g, ""));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
});
define(Uint8Array.prototype, "toHex", function () {
  let hex = "";
  for (const byte of this) hex += byte.toString(16).padStart(2, "0");
  return hex;
});
define(Uint8Array, "fromHex", function (string) {
  if (
    typeof string !== "string" ||
    string.length % 2 ||
    /[^0-9a-f]/i.test(string)
  )
    throw new SyntaxError(
      "Uint8Array.fromHex expects an even-length hex string",
    );
  const bytes = new Uint8Array(string.length / 2);
  for (let i = 0; i < bytes.length; i++)
    bytes[i] = parseInt(string.slice(i * 2, i * 2 + 2), 16);
  return bytes;
});

// ArrayBuffer.prototype.transferToFixedLength (Safari 17.4). Copying is an
// acceptable stand-in: PDF.js never reuses the source buffer afterwards.
define(ArrayBuffer.prototype, "transferToFixedLength", function (length) {
  const size = length === undefined ? this.byteLength : length;
  const copy = new Uint8Array(size);
  copy.set(new Uint8Array(this, 0, Math.min(size, this.byteLength)));
  return copy.buffer;
});

// Response.prototype.bytes (Safari 18). Only exists where Response does.
if (typeof Response === "function")
  define(Response.prototype, "bytes", async function () {
    return new Uint8Array(await this.arrayBuffer());
  });
