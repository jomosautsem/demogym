// Modern Node.js provides a native global DOMException.
// This shim exports it directly to fulfill requirements of older packages without warnings.
module.exports = globalThis.DOMException;
